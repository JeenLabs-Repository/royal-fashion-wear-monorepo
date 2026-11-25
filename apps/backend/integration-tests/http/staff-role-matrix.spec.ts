import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  ACTOR_KEYS,
  createActor,
  isAllowed,
  isDenied,
  probe,
  staffHeaders,
  type ActorKey,
} from "../helpers/staff-users";

jest.setTimeout(120 * 1000);

type Case = {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  /** Actors that must get past the permission layer. Everyone else must get 403. */
  allowed: readonly ActorKey[];
};

const EVERYONE = ACTOR_KEYS;

// Expected results come from the grants in the catalogue, not from reading the
// manifest. Ids such as order_x are fake on purpose: a 404 from the route after
// the permission layer counts as allowed.
const CASES: Case[] = [
  { method: "GET", path: "/admin/products", allowed: ["superadmin", "catalog_approver", "order_router", "finance_readonly"] },
  { method: "POST", path: "/admin/products", body: {}, allowed: ["superadmin"] },
  { method: "POST", path: "/admin/product-categories", body: { name: "x" }, allowed: ["superadmin", "catalog_approver"] },
  { method: "GET", path: "/admin/orders", allowed: ["superadmin", "order_router", "support", "finance_readonly"] },
  { method: "POST", path: "/admin/orders/order_x/cancel", body: {}, allowed: ["superadmin"] },
  { method: "DELETE", path: "/admin/customers/cus_x", allowed: ["superadmin"] },
  { method: "POST", path: "/admin/payments/pay_x/refund", body: {}, allowed: ["superadmin", "support"] },
  { method: "GET", path: "/admin/payments", allowed: ["superadmin", "finance_readonly"] },
  { method: "GET", path: "/admin/routing/queue", allowed: ["superadmin", "order_router", "support", "finance_readonly"] },
  { method: "POST", path: "/admin/routing/assign", body: {}, allowed: ["superadmin", "order_router"] },
  { method: "GET", path: "/admin/returns", allowed: ["superadmin", "order_router", "support"] },
  { method: "POST", path: "/admin/returns", body: {}, allowed: ["superadmin", "support"] },
  { method: "GET", path: "/admin/users", allowed: ["superadmin"] },
  { method: "GET", path: "/admin/integrations", allowed: ["superadmin"] },
  { method: "GET", path: "/admin/audit-log", allowed: ["superadmin"] },
  { method: "GET", path: "/admin/users/me", allowed: EVERYONE },
];

// Every mutating probe across the core and planned families. finance_readonly
// holds no mutation permission, so each of these must be refused.
const MUTATIONS: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
  { method: "POST", path: "/admin/products", body: {} },
  { method: "DELETE", path: "/admin/products/prod_x" },
  { method: "POST", path: "/admin/product-tags", body: { value: "x" } },
  { method: "POST", path: "/admin/orders/order_x/cancel", body: {} },
  { method: "POST", path: "/admin/draft-orders", body: {} },
  { method: "POST", path: "/admin/customers", body: {} },
  { method: "DELETE", path: "/admin/customers/cus_x" },
  { method: "POST", path: "/admin/payments/pay_x/refund", body: {} },
  { method: "POST", path: "/admin/payments/pay_x/capture", body: {} },
  { method: "POST", path: "/admin/routing/assign", body: {} },
  { method: "DELETE", path: "/admin/routing/assignments/asg_x" },
  { method: "POST", path: "/admin/returns", body: {} },
  { method: "POST", path: "/admin/price-lists", body: {} },
  { method: "POST", path: "/admin/regions", body: {} },
  { method: "PUT", path: "/admin/stock-locations/sloc_x", body: {} },
  { method: "POST", path: "/admin/shipping-options", body: {} },
];

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("role by endpoint matrix", () => {
      test.each(ACTOR_KEYS)("%s gets the expected result on every probe", async (key) => {
        const user = await createActor(getContainer(), key);
        const headers = await staffHeaders(api, user);

        const mismatches: string[] = [];
        for (const probeCase of CASES) {
          const result = await probe(api, headers, probeCase.method, probeCase.path, probeCase.body);
          const shouldPass = probeCase.allowed.includes(key);
          const ok = shouldPass ? isAllowed(result) : isDenied(result);
          if (!ok) {
            mismatches.push(
              `${key} ${probeCase.method} ${probeCase.path}: expected ${
                shouldPass ? "allowed" : "denied"
              }, got ${result.status} ${result.code ?? ""}`
            );
          }
        }
        expect(mismatches).toEqual([]);
      });

      test("a catalog approver is refused on routing while an order router passes the permission layer", async () => {
        const approver = await createActor(getContainer(), "catalog_approver");
        const router = await createActor(getContainer(), "order_router");

        const refused = await probe(api, await staffHeaders(api, approver), "POST", "/admin/routing/assign", {});
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("permission_denied");

        const passed = await probe(api, await staffHeaders(api, router), "POST", "/admin/routing/assign", {});
        expect(passed.status).not.toBe(403);
        expect(passed.status).not.toBe(401);
      });

      test("finance_readonly is refused on every mutating probe", async () => {
        expect(MUTATIONS.length).toBeGreaterThanOrEqual(8);
        const user = await createActor(getContainer(), "finance_readonly");
        const headers = await staffHeaders(api, user);

        const leaks: string[] = [];
        for (const mutation of MUTATIONS) {
          const result = await probe(api, headers, mutation.method, mutation.path, mutation.body);
          if (!isDenied(result)) {
            leaks.push(`${mutation.method} ${mutation.path}: got ${result.status} ${result.code ?? ""}`);
          }
        }
        expect(leaks).toEqual([]);
      });

      test("a user with no role is denied everywhere except the self route", async () => {
        const user = await createActor(getContainer(), "no_role");
        const headers = await staffHeaders(api, user);

        const denied = await probe(api, headers, "GET", "/admin/products");
        expect(denied.status).toBe(403);
        expect(denied.code).toBe("no_staff_role");

        const self = await probe(api, headers, "GET", "/admin/users/me");
        expect(isAllowed(self)).toBe(true);
      });
    });
  },
});
