import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  createActor,
  listAuditRows,
  probe,
  rawProbe,
  sleep,
  staffHeaders,
  unlinkedIdentityHeaders,
  waitForAuditEntry,
} from "../helpers/staff-users";

jest.setTimeout(120 * 1000);

const CANARY = "canary-body-value-123";
const INVITE_CANARY = "canary-invite-value-456";

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("audit writer", () => {
      test("a superadmin write is recorded with key names only", async () => {
        const container = getContainer();
        const user = await createActor(container, "superadmin");
        const headers = await staffHeaders(api, user);

        const result = await probe(api, headers, "POST", "/admin/product-tags", { value: CANARY });
        const requestId = String(result.headers["x-request-id"]);
        const entry = await waitForAuditEntry(container, (row) => row.request_id === requestId);

        expect(entry).not.toBeNull();
        expect(entry).toMatchObject({
          action: "admin.write",
          actor_type: "user",
          actor_label: user.email,
          http_method: "POST",
        });
        expect(entry?.roles).toContain("superadmin");
        expect(entry?.http_route).toBeTruthy();
        expect(entry?.target_type).toBe("product-tags");
        expect(entry?.meta?.body_keys).toEqual(expect.arrayContaining(["value"]));

        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain(CANARY);
        expect(serialized).not.toContain(headers.authorization.replace("Bearer ", ""));
      });

      test("a refused request is recorded as admin.denied with the denial code", async () => {
        const container = getContainer();
        const user = await createActor(container, "finance_readonly");
        const result = await probe(api, await staffHeaders(api, user), "POST", "/admin/products", {
          title: CANARY,
        });
        expect(result.status).toBe(403);

        const requestId = String(result.headers["x-request-id"]);
        const entry = await waitForAuditEntry(container, (row) => row.request_id === requestId);
        expect(entry).toMatchObject({ action: "admin.denied", http_status: 403 });
        expect(entry?.meta?.code).toBe("permission_denied");
        expect(JSON.stringify(entry)).not.toContain(CANARY);
      });

      test("a plain read by a superadmin is not recorded", async () => {
        const container = getContainer();
        const user = await createActor(container, "superadmin");
        const result = await probe(api, await staffHeaders(api, user), "GET", "/admin/orders");
        const requestId = String(result.headers["x-request-id"]);

        await sleep(600);
        const rows = await listAuditRows(container);
        expect(rows.filter((row) => row.request_id === requestId)).toEqual([]);
      });

      test("the forwarded header is stored raw and the address is not taken from it with no proxy hops", async () => {
        const container = getContainer();
        const user = await createActor(container, "superadmin");
        const headers = { ...(await staffHeaders(api, user)), "x-forwarded-for": "203.0.113.9" };

        const result = await probe(api, headers, "POST", "/admin/product-tags", { value: "x" });
        const requestId = String(result.headers["x-request-id"]);
        const entry = await waitForAuditEntry(container, (row) => row.request_id === requestId);

        expect(entry?.forwarded_for).toBe("203.0.113.9");
        expect(entry?.ip).toBeTruthy();
        expect(entry?.ip).not.toBe("203.0.113.9");
      });

      test("the invite accept route, which core authenticates itself, is recorded too", async () => {
        const container = getContainer();
        const headers = await unlinkedIdentityHeaders(container);

        const result = await probe(api, headers, "POST", "/admin/invites/accept?token=not-a-real-token", {
          first_name: INVITE_CANARY,
          last_name: "Tester",
        });
        const requestId = String(result.headers["x-request-id"]);
        const entry = await waitForAuditEntry(container, (row) => row.request_id === requestId);

        // Whatever status core answers, the attempt is on record.
        expect(entry).not.toBeNull();
        expect(entry?.action).toBe("admin.write");
        expect(entry?.http_route).toBe("/admin/invites/accept");
        expect(entry?.meta?.body_keys).toEqual(expect.arrayContaining(["first_name"]));
        expect(entry?.roles ?? []).toEqual([]);

        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain(INVITE_CANARY);
        expect(serialized).not.toContain(headers.authorization.replace("Bearer ", ""));
      });

      test("the same call with no token is not recorded", async () => {
        const container = getContainer();
        const result = await probe(api, {}, "POST", "/admin/invites/accept", {
          first_name: INVITE_CANARY,
        });
        expect(result.status).toBe(401);

        const requestId = String(result.headers["x-request-id"] ?? "");
        await sleep(600);
        const rows = await listAuditRows(container);
        expect(rows.filter((row) => requestId !== "" && row.request_id === requestId)).toEqual([]);
        expect(rows.some((row) => JSON.stringify(row).includes(INVITE_CANARY))).toBe(false);
      });

      test("a preflight request is not recorded", async () => {
        const container = getContainer();
        const before = (await listAuditRows(container)).length;
        await rawProbe(
          api,
          { origin: "http://localhost:9000", "access-control-request-method": "POST" },
          "OPTIONS",
          "/admin/products"
        );
        await sleep(600);
        expect((await listAuditRows(container)).length).toBe(before);
      });
    });
  },
});
