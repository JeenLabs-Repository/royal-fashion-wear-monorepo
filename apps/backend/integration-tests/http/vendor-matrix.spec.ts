import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { getVendorOnboardingSettings } from "../../src/lib/settings/vendor-onboarding";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { getVendorSession } from "../helpers/mfa";
import { probe, rawProbe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import { toFormData } from "../helpers/multipart";
import { findMatrixProblems, loadFixtures } from "../matrix/runner";
import type { MatrixContext, MatrixEntry, MatrixVendor } from "../matrix/types";

jest.setTimeout(300_000);

const ROUTE_DIR = path.resolve(__dirname, "..", "..", "src", "api", "vendor");
const FIXTURE_DIR = path.resolve(__dirname, "..", "matrix");

const entries: MatrixEntry[] = [...loadFixtures(FIXTURE_DIR).values()].flat();

const is2xx = (status: number) => status >= 200 && status < 300;

// The runner empties the database after every test unless told otherwise, which
// would remove the vendors built once in beforeAll. The matrix builds its five
// vendors once and keeps them for the whole run. Its requests change nothing
// that a later request depends on (accepting the same agreement version twice is
// a no-op), so the tests stay order independent.
medusaIntegrationTestRunner({
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let ctx: MatrixContext;

    const send = async (
      entry: MatrixEntry,
      headers: Record<string, string>,
      options: {
        values?: Record<string, string>;
        body?: Record<string, unknown>;
        extraQuery?: Record<string, string>;
      } = {}
    ): Promise<{ status: number; data: Record<string, unknown> | undefined; code: string | undefined }> => {
      let url = entry.path;
      for (const [name, value] of Object.entries(options.values ?? {})) {
        url = url.replace(`:${name}`, encodeURIComponent(value));
      }
      const query = new URLSearchParams({
        ...(entry.query ?? {}),
        ...(options.extraQuery ?? {}),
      }).toString();
      const pathWithQuery = query ? `${url}?${query}` : url;
      const data =
        entry.method === "GET"
          ? undefined
          : entry.multipart
            ? toFormData(await entry.multipart(ctx), options.body)
            : (options.body ?? {});
      const result = await probe(api, headers, entry.method, pathWithQuery, data);
      return { status: result.status, data: result.body, code: result.code };
    };

    const ownValues = (entry: MatrixEntry): Record<string, string> =>
      Object.fromEntries(
        Object.entries(entry.idParams ?? {}).map(([name, make]) => [name, make(ctx)])
      );

    const missingValues = (entry: MatrixEntry): Record<string, string> =>
      Object.fromEntries(
        Object.keys(entry.idParams ?? {}).map((name) => [name, `matrix_missing_${name}`])
      );

    // Password change must re-auth with the acting vendor's own password. The
    // fixture body uses vendor A so a baseline leave credentials unchanged; the
    // matrix substitutes the acting vendor when another session hits the handler.
    const bodyOf = (
      entry: MatrixEntry,
      actor: MatrixVendor = ctx.vendors.a
    ): Record<string, unknown> => {
      if (entry.path === "/vendor/me/password") {
        return {
          current_password: actor.password,
          new_password: actor.password,
        };
      }
      return entry.body ? entry.body(ctx) : {};
    };

    const buildVendor = async (
      label: string,
      options: {
        status: "invited" | "active";
        locations: { state_code: string; pin: string }[];
        enrolled: boolean;
      }
    ): Promise<{ vendor: MatrixVendor; fixture: Awaited<ReturnType<typeof createVendorFixture>> }> => {
      const fixture = await createVendorFixture(getContainer(), {
        label,
        status: options.status,
        locations: options.locations,
      });
      const session = await getVendorSession(api, fixture, { enrolled: options.enrolled });
      return {
        fixture,
        vendor: {
          vendorId: fixture.vendor_id,
          userId: fixture.user_id,
          email: fixture.email,
          password: fixture.password,
          locationIds: fixture.locations.map((location) => location.id),
          locationCodes: fixture.locations.map((location) => location.code),
          headers: session.headers,
        },
      };
    };

    describe("vendor route matrix", () => {
      beforeAll(async () => {
        const a = await buildVendor("matrix-a", {
          status: "active",
          enrolled: true,
          locations: [
            { state_code: "IN-MH", pin: "400001" },
            { state_code: "IN-KA", pin: "560001" },
          ],
        });
        const b = await buildVendor("matrix-b", {
          status: "active",
          enrolled: true,
          locations: [{ state_code: "IN-DL", pin: "110001" }],
        });
        const c = await buildVendor("matrix-c", {
          status: "active",
          enrolled: true,
          locations: [{ state_code: "IN-TN", pin: "600001" }],
        });
        await suspendVendorWorkflow(getContainer()).run({
          input: {
            vendor_id: c.vendor.vendorId,
            reason: "Suspended by the vendor matrix",
            actor: { id: "matrix" },
          },
        });
        const d = await buildVendor("matrix-d", {
          status: "active",
          enrolled: false,
          locations: [{ state_code: "IN-GJ", pin: "380001" }],
        });
        const i = await buildVendor("matrix-i", {
          status: "invited",
          enrolled: true,
          locations: [{ state_code: "IN-RJ", pin: "302001" }],
        });

        const settings = await getVendorOnboardingSettings(getContainer());
        ctx = {
          vendors: { a: a.vendor, b: b.vendor, c: c.vendor, d: d.vendor, i: i.vendor },
          currentAgreementVersion: settings.current_agreement_version,
        };
      });

      it("has a fixture for every vendor route and exported method", () => {
        expect(findMatrixProblems(ROUTE_DIR, FIXTURE_DIR)).toEqual([]);
      });

      for (const entry of entries) {
        const label = `${entry.method} ${entry.path}`;

        if (entry.plugin) {
          it.skip(`${label}: ${entry.reason ?? "plugin placeholder"}`, () => undefined);
          continue;
        }

        if (entry.public) {
          it(`${label}: is reachable without credentials (not a 401)`, async () => {
            const response = await send(entry, {}, {
              values: ownValues(entry),
              body: bodyOf(entry),
            });
            expect(response.status).not.toBe(401);
          });
          continue;
        }

        it(`${label}: vendor A succeeds`, async () => {
          const response = await send(entry, ctx.vendors.a.headers, {
            values: ownValues(entry),
            body: bodyOf(entry, ctx.vendors.a),
          });
          expect(is2xx(response.status)).toBe(true);
        });

        if (entry.idParams) {
          it(`${label}: vendor B using A's ids gets the same 404 as a missing id`, async () => {
            const foreign = await send(entry, ctx.vendors.b.headers, {
              values: ownValues(entry),
              body: bodyOf(entry, ctx.vendors.b),
            });
            const missing = await send(entry, ctx.vendors.b.headers, {
              values: missingValues(entry),
              body: bodyOf(entry, ctx.vendors.b),
            });
            expect(foreign.status).toBe(404);
            expect(missing.status).toBe(404);
            expect(foreign.data?.message).toBe(missing.data?.message);
          });
        }

        it(`${label}: foreign vendor ids in the query are rejected or ignored`, async () => {
          const a = ctx.vendors.a;
          const response = await send(entry, ctx.vendors.b.headers, {
            values: ownValues(entry),
            body: bodyOf(entry, ctx.vendors.b),
            extraQuery: { vendor_id: a.vendorId, vendor_location_id: a.locationIds[0] },
          });
          if (response.status !== 400) {
            const text = JSON.stringify(response.data ?? {});
            for (const value of [a.vendorId, a.userId, ...a.locationIds, ...a.locationCodes]) {
              expect(text).not.toContain(value);
            }
          }
        });

        if (entry.method === "POST") {
          it(`${label}: an unknown body key is a 400`, async () => {
            const response = await send(entry, ctx.vendors.a.headers, {
              values: ownValues(entry),
              body: { ...bodyOf(entry, ctx.vendors.a), zz_unknown: "x" },
            });
            expect(response.status).toBe(400);
          });

          it(`${label}: a vendor id in the body is a 400`, async () => {
            const response = await send(entry, ctx.vendors.b.headers, {
              values: ownValues(entry),
              body: { ...bodyOf(entry, ctx.vendors.b), vendor_id: ctx.vendors.a.vendorId },
            });
            expect(response.status).toBe(400);
          });
        }

        it(`${label}: a suspended vendor gets 403 vendor_suspended`, async () => {
          const response = await send(entry, ctx.vendors.c.headers, {
            values: ownValues(entry),
            body: bodyOf(entry, ctx.vendors.c),
          });
          expect(response.status).toBe(403);
          expect(response.code).toBe("vendor_suspended");
        });

        it(`${label}: no credentials get 401`, async () => {
          const response = await send(entry, {}, {
            values: ownValues(entry),
            body: bodyOf(entry),
          });
          expect(response.status).toBe(401);
        });

        it(`${label}: a vendor without two-factor enrolment ${entry.mfaExempt ? "is allowed" : "gets 403 mfa_enrollment_required"}`, async () => {
          const response = await send(entry, ctx.vendors.d.headers, {
            values: ownValues(entry),
            body: bodyOf(entry, ctx.vendors.d),
          });
          if (entry.mfaExempt) {
            expect(is2xx(response.status)).toBe(true);
          } else {
            expect(response.status).toBe(403);
            expect(response.code).toBe("mfa_enrollment_required");
          }
        });

        it(`${label}: an invited vendor ${entry.onboardingRoute ? "is allowed" : "gets 403 vendor_not_active"}`, async () => {
          const response = await send(entry, ctx.vendors.i.headers, {
            values: ownValues(entry),
            body: bodyOf(entry, ctx.vendors.i),
          });
          if (entry.onboardingRoute) {
            expect(is2xx(response.status)).toBe(true);
          } else {
            expect(response.status).toBe(403);
            expect(response.code).toBe("vendor_not_active");
          }
        });
      }
    });

    // The backend serves the portal on the same hostname as the admin dashboard.
    // These requests prove a vendor session is no key to /admin and that the
    // portal route sets its strict policy. Run the whole file, not one test, so
    // the vendors built in beforeAll exist.
    describe("shared origin with the admin dashboard", () => {
      let portalDir: string;
      const previousDir = process.env.VENDOR_PORTAL_DIR;

      beforeAll(() => {
        portalDir = mkdtempSync(path.join(os.tmpdir(), "portal-origin-"));
        mkdirSync(path.join(portalDir, "assets"), { recursive: true });
        writeFileSync(path.join(portalDir, "index.html"), '<!doctype html><div id="root"></div>');
        process.env.VENDOR_PORTAL_DIR = portalDir;
      });

      afterAll(() => {
        rmSync(portalDir, { recursive: true, force: true });
        if (previousDir === undefined) {
          delete process.env.VENDOR_PORTAL_DIR;
        } else {
          process.env.VENDOR_PORTAL_DIR = previousDir;
        }
      });

      it.each(["/admin/users/me", "/admin/users", "/admin/products", "/admin/orders"])(
        "a vendor session is refused on %s",
        async (url) => {
          const response = await probe(api, ctx.vendors.a.headers, "GET", url);
          expect([401, 403]).toContain(response.status);
          expect(JSON.stringify(response.body ?? {})).not.toContain(ctx.vendors.a.email);
        }
      );

      it("a vendor session cannot write through /admin", async () => {
        const response = await probe(api, ctx.vendors.a.headers, "POST", "/admin/users", {
          email: "zz-matrix@example.test",
        });
        expect([401, 403]).toContain(response.status);
      });

      it("serves the portal without credentials and sets the strict policy", async () => {
        const response = await probe(api, {}, "GET", "/vendor-portal/");
        expect(response.status).toBe(200);
        const policy = String(response.headers["content-security-policy"] ?? "");
        expect(policy).toContain("default-src 'self'");
        expect(policy).toContain("frame-ancestors 'none'");
        expect(policy).toContain("script-src 'self'");
        expect(policy).not.toContain("unsafe-eval");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["referrer-policy"]).toBe("no-referrer");
      });

      it("does not let the portal route reach the admin through traversal", async () => {
        // The HTTP client normalises plain and %2e dot segments before sending, so the
        // forms below are the ones that reach the server as written. The shell check
        // sends the raw forms with --path-as-is.
        for (const url of [
          "/vendor-portal/..%2fadmin%2fusers%2fme",
          "/vendor-portal/%252e%252e/admin/users/me",
        ]) {
          const response = await rawProbe(api, ctx.vendors.a.headers, "GET", url);
          expect(response.status).toBe(404);
          expect(String(response.body ?? "")).not.toContain('id="root"');
        }
      });

      // Actor-mechanics record: POST /auth/vendor/emailpass returns 200 with body
      // key token. The portal keeps that token in page memory as a Bearer header
      // and must not set a cookie on the shared hostname.
      // Vendor D has not enrolled two-factor sign-in, so sign-in answers with the token itself.
      it("answers a vendor sign-in with a token and sets no cookie", async () => {
        const response = await probe(api, {}, "POST", "/auth/vendor/emailpass", {
          email: ctx.vendors.d.email,
          password: ctx.vendors.d.password,
        });
        expect(response.status).toBe(200);
        expect(typeof response.body?.token).toBe("string");
        expect(response.headers["set-cookie"]).toBeUndefined();
      });

      it("keeps /vendor/* an API route with the portal present", async () => {
        const response = await probe(api, ctx.vendors.a.headers, "GET", "/vendor/me");
        expect(response.status).toBe(200);
        expect(String(JSON.stringify(response.body))).not.toContain('id="root"');
      });
    });
  },
});

