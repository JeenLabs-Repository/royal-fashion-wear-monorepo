import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  ACTOR_KEYS,
  createActor,
  probe,
  rawProbe,
  secretApiKeyHeaders,
  staffHeaders,
  type ActorKey,
} from "../helpers/staff-users";

jest.setTimeout(180 * 1000);

const METHODS = ["GET", "POST", "DELETE", "PUT", "PATCH"];

// Sent exactly as written, through node:http, so nothing rewrites them.
const VARIANTS = [
  "/admin/integrations",
  "/admin/integrations/",
  "/admin/integrations/anything",
  "/Admin/Integrations",
  "//admin//integrations",
  "/admin/%69ntegrations",
  "/admin/integrations;x=1",
];

// Statuses that count as a refusal for a variant. The chain normalises a path
// before it routes, so every variant above resolves to the integrations rule and
// answers 403. If the normaliser were to reject a variant instead, 400 would be
// accepted for that variant here, with a comment saying why.
const ACCEPTED: Record<string, number[]> = {
  // Observed: Express never matches /admin* for a leading double slash, so the
  // chain never runs and every actor (including superadmin) gets 404.
  "//admin//integrations": [403, 404],
};
const acceptedFor = (variant: string): number[] => ACCEPTED[variant] ?? [403];

// Spike S1: Gorgo list route lives at /admin/integrations (route.js under
// @gorgo/medusa-integration .../api/admin/integrations/).
const GORGO_LIST_PATH = "/admin/integrations";

const DENIED_ACTORS = ACTOR_KEYS.filter((key) => key !== "superadmin") as ActorKey[];

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("integrations lockdown", () => {
      test.each(DENIED_ACTORS)("%s is refused on every method and path variant", async (key) => {
        expect(VARIANTS.length).toBeGreaterThanOrEqual(7);
        const user = await createActor(getContainer(), key);
        const headers = await staffHeaders(api, user);

        const leaks: string[] = [];
        for (const variant of VARIANTS) {
          for (const method of METHODS) {
            const result = await rawProbe(api, headers, method, variant, method === "GET" ? undefined : {});
            if (!acceptedFor(variant).includes(result.status)) {
              leaks.push(`${key} ${method} ${variant}: got ${result.status} ${result.code ?? ""}`);
            }
          }
        }
        expect(leaks).toEqual([]);
      });

      test("a superadmin can read the list route", async () => {
        const user = await createActor(getContainer(), "superadmin");
        const headers = await staffHeaders(api, user);
        const result = await probe(api, headers, "GET", GORGO_LIST_PATH);
        expect(result.status).toBe(200);

        // Same double-slash form is 404 for superadmin too (never reaches the chain).
        const doubleSlash = await rawProbe(api, headers, "GET", "//admin//integrations");
        expect(doubleSlash.status).toBe(404);
      });

      test("a secret API key is refused on integrations and on every other admin route", async () => {
        const admin = await createActor(getContainer(), "superadmin");
        const keyHeaders = await secretApiKeyHeaders(api, await staffHeaders(api, admin));

        for (const path of ["/admin/integrations", "/admin/products", "/admin/users/me"]) {
          const result = await probe(api, keyHeaders, "GET", path);
          expect({ path, status: result.status, code: result.code }).toEqual({
            path,
            status: 403,
            code: "api_key_not_allowed",
          });
        }
      });

      test("an unauthenticated call gets 401", async () => {
        const result = await probe(api, {}, "GET", "/admin/integrations");
        expect(result.status).toBe(401);
      });
    });
  },
});
