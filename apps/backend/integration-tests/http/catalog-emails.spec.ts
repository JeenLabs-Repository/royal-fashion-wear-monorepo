import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { render } from "@react-email/render";
import { createElement } from "react";
import VendorProductApprovedEmail, {
  type VendorProductApprovedProps,
} from "../../src/emails/vendor-product-approved";
import VendorProductChangesRequestedEmail, {
  type VendorProductChangesRequestedProps,
} from "../../src/emails/vendor-product-changes-requested";
import VendorProductRejectedEmail, {
  type VendorProductRejectedProps,
} from "../../src/emails/vendor-product-rejected";
import StaffProductReviewNeededEmail, {
  type StaffProductReviewNeededProps,
} from "../../src/emails/staff-product-review-needed";
import { EMAIL_TEMPLATES } from "../../src/emails/lib/templates";
import catalogDecisionEmailsHandler from "../../src/subscribers/catalog-decision-emails";
import catalogSubmittedAlertHandler from "../../src/subscribers/catalog-submitted-alert";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe } from "../helpers/staff-users";
import { ensureDefaultSalesChannel } from "../helpers/vendor-fixtures";
import { createActiveVendor, createCategory, type ActiveVendor } from "../support/catalog-fixtures";
import {
  approveBodyFor,
  currentHash,
  approveViaApi,
  makeApprover,
  readSubmission,
  submitDraft,
} from "../support/decision-fixtures";

jest.setTimeout(10 * 60 * 1000);

type Row = Record<string, any>;

// Distinctive fake values that must never reach an email.
const CANARY_VENDOR = "zq7vn";
const CANARY_PHONE = "+91 90000 77123";
const CANARY_CUSTOMER_EMAIL = "customer-zq7vn@example.test";

// Compile-time proof that the props types are closed. Never called: `tsc --noEmit` fails when
// one of the expected errors is missing, because an unused `@ts-expect-error` is an error.
export const typeChecks = (): unknown[] => {
  const approved: VendorProductApprovedProps = {
    product_title: "Shirt",
    is_live_edit: false,
    portal_url: "https://portal.example.test/products",
    // @ts-expect-error a customer email is not a prop of the approved email
    customer_email: CANARY_CUSTOMER_EMAIL,
  };
  const rejected: VendorProductRejectedProps = {
    product_title: "Shirt",
    reason: "Not suitable for the store.",
    portal_url: "https://portal.example.test/products",
    // @ts-expect-error an order total is not a prop of the rejected email
    order_total: "100.00",
  };
  const changes: VendorProductChangesRequestedProps = {
    product_title: "Shirt",
    reason: "Remove the studio name.",
    portal_url: "https://portal.example.test/products",
    // @ts-expect-error a vendor name is not a prop of the changes email
    vendor_name: CANARY_VENDOR,
  };
  const review: StaffProductReviewNeededProps = {
    product_title: "Shirt",
    is_live_edit: false,
    review_url: "https://admin.example.test/app/product-reviews/x",
    // @ts-expect-error a payout price is not a prop of the staff alert
    payout_price: "199.99",
  };
  return [approved, rejected, changes, review];
};

// Redis/BullMQ may still be draining product.updated revalidation jobs from setup,
// so catalog.* subscribers can lag behind the HTTP response that emitted them.
const until = async (check: () => boolean, timeoutMs = 15000): Promise<void> => {
  const stopAt = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= stopAt) {
      throw new Error("Timed out waiting for the email subscriber");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("catalog emails and alerts", () => {
      let vendorA: ActiveVendor;
      let categoryId: string;
      let approver: Awaited<ReturnType<typeof makeApprover>>;
      let second: Awaited<ReturnType<typeof makeApprover>>;
      let delivered: Row[];
      let seen: Set<string>;
      let restoreBus: (() => void) | undefined;
      let originalCreateNotifications: ((...args: unknown[]) => unknown) | undefined;
      let failNextSend = false;

      // Notification capture on the prototype (same process as a sync handler call).
      // Catalog events also run through Redis; we additionally invoke the handlers from the
      // emit wrap so a starved queue cannot hide a missing staff alert (AFK).
      const installMailbox = () => {
        delivered = [];
        seen = new Set<string>();
        failNextSend = false;
        const service = getContainer().resolve(Modules.NOTIFICATION) as {
          createNotifications: (...args: unknown[]) => unknown;
        };
        const proto = Object.getPrototypeOf(service) as {
          createNotifications: (...args: unknown[]) => unknown;
        };
        if (!originalCreateNotifications) {
          originalCreateNotifications = proto.createNotifications.bind(proto);
        }
        proto.createNotifications = (async (data: unknown) => {
          if (failNextSend) {
            throw new Error("mail server down");
          }
          const list = (Array.isArray(data) ? data : [data]) as Row[];
          const fresh = list.filter((item) => !seen.has(String(item.idempotency_key)));
          fresh.forEach((item) => seen.add(String(item.idempotency_key)));
          delivered.push(...fresh);
          return fresh;
        }) as never;
      };

      const forTemplate = (template: string) => delivered.filter((item) => item.template === template);
      const withoutRecipient = (item: Row) => JSON.stringify({ ...item, to: undefined });

      beforeAll(async () => {
        const container = getContainer();
        vendorA = await createActiveVendor(api, container, { label: "emails-a" });
        categoryId = await createCategory(container, { name: "Emails Apparel" });
        approver = await makeApprover(api, container);
        second = await makeApprover(api, container);
        await makeApprover(api, container, ["superadmin"]);
        await createPublishableKey(container);
        await ensureDefaultSalesChannel(container);

        const bus = container.resolve(Modules.EVENT_BUS) as unknown as {
          emit: (messages: unknown, options?: unknown) => Promise<unknown>;
        };
        const original = bus.emit.bind(bus);
        bus.emit = async (messages: unknown, options?: unknown) => {
          const list = ([] as Row[]).concat(messages as never);
          const result = await original(messages, options);
          for (const message of list) {
            const name = String(message?.name ?? "");
            const data = message?.data;
            const event = { name, data } as never;
            if (name === "catalog.submitted") {
              await catalogSubmittedAlertHandler({ event, container: getContainer() } as never);
            } else if (
              name === "catalog.approved" ||
              name === "catalog.changes_applied" ||
              name === "catalog.rejected" ||
              name === "catalog.changes_requested"
            ) {
              await catalogDecisionEmailsHandler({ event, container: getContainer() } as never);
            }
          }
          return result;
        };
        restoreBus = () => {
          bus.emit = original;
        };
      });

      beforeEach(() => installMailbox());

      afterAll(() => {
        restoreBus?.();
        if (originalCreateNotifications) {
          const service = getContainer().resolve(Modules.NOTIFICATION);
          Object.getPrototypeOf(service).createNotifications = originalCreateNotifications;
        }
      });

      it("alerts every catalog approver once per submitted revision", async () => {
        const container = getContainer();
        const draft = await submitDraft(api, container, vendorA, categoryId, `e1-${randomUUID().slice(0, 4)}`);

        await until(() => forTemplate("staff-product-review-needed").length >= 2);
        const alerts = forTemplate("staff-product-review-needed");
        expect(alerts.map((item) => item.to).sort()).toEqual([approver.email, second.email].sort());
        for (const alert of alerts) {
          expect(String(alert.idempotency_key)).toContain(`product-review-needed:${draft.submissionId}:`);
          // The bucket is the revision and the submission time, so a resubmit is not suppressed.
          expect(String(alert.idempotency_key)).toMatch(/:\d+-\d{10,}:/);
          const text = withoutRecipient(alert);
          expect(text).toContain(String(draft.body.title));
          expect(text).toContain(`/product-reviews/${draft.submissionId}`);
          for (const needle of [`${draft.suffix}-S`, vendorA.vendor_id, "199.99", "249.00"]) {
            expect(text).not.toContain(needle);
          }
        }

        // The same event again sends nothing more.
        const count = delivered.length;
        const eventBus = container.resolve(Modules.EVENT_BUS) as {
          emit: (message: { name: string; data: unknown }) => Promise<void>;
        };
        await eventBus.emit({
          name: "catalog.submitted",
          data: {
            submission_id: draft.submissionId,
            product_id: draft.productId,
            vendor_id: vendorA.vendor_id,
            revision: 1,
            live: false,
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(delivered.length).toBe(count);
      });

      it("tells the vendor user, and only that address, about each decision", async () => {
        const container = getContainer();
        const suffix = () => `e2-${randomUUID().slice(0, 4)}`;

        const approvedDraft = await approveViaApi(api, container, approver.headers, vendorA, categoryId, suffix());

        const changesDraft = await submitDraft(api, container, vendorA, categoryId, suffix());
        expect(
          (
            await probe(api, approver.headers, "POST", `/admin/product-reviews/${changesDraft.submissionId}/request-changes`, {
              content_hash: changesDraft.hash,
              reason: "Remove the studio name from the description.",
            })
          ).status
        ).toBe(200);

        const rejectedDraft = await submitDraft(api, container, vendorA, categoryId, suffix());
        expect(
          (
            await probe(api, approver.headers, "POST", `/admin/product-reviews/${rejectedDraft.submissionId}/reject`, {
              content_hash: rejectedDraft.hash,
              reason: "Every photograph shows a logo.",
            })
          ).status
        ).toBe(200);

        // A live edit approved: the wording says so through the typed flag.
        const edit = {
          ...approvedDraft.body,
          title: `${approvedDraft.body.title} Updated`,
          options: [{ title: "Size", values: ["S"] }],
          variants: [approvedDraft.body.variants[0]],
        };
        expect(
          (await probe(api, vendorA.headers, "POST", `/vendor/products/${approvedDraft.productId}`, edit)).status
        ).toBe(200);
        const pendingRow = await readSubmission(container, approvedDraft.productId);
        expect(
          (
            await probe(api, approver.headers, "POST", `/admin/product-reviews/${approvedDraft.submissionId}/approve`, {
              ...approveBodyFor({ body: approvedDraft.body, hash: await currentHash(container, String(pendingRow.id)) }, categoryId),
              prices: [],
            })
          ).status
        ).toBe(200);

        await until(
          () =>
            forTemplate("vendor-product-approved").length >= 2 &&
            forTemplate("vendor-product-rejected").length >= 1 &&
            forTemplate("vendor-product-changes-requested").length >= 1
        );

        const vendorEmail = vendorA.email;
        for (const item of delivered.filter((entry) => String(entry.template).startsWith("vendor-product-"))) {
          expect(item.to).toBe(vendorEmail);
          expect(String(item.idempotency_key)).toMatch(/^vendor-product-[a-z-]+:[^:]+:\d+/);
        }
        const approvedMails = forTemplate("vendor-product-approved");
        expect(approvedMails).toHaveLength(2);
        expect(approvedMails.some((item) => withoutRecipient(item).includes("changes you made"))).toBe(true);
        expect(withoutRecipient(forTemplate("vendor-product-rejected")[0])).toContain("Every photograph shows a logo.");
        expect(withoutRecipient(forTemplate("vendor-product-changes-requested")[0])).toContain(
          "Remove the studio name from the description."
        );
      });

      it("keeps the template props closed at compile time", () => {
        // The compile-time cases are in `typeChecks` above; this test keeps them in the run.
        expect(typeof typeChecks).toBe("function");
      });

      it("renders no vendor name, phone, SKU or customer email", async () => {
        const fixtureProps = {
          product_title: "Cotton T-Shirt",
          reason: "The photographs show a logo on every item.",
          is_live_edit: false,
          portal_url: "https://portal.example.test/products",
          review_url: "https://admin.example.test/app/product-reviews/sub_1",
        };
        const surrounding = {
          vendor_name: `Studio ${CANARY_VENDOR}`,
          vendor_phone: CANARY_PHONE,
          vendor_sku: `sku-${CANARY_VENDOR}`,
          customer_email: CANARY_CUSTOMER_EMAIL,
        };
        const cases: [string, Row, (props: never) => unknown][] = [
          ["vendor-product-approved", fixtureProps, VendorProductApprovedEmail as never],
          ["vendor-product-rejected", fixtureProps, VendorProductRejectedEmail as never],
          ["vendor-product-changes-requested", fixtureProps, VendorProductChangesRequestedEmail as never],
          ["staff-product-review-needed", fixtureProps, StaffProductReviewNeededEmail as never],
        ];
        for (const [name, props, component] of cases) {
          const entry = EMAIL_TEMPLATES[name as keyof typeof EMAIL_TEMPLATES] as unknown as {
            subject: (value: unknown) => string;
            text: (value: unknown) => string;
          };
          const html = await render(createElement(component as never, props as never));
          const text = entry.text(props);
          const subject = entry.subject(props);
          for (const value of Object.values(surrounding)) {
            expect(html).not.toContain(value);
            expect(text).not.toContain(value);
            expect(subject).not.toContain(value);
          }
          expect(subject).toMatch(/approved|rejected|changes requested|needs review/i);
          expect(subject).not.toMatch(/sale|offer|discount|free|!/i);
        }

        // The same holds for what a real decision sends, with canaries in the vendor and the SKU.
        const container = getContainer();
        const canaryVendor = await createActiveVendor(api, container, { label: `canary-${CANARY_VENDOR}` });
        const draft = await approveViaApi(
          api,
          container,
          approver.headers,
          canaryVendor,
          categoryId,
          `e4-${randomUUID().slice(0, 4)}`
        );
        await until(() => forTemplate("vendor-product-approved").length >= 1);
        for (const item of delivered) {
          const text = withoutRecipient(item).toLowerCase();
          expect(text).not.toContain(CANARY_VENDOR);
          expect(text).not.toContain(`${draft.suffix}-s`);
          expect(text).not.toContain(canaryVendor.vendor_id.toLowerCase());
          expect(text).not.toContain(draft.uploadId.toLowerCase());
        }
      });

      it("logs a failed send with the tag and never throws out of the subscriber", async () => {
        const container = getContainer();
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { error: (message: string) => void };
        const errors: string[] = [];
        jest.spyOn(logger, "error").mockImplementation((message: string) => {
          errors.push(String(message));
        });
        failNextSend = true;

        // The decision itself succeeds even though the email cannot be sent.
        await approveViaApi(api, container, approver.headers, vendorA, categoryId, `e5-${randomUUID().slice(0, 4)}`);
        await until(() => errors.some((line) => line.includes("[catalog-decision-emails]")));
        expect(errors.some((line) => line.includes("[catalog-decision-emails]"))).toBe(true);
        failNextSend = false;
      });
    });
  },
});
