import { planAssign, planRevoke } from "../staff-rules";

describe("planAssign", () => {
  test("a plain assignment is ok", () => {
    expect(planAssign({ currentRoles: [], role: "support", isBreakGlass: false })).toEqual({
      ok: true,
    });
  });

  test("a second non-superadmin role is ok", () => {
    expect(
      planAssign({ currentRoles: ["support"], role: "catalog_approver", isBreakGlass: false })
    ).toEqual({ ok: true });
  });

  test("all four non-superadmin roles together are ok", () => {
    expect(
      planAssign({
        currentRoles: ["support", "catalog_approver", "order_router"],
        role: "finance_readonly",
        isBreakGlass: false,
      })
    ).toEqual({ ok: true });
  });

  test("superadmin is refused when the user holds any other role", () => {
    expect(
      planAssign({ currentRoles: ["support"], role: "superadmin", isBreakGlass: false })
    ).toMatchObject({
      ok: false,
      code: "superadmin_exclusive",
      type: "NOT_ALLOWED",
    });
  });

  test("any role is refused when the user is already a superadmin", () => {
    for (const role of ["support", "catalog_approver", "order_router", "finance_readonly"]) {
      expect(planAssign({ currentRoles: ["superadmin"], role, isBreakGlass: false })).toMatchObject({
        ok: false,
        code: "superadmin_exclusive",
      });
    }
  });

  test("an unlisted role is unknown_role", () => {
    expect(planAssign({ currentRoles: [], role: "owner", isBreakGlass: false })).toMatchObject({
      ok: false,
      code: "unknown_role",
      type: "INVALID_DATA",
    });
  });

  test("a role the user already holds is already_assigned", () => {
    expect(
      planAssign({ currentRoles: ["support"], role: "support", isBreakGlass: false })
    ).toMatchObject({
      ok: false,
      code: "already_assigned",
      type: "INVALID_DATA",
    });
  });

  test("a break-glass target is refused whatever the role", () => {
    for (const role of ["superadmin", "support", "owner"]) {
      expect(
        planAssign({ currentRoles: ["superadmin"], role, isBreakGlass: true })
      ).toMatchObject({
        ok: false,
        code: "break_glass_protected",
        type: "NOT_ALLOWED",
      });
    }
  });
});

describe("planRevoke", () => {
  test("revoking a held role is ok", () => {
    expect(
      planRevoke({
        currentRoles: ["support", "order_router"],
        role: "support",
        isBreakGlass: false,
        otherSuperadminCount: 0,
      })
    ).toEqual({ ok: true });
  });

  test("revoking a role that is not held is not_assigned", () => {
    expect(
      planRevoke({
        currentRoles: ["support"],
        role: "order_router",
        isBreakGlass: false,
        otherSuperadminCount: 3,
      })
    ).toMatchObject({ ok: false, code: "not_assigned", type: "NOT_FOUND" });
  });

  test("a break-glass target is refused", () => {
    expect(
      planRevoke({
        currentRoles: ["superadmin"],
        role: "superadmin",
        isBreakGlass: true,
        otherSuperadminCount: 5,
      })
    ).toMatchObject({ ok: false, code: "break_glass_protected", type: "NOT_ALLOWED" });
  });

  test("the last non-break-glass superadmin cannot be revoked", () => {
    expect(
      planRevoke({
        currentRoles: ["superadmin"],
        role: "superadmin",
        isBreakGlass: false,
        otherSuperadminCount: 0,
      })
    ).toMatchObject({ ok: false, code: "last_superadmin", type: "CONFLICT" });
  });

  test("a superadmin can be revoked while another remains", () => {
    expect(
      planRevoke({
        currentRoles: ["superadmin"],
        role: "superadmin",
        isBreakGlass: false,
        otherSuperadminCount: 1,
      })
    ).toEqual({ ok: true });
  });

  test("the other-superadmin count only matters for the superadmin role", () => {
    expect(
      planRevoke({
        currentRoles: ["support"],
        role: "support",
        isBreakGlass: false,
        otherSuperadminCount: 0,
      })
    ).toEqual({ ok: true });
  });

  test("every failure carries a plain message", () => {
    const failure = planRevoke({
      currentRoles: ["superadmin"],
      role: "superadmin",
      isBreakGlass: false,
      otherSuperadminCount: 0,
    });
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.message.length).toBeGreaterThan(10);
    }
  });
});
