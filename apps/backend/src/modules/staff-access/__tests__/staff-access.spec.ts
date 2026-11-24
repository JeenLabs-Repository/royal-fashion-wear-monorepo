import { moduleIntegrationTestRunner } from "@medusajs/test-utils";
import { ROLE_DEFINITIONS, ROLE_KEYS } from "../../../lib/rbac/permissions";
import { STAFF_ACCESS_MODULE } from "../constants";
import BreakGlassReview from "../models/break-glass-review";
import StaffAssignment from "../models/staff-assignment";
import StaffRole from "../models/staff-role";
import type StaffAccessModuleService from "../service";

jest.setTimeout(60 * 1000);

moduleIntegrationTestRunner<StaffAccessModuleService>({
  moduleName: STAFF_ACCESS_MODULE,
  moduleModels: [StaffRole, StaffAssignment, BreakGlassReview],
  resolve: "./src/modules/staff-access",
  testSuite: ({ service }) => {
    describe("role sync", () => {
      it("creates the five roles", async () => {
        await service.syncRoles(ROLE_DEFINITIONS);
        const roles = await service.listStaffRoles({}, { take: null });
        expect(roles.map((role) => role.key).sort()).toEqual([...ROLE_KEYS].sort());
      });

      it("a second call changes nothing", async () => {
        await service.syncRoles(ROLE_DEFINITIONS);
        const before = await service.listStaffRoles({}, { take: null });
        const again = await service.syncRoles(ROLE_DEFINITIONS);
        const after = await service.listStaffRoles({}, { take: null });
        expect(again.created).toEqual([]);
        expect(again.updated).toEqual([]);
        expect(after).toHaveLength(before.length);
        expect(after.map((role) => role.id).sort()).toEqual(
          before.map((role) => role.id).sort()
        );
      });

      it("replaces a changed permission list and removes the stale grant", async () => {
        await service.syncRoles(ROLE_DEFINITIONS);
        const narrowed = ROLE_DEFINITIONS.map((definition) =>
          definition.key === "support"
            ? {
                ...definition,
                permissions: definition.permissions.filter(
                  (permission) => permission !== "finance:refund"
                ),
              }
            : definition
        );
        const result = await service.syncRoles(narrowed);
        expect(result.updated).toEqual(["support"]);
        const [support] = await service.listStaffRoles({ key: "support" });
        expect(support.permissions as unknown as string[]).not.toContain(
          "finance:refund"
        );
      });

      it("keeps a role that exists only in the database", async () => {
        await service.createStaffRoles([
          {
            key: "legacy_role",
            label: "Legacy",
            description: "kept",
            permissions: [] as unknown as Record<string, unknown>,
          },
        ]);
        const result = await service.syncRoles(ROLE_DEFINITIONS);
        expect(result.stale).toContain("legacy_role");
        const legacy = await service.listStaffRoles({ key: "legacy_role" });
        expect(legacy).toHaveLength(1);
      });
    });

    describe("assignments", () => {
      it("rejects a second row with the same user and role", async () => {
        await service.createStaffAssignments([
          { user_id: "user_dup", role_key: "support", assigned_by: "system" },
        ]);
        await expect(
          service.createStaffAssignments([
            { user_id: "user_dup", role_key: "support", assigned_by: "system" },
          ])
        ).rejects.toThrow();
      });

      it("rejects a second break-glass assignment", async () => {
        await service.createStaffAssignments([
          {
            user_id: "user_bg_one",
            role_key: "superadmin",
            is_break_glass: true,
            assigned_by: "cli",
          },
        ]);
        await expect(
          service.createStaffAssignments([
            {
              user_id: "user_bg_two",
              role_key: "superadmin",
              is_break_glass: true,
              assigned_by: "cli",
            },
          ])
        ).rejects.toThrow();
      });

      it("returns the union of two roles and no break-glass flag", async () => {
        await service.syncRoles(ROLE_DEFINITIONS);
        await service.createStaffAssignments([
          { user_id: "user_two", role_key: "catalog_approver", assigned_by: "system" },
          { user_id: "user_two", role_key: "support", assigned_by: "system" },
        ]);
        const access = await service.resolveEffectiveAccess("user_two");
        expect(access.roleKeys.sort()).toEqual(["catalog_approver", "support"]);
        expect(access.permissions).toContain("catalog:review");
        expect(access.permissions).toContain("returns:decide");
        expect(access.permissions).not.toContain("staff:manage");
        expect(access.isBreakGlass).toBe(false);
      });

      it("counts only non-break-glass superadmins among the given ids", async () => {
        await service.createStaffAssignments([
          { user_id: "user_sa_one", role_key: "superadmin", assigned_by: "cli" },
          {
            user_id: "user_sa_bg",
            role_key: "superadmin",
            is_break_glass: true,
            assigned_by: "cli",
          },
        ]);
        expect(
          await service.countNonBreakGlassSuperadmins([
            "user_sa_one",
            "user_sa_bg",
            "user_gone",
          ])
        ).toBe(1);
        expect(await service.countNonBreakGlassSuperadmins([])).toBe(0);
      });
    });

    describe("break-glass reviews", () => {
      it("rejects a second open review for one actor and accepts one after closing", async () => {
        const [first] = await service.createBreakGlassReviews([
          {
            opened_at: new Date(),
            actor_user_id: "user_bg",
            window_key: "bucket-1",
          },
        ]);
        await expect(
          service.createBreakGlassReviews([
            {
              opened_at: new Date(),
              actor_user_id: "user_bg",
              window_key: "bucket-2",
            },
          ])
        ).rejects.toThrow();

        await service.updateBreakGlassReviews([
          { id: first.id, closed_at: new Date(), closed_by: "user_other" },
        ]);
        const [second] = await service.createBreakGlassReviews([
          {
            opened_at: new Date(),
            actor_user_id: "user_bg",
            window_key: "bucket-3",
          },
        ]);
        expect(second.id).not.toBe(first.id);
      });
    });
  },
});
