// The recipients are read when the first break-glass request arrives, so the
// variable has to be set before the test app boots. One address keeps the
// notification call counts equal to the number of emails.
process.env.BREAK_GLASS_ALERT_EMAILS = "owner-alerts@example.test";

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resetAlertWindowForTests } from "../../src/lib/break-glass/alert-window";
import { STAFF_ACCESS_MODULE } from "../../src/modules/staff-access";
import breakGlassReviewReminderJob from "../../src/jobs/break-glass-review-reminder";
import {
  createActor,
  createStaffUser,
  listAuditRows,
  probe,
  randomEmail,
  sleep,
  staffHeaders,
  waitForAuditEntry,
  type StaffUser,
} from "../helpers/staff-users";

jest.setTimeout(180 * 1000);

type Review = { id: string; actor_user_id: string; closed_at: Date | string | null };

type StaffAccessApi = {
  listBreakGlassReviews(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<Review[]>;
  createBreakGlassReviews(rows: Array<Record<string, unknown>>): Promise<Review[]>;
  deleteBreakGlassReviews(ids: string[]): Promise<unknown>;
  listStaffAssignments(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<unknown[]>;
};

const REMINDER_RECIPIENT = "owner-alerts@example.test";

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const stopAt = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) {
      return true;
    }
    if (Date.now() >= stopAt) {
      return false;
    }
    await sleep(50);
  }
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let notificationSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    const staffService = () => getContainer().resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);

    const clearReviews = async () => {
      const rows = await staffService().listBreakGlassReviews({}, { take: null });
      if (rows.length > 0) {
        await staffService().deleteBreakGlassReviews(rows.map((row) => row.id));
      }
    };

    // The mail calls for one template. If the notification service the request
    // sees is not the instance resolved here, spy on its prototype instead.
    const callsFor = (template: string) =>
      notificationSpy.mock.calls.filter((call) => {
        const argument = call[0] as unknown;
        const items = Array.isArray(argument) ? argument : [argument];
        return items.some((item) => (item as { template?: string })?.template === template);
      });

    const breakGlass = async (): Promise<{ user: StaffUser; headers: { authorization: string } }> => {
      const user = await createStaffUser(getContainer(), {
        email: randomEmail("break-glass"),
        roleKeys: ["superadmin"],
        breakGlass: true,
      });
      return { user, headers: await staffHeaders(api, user) };
    };

    beforeEach(async () => {
      process.env.BREAK_GLASS_ALERT_EMAILS = "owner-alerts@example.test";
      const container = getContainer();
      // Spy the prototype so every request-scope resolve of the notification
      // service is covered, not only the instance resolved in this hook.
      const notification = container.resolve(Modules.NOTIFICATION) as {
        createNotifications: (...a: unknown[]) => unknown;
      };
      notificationSpy = jest
        .spyOn(Object.getPrototypeOf(notification), "createNotifications")
        .mockResolvedValue([] as never);
      errorSpy = jest.spyOn(
        container.resolve(ContainerRegistrationKeys.LOGGER) as { error: (...a: unknown[]) => void },
        "error"
      );
      await clearReviews();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("alerting", () => {
      test("the first request sends one email, opens one review, writes one entry and logs the ERROR line", async () => {
        const { user, headers } = await breakGlass();

        const result = await probe(api, headers, "GET", "/admin/orders");
        expect(result.status).not.toBe(401);

        expect(await waitFor(() => callsFor("break-glass-used").length >= 1)).toBe(true);
        await sleep(300);
        expect(callsFor("break-glass-used")).toHaveLength(1);
        const sent = JSON.stringify(callsFor("break-glass-used")[0][0]);
        expect(sent).toContain(REMINDER_RECIPIENT);

        const reviews = await staffService().listBreakGlassReviews({ actor_user_id: user.id, closed_at: null });
        expect(reviews).toHaveLength(1);

        const used = await waitFor(async () =>
          (await listAuditRows(getContainer())).some(
            (row) => row.action === "break_glass.used" && row.actor_id === user.id
          )
        );
        expect(used).toBe(true);
        expect(
          errorSpy.mock.calls.some((call) => String(call[0]).includes("[break-glass] USED"))
        ).toBe(true);
        // No secret in the ERROR line.
        expect(errorSpy.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
          headers.authorization.replace("Bearer ", "")
        );
      });

      test("a second request in the window sends nothing new, but both reads are audited", async () => {
        const { user, headers } = await breakGlass();

        const first = await probe(api, headers, "GET", "/admin/orders");
        const second = await probe(api, headers, "GET", "/admin/orders");
        await waitFor(() => callsFor("break-glass-used").length >= 1);
        await sleep(400);

        expect(callsFor("break-glass-used")).toHaveLength(1);
        const rows = await listAuditRows(getContainer());
        expect(rows.filter((row) => row.action === "break_glass.used" && row.actor_id === user.id)).toHaveLength(1);
        expect(await staffService().listBreakGlassReviews({ actor_user_id: user.id })).toHaveLength(1);

        for (const response of [first, second]) {
          const requestId = String(response.headers["x-request-id"]);
          const entry = await waitForAuditEntry(getContainer(), (row) => row.request_id === requestId);
          expect(entry?.action).toBe("admin.read");
        }
      });

      test("two simultaneous first requests give one email, one review and one entry", async () => {
        const { user, headers } = await breakGlass();

        await Promise.all([
          probe(api, headers, "GET", "/admin/orders"),
          probe(api, headers, "GET", "/admin/products"),
        ]);
        await waitFor(() => callsFor("break-glass-used").length >= 1);
        await sleep(500);

        expect(callsFor("break-glass-used")).toHaveLength(1);
        expect(await staffService().listBreakGlassReviews({ actor_user_id: user.id })).toHaveLength(1);
        const rows = await listAuditRows(getContainer());
        expect(rows.filter((row) => row.action === "break_glass.used" && row.actor_id === user.id)).toHaveLength(1);
      });

      test("after the window is reset the next request alerts again, with the same single open review", async () => {
        const { user, headers } = await breakGlass();

        await probe(api, headers, "GET", "/admin/orders");
        expect(await waitFor(() => callsFor("break-glass-used").length >= 1)).toBe(true);
        await resetAlertWindowForTests(getContainer(), user.id);

        await probe(api, headers, "GET", "/admin/orders");
        expect(
          await waitFor(
            () =>
              callsFor("break-glass-used").length >= 2 ||
              errorSpy.mock.calls.filter((call) => String(call[0]).includes("[break-glass] USED"))
                .length >= 2,
            5000
          )
        ).toBe(true);
        expect(
          errorSpy.mock.calls.filter((call) => String(call[0]).includes("[break-glass] USED"))
        ).toHaveLength(2);
        expect(await staffService().listBreakGlassReviews({ actor_user_id: user.id, closed_at: null })).toHaveLength(1);
      });

      test("a normal superadmin request raises no alert", async () => {
        const user = await createActor(getContainer(), "superadmin");
        await probe(api, await staffHeaders(api, user), "GET", "/admin/orders");
        await sleep(500);
        expect(callsFor("break-glass-used")).toHaveLength(0);
        expect(await staffService().listBreakGlassReviews({})).toHaveLength(0);
      });

      test("with no recipients outside production the review, the entry and the ERROR line still happen", async () => {
        delete process.env.BREAK_GLASS_ALERT_EMAILS;
        const { user, headers } = await breakGlass();

        await probe(api, headers, "GET", "/admin/orders");
        await sleep(600);

        expect(callsFor("break-glass-used")).toHaveLength(0);
        expect(await staffService().listBreakGlassReviews({ actor_user_id: user.id })).toHaveLength(1);
        expect(
          (await listAuditRows(getContainer())).some(
            (row) => row.action === "break_glass.used" && row.actor_id === user.id
          )
        ).toBe(true);
        expect(
          errorSpy.mock.calls.some((call) => String(call[0]).includes("[break-glass] USED"))
        ).toBe(true);
      });
    });

    describe("closing a review", () => {
      const openReview = async () => {
        const bg = await breakGlass();
        await probe(api, bg.headers, "GET", "/admin/orders");
        await waitFor(async () => (await staffService().listBreakGlassReviews({ actor_user_id: bg.user.id })).length === 1);
        const [review] = await staffService().listBreakGlassReviews({ actor_user_id: bg.user.id });
        return { ...bg, review };
      };

      const closer = async () => {
        const user = await createActor(getContainer(), "superadmin");
        return { user, headers: await staffHeaders(api, user) };
      };

      const note = "Credentials rotated and checked";

      test("the break-glass account itself cannot close its own review", async () => {
        const { headers, review } = await openReview();
        const result = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note,
        });
        expect(result.status).toBe(400);
        expect(result.code).toBe("same_account");
      });

      test("a short note or an unconfirmed rotation is a 400", async () => {
        const { review } = await openReview();
        const { headers } = await closer();
        const short = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note: "too short",
        });
        expect(short.status).toBe(400);
        const unconfirmed = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: false,
          note,
        });
        expect(unconfirmed.status).toBe(400);
        const extra = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note,
          closed_by: "someone-else",
        });
        expect(extra.status).toBe(400);
        expect(extra.code).toBe("invalid_body");
      });

      test("another superadmin closes it with a valid body, and a second close conflicts", async () => {
        const { review } = await openReview();
        const { user, headers } = await closer();

        const closed = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note,
        });
        expect(closed.status).toBe(200);
        expect((closed.body?.review as { closed_by?: string })?.closed_by).toBe(user.id);

        const entry = await waitForAuditEntry(
          getContainer(),
          (row) => row.action === "break_glass.reviewed" && row.target_id === review.id
        );
        expect(entry).not.toBeNull();
        expect(entry?.actor_id).toBe(user.id);
        expect(JSON.stringify(entry)).not.toContain(note);
        expect(entry?.meta).toEqual({ note_length: note.length });

        const again = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note,
        });
        expect(again.status).toBe(409);
        expect(again.code).toBe("already_closed");

        const open = await probe(api, headers, "GET", "/admin/staff/break-glass-reviews");
        expect((open.body?.reviews as unknown[]).length).toBe(0);
        const all = await probe(api, headers, "GET", "/admin/staff/break-glass-reviews?status=all");
        expect((all.body?.reviews as unknown[]).length).toBe(1);
      });

      test("a support user gets 403 on the list and close routes", async () => {
        const { review } = await openReview();
        const support = await createActor(getContainer(), "support");
        const headers = await staffHeaders(api, support);

        const list = await probe(api, headers, "GET", "/admin/staff/break-glass-reviews");
        expect(list.status).toBe(403);
        const close = await probe(api, headers, "POST", `/admin/staff/break-glass-reviews/${review.id}/close`, {
          rotated_confirmed: true,
          note,
        });
        expect(close.status).toBe(403);
      });
    });

    describe("the daily reminder job", () => {
      const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

      test("a review open for 25 hours triggers one email and a 2-hour-old one triggers none", async () => {
        const bg = await breakGlass();
        const [old] = await staffService().createBreakGlassReviews([
          { opened_at: hoursAgo(25), actor_user_id: "user_seed_old", window_key: "seed-old" },
        ]);
        const assignmentsBefore = await staffService().listStaffAssignments({ user_id: bg.user.id });

        await breakGlassReviewReminderJob(getContainer());

        const calls = callsFor("break-glass-review-reminder");
        expect(calls).toHaveLength(1);
        const payload = JSON.stringify(calls[0][0]);
        expect(payload).toContain(REMINDER_RECIPIENT);
        expect(payload).toContain(`break-glass-reminder:${old.id}:`);
        expect(payload).toContain("25");

        // The account and its assignments are never touched.
        expect(await staffService().listStaffAssignments({ user_id: bg.user.id })).toEqual(assignmentsBefore);

        await clearReviews();
        notificationSpy.mockClear();
        await staffService().createBreakGlassReviews([
          { opened_at: hoursAgo(2), actor_user_id: "user_seed_new", window_key: "seed-new" },
        ]);
        await breakGlassReviewReminderJob(getContainer());
        expect(callsFor("break-glass-review-reminder")).toHaveLength(0);
      });

      test("a closed old review triggers nothing", async () => {
        await staffService().createBreakGlassReviews([
          {
            opened_at: hoursAgo(60),
            actor_user_id: "user_seed_closed",
            window_key: "seed-closed",
            closed_at: hoursAgo(50),
            closed_by: "user_other",
            rotated_confirmed: true,
            note: "Closed in an earlier run",
          },
        ]);
        await breakGlassReviewReminderJob(getContainer());
        expect(callsFor("break-glass-review-reminder")).toHaveLength(0);
      });

      test("the job file schedules itself for 03:30 UTC, which is 09:00 India time", async () => {
        const { config } = await import("../../src/jobs/break-glass-review-reminder.js");
        expect(config.schedule).toBe("30 3 * * *");
      });
    });
  },
});
