import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  createStaffUser,
  mintStaffToken,
  probe,
  randomEmail,
  setMfaEnrolled,
  staffHeaders,
} from "../helpers/staff-users";

jest.setTimeout(120 * 1000);

const GATE_CODE = "mfa_enrollment_required";

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("two-step sign-in gate", () => {
      test("an unenrolled support user is refused on business routes", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("support"),
          roleKeys: ["support"],
          mfaEnrolled: false,
        });
        const headers = await staffHeaders(api, user);

        for (const [method, path] of [
          ["GET", "/admin/products"],
          ["POST", "/admin/products"],
          ["GET", "/admin/orders"],
          ["POST", "/admin/orders"],
        ]) {
          const result = await probe(api, headers, method, path, method === "POST" ? {} : undefined);
          expect({ method, path, status: result.status, code: result.code }).toEqual({
            method,
            path,
            status: 403,
            code: GATE_CODE,
          });
        }
      });

      test("the routes the enrolment screens need are not blocked by the gate", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("support"),
          roleKeys: ["support"],
          mfaEnrolled: false,
        });
        const headers = await staffHeaders(api, user);

        const me = await probe(api, headers, "GET", "/admin/users/me");
        expect(me.code).not.toBe(GATE_CODE);
        expect(me.status).toBe(200);

        // 200 once the staff route exists; never the gate code.
        const staffMe = await probe(api, headers, "GET", "/admin/staff/me");
        expect(staffMe.code).not.toBe(GATE_CODE);
        expect(staffMe.status).not.toBe(403);
      });

      test("signing in is still possible while unenrolled", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("support"),
          roleKeys: ["support"],
          mfaEnrolled: false,
        });
        const result = await probe(api, {}, "POST", "/auth/user/emailpass", {
          email: user.email,
          password: user.password,
        });
        expect(result.status).toBe(200);
        expect(typeof result.body?.token).toBe("string");
      });

      test("after enrolment the same request no longer gets the gate code", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("support"),
          roleKeys: ["support"],
          mfaEnrolled: false,
        });
        const before = await probe(api, await staffHeaders(api, user), "GET", "/admin/orders");
        expect(before.code).toBe(GATE_CODE);

        await setMfaEnrolled(getContainer(), user, true);
        const after = await probe(api, await staffHeaders(api, user), "GET", "/admin/orders");
        expect(after.code).not.toBe(GATE_CODE);
        expect(after.status).not.toBe(403);
      });

      test("the break-glass account is gated like everyone else", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("break-glass"),
          roleKeys: ["superadmin"],
          breakGlass: true,
          mfaEnrolled: false,
        });
        const result = await probe(api, await staffHeaders(api, user), "GET", "/admin/products");
        expect(result.status).toBe(403);
        expect(result.code).toBe(GATE_CODE);
      });

      test("a token for another actor type is not accepted on the admin routes", async () => {
        const user = await createStaffUser(getContainer(), {
          email: randomEmail("superadmin"),
          roleKeys: ["superadmin"],
        });
        const token = mintStaffToken(user, { actor_type: "customer" });
        const result = await probe(api, { authorization: `Bearer ${token}` }, "GET", "/admin/users/me");
        expect([401, 403]).toContain(result.status);
      });
    });
  },
});
