import { requireMfaEnrollment } from "../require-mfa-enrollment";
import { STAFF_MFA_ALLOWLIST } from "../index";
import type { AdminRequest } from "../../rbac/reject";

type Outcome = { nexted: boolean; status?: number; body?: Record<string, unknown> };

function run(
  gate: ReturnType<typeof requireMfaEnrollment>,
  request: { method: string; url: string; auth?: Record<string, unknown> | null }
): Outcome {
  const outcome: Outcome = { nexted: false };
  const res = {
    locals: {},
    status(code: number) {
      outcome.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      outcome.body = body;
      return this;
    },
  };
  const req = {
    method: request.method,
    originalUrl: request.url,
    url: request.url,
    auth_context: request.auth === null ? undefined : request.auth,
  } as unknown as AdminRequest;
  gate(req, res as never, () => {
    outcome.nexted = true;
  });
  return outcome;
}

const staffGate = () => requireMfaEnrollment("user", { allowlist: STAFF_MFA_ALLOWLIST });
const unenrolled = { actor_type: "user", actor_id: "user_1", mfa_enabled: false };
const enrolled = { actor_type: "user", actor_id: "user_1", mfa_enabled: true };

describe("requireMfaEnrollment for staff", () => {
  test("an unenrolled user is refused with mfa_enrollment_required", () => {
    const outcome = run(staffGate(), { method: "GET", url: "/admin/products", auth: unenrolled });
    expect(outcome.nexted).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.body).toMatchObject({ code: "mfa_enrollment_required" });
  });

  test("the refusal body has type, code and a message that points to Profile > Security", () => {
    const outcome = run(staffGate(), { method: "POST", url: "/admin/orders", auth: unenrolled });
    expect(Object.keys(outcome.body ?? {}).sort()).toEqual(["code", "message", "type"]);
    expect(String(outcome.body?.message)).toContain("Profile > Security");
  });

  test("an enrolled user passes", () => {
    const outcome = run(staffGate(), { method: "GET", url: "/admin/products", auth: enrolled });
    expect(outcome.nexted).toBe(true);
  });

  test("only a flag that is exactly true counts as enrolled", () => {
    for (const flag of ["true", 1, "yes", null, undefined]) {
      const outcome = run(staffGate(), {
        method: "GET",
        url: "/admin/products",
        auth: { actor_type: "user", mfa_enabled: flag },
      });
      expect(outcome.nexted).toBe(false);
    }
  });

  test("a caller of another actor type passes untouched", () => {
    for (const actorType of ["vendor", "customer", "api-key"]) {
      const outcome = run(staffGate(), {
        method: "GET",
        url: "/admin/products",
        auth: { actor_type: actorType, mfa_enabled: false },
      });
      expect(outcome.nexted).toBe(true);
    }
  });

  test("a request with no auth context is left to the authenticate step", () => {
    const outcome = run(staffGate(), { method: "GET", url: "/admin/products", auth: null });
    expect(outcome.nexted).toBe(true);
  });

  test.each([
    ["POST", "/auth/user/emailpass"],
    ["POST", "/auth/session"],
    ["GET", "/auth/mfa/factors"],
    ["POST", "/auth/mfa/verify"],
    ["GET", "/admin/users/me"],
    ["GET", "/admin/staff/me"],
  ])("an unenrolled user may call %s %s", (method, url) => {
    expect(run(staffGate(), { method, url, auth: unenrolled }).nexted).toBe(true);
  });

  test("the allowlist is method aware", () => {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      expect(run(staffGate(), { method, url: "/admin/users/me", auth: unenrolled }).nexted).toBe(
        false
      );
    }
    expect(run(staffGate(), { method: "POST", url: "/admin/staff/me", auth: unenrolled }).nexted).toBe(
      false
    );
  });

  test("double slashes, letter case and a query string do not change the outcome", () => {
    for (const url of ["//admin//users//me", "/Admin/Users/Me", "/admin/users/me/?x=1", "/admin/users/me;a=b"]) {
      expect(run(staffGate(), { method: "GET", url, auth: unenrolled }).nexted).toBe(true);
    }
    for (const url of ["//admin//products", "/ADMIN/Products?x=/admin/users/me"]) {
      expect(run(staffGate(), { method: "GET", url, auth: unenrolled }).nexted).toBe(false);
    }
  });

  test("a path the normaliser rejects is gated, not waved through", () => {
    for (const url of ["/admin/%2e%2e/users/me", "/admin/users/me%2f", "/admin/%zz"]) {
      expect(run(staffGate(), { method: "GET", url, auth: unenrolled }).nexted).toBe(false);
    }
  });

  test("an extra allowlist entry opens exactly that URL", () => {
    const gate = requireMfaEnrollment("user", {
      allowlist: [...STAFF_MFA_ALLOWLIST, { method: "GET", pattern: "/admin/store-name" }],
    });
    expect(run(gate, { method: "GET", url: "/admin/store-name", auth: unenrolled }).nexted).toBe(true);
    expect(run(gate, { method: "POST", url: "/admin/store-name", auth: unenrolled }).nexted).toBe(false);
  });

  test("nothing on the auth context exempts a caller, including a break-glass marker", () => {
    const outcome = run(staffGate(), {
      method: "GET",
      url: "/admin/products",
      auth: {
        actor_type: "user",
        actor_id: "user_bg",
        mfa_enabled: false,
        is_break_glass: true,
        app_metadata: { is_break_glass: true },
      },
    });
    expect(outcome.nexted).toBe(false);
    expect(outcome.body).toMatchObject({ code: "mfa_enrollment_required" });
  });
});

describe("requireMfaEnrollment reused for another actor type", () => {
  const vendorGate = () =>
    requireMfaEnrollment("vendor", { allowlist: [{ method: "GET", pattern: "/vendor/me" }] });

  test("ignores staff callers and gates vendor callers", () => {
    expect(run(vendorGate(), { method: "GET", url: "/vendor/orders", auth: unenrolled }).nexted).toBe(
      true
    );
    const vendor = { actor_type: "vendor", actor_id: "vendor_1", mfa_enabled: false };
    const refused = run(vendorGate(), { method: "GET", url: "/vendor/orders", auth: vendor });
    expect(refused.nexted).toBe(false);
    expect(refused.body).toMatchObject({ code: "mfa_enrollment_required" });
  });

  test("uses its own allowlist, plus the always-open auth routes", () => {
    const vendor = { actor_type: "vendor", actor_id: "vendor_1", mfa_enabled: false };
    expect(run(vendorGate(), { method: "GET", url: "/vendor/me", auth: vendor }).nexted).toBe(true);
    expect(run(vendorGate(), { method: "POST", url: "/auth/vendor/emailpass", auth: vendor }).nexted).toBe(
      true
    );
    expect(run(vendorGate(), { method: "GET", url: "/admin/users/me", auth: vendor }).nexted).toBe(false);
  });

  test("an enrolled vendor passes", () => {
    const vendor = { actor_type: "vendor", actor_id: "vendor_1", mfa_enabled: true };
    expect(run(vendorGate(), { method: "GET", url: "/vendor/orders", auth: vendor }).nexted).toBe(true);
  });
});
