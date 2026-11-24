# Add Permissions for a New Admin Route

This guide shows how to add an admin route so it passes the default deny, appears in the audit log and has tests. You end with a green route check.

## Before You Start

Read [Staff Governance](../concepts/staff-governance.md). Keep every change for one route, permission, rule and test in the same commit.

## Add a Permission

1. Open `apps/backend/src/lib/rbac/permissions.ts`.
2. Add the string to the `PERMISSIONS` list in the form `resource:operation`, using lowercase letters and hyphens.
3. Add it to the grants of every role that needs it. Do not give superadmin-only strings to another role.
4. Update the role table in `docs/concepts/staff-governance.md`.
5. Run the unit test.

   ```sh
   pnpm --dir apps/backend run test:unit -- --testPathPattern=rbac/__tests__/permissions
   ```

   The test fails when a grant is not in the list or when a role gains a superadmin-only permission.

Declare a permission string only in this file. Other files use the constant or the manifest.

## Add the Manifest Rule

1. Open `apps/backend/src/lib/rbac/permission-manifest.ts`.
2. Add one rule per method and pattern.

   ```ts
   { method: "POST", pattern: "/admin/vendors/:id/suspend", permission: "vendors:manage" },
   ```

3. Follow these rules.
   - A mutating method never uses a read permission.
   - A longer, more specific pattern wins over a prefix family such as `/admin/vendors*`.
   - Name the guard `protect-staff-target` on any rule that changes a user or a staff assignment.
   - Use `self` only for a GET that exposes no business data, and add the path to the self list.
4. Run the route check.

   ```sh
   pnpm --dir apps/backend run check:admin-routes
   ```

   It prints each unmapped route as `METHOD pattern (source)` and fails until every route has a rule.
5. Add rows for the route to `apps/backend/integration-tests/http/staff-role-matrix.spec.ts`. List the roles that may call it and the roles that must get 403.

## Record an Audit Event

1. Add the action name to `apps/backend/src/lib/audit/actions.ts` in the form `<domain>.<verb>`.
2. Call `recordAudit` inside the workflow step that makes the change, or add `recordAuditStep` to the workflow. Pass the actor, the target and the before and after values.

   ```ts
   await recordAudit(container, {
     action: "vendor.suspended",
     actor: { id: userId, type: "user", label: email, roles },
     target: { type: "vendor", id: vendorId },
     before: { status: "active" },
     after: { status: "suspended" },
   })
   ```

3. Never write to the audit table directly and never pass a secret. The helper redacts keys that look secret, but you should not rely on that.

The request writer already records every non-GET admin request with key names only, so add `recordAudit` only when you need before and after values.

## Send an Email or a Staff Alert

To send a transactional email, add an entry to `apps/backend/src/emails/lib/templates.ts` with typed props, then call the helper.

```ts
await sendTemplatedEmail({
  container,
  template: "staff-alert",
  to: recipients,
  props: { subject, heading, lines },
  idempotencyKey: buildIdempotencyKey("vendor-suspended", vendorId, bucket),
  tag: "vendor-suspend",
})
```

The idempotency key has the shape `<kind>:<entity-id>:<bucket>`, so a repeated event sends nothing twice. The helper never throws and returns whether it sent.

To alert staff by role, call `sendStaffAlert` with the role keys. It resolves the recipients from the role assignments when it sends and leaves out the break-glass account.

```ts
await sendStaffAlert({
  container,
  kind: "vendor-suspended",
  roleKeys: ["order_router", "superadmin"],
  props: { subject, heading, lines },
  idempotencyKey: buildIdempotencyKey("vendor-suspended", vendorId, bucket),
})
```

## Gate Another Actor Type With MFA

Create a second gate with `requireMfaEnrollment` and give it the actor type and its own allowlist.

```ts
const vendorGate = requireMfaEnrollment("vendor", {
  allowlist: [{ method: "GET", pattern: "/vendor/me" }],
})
```

Give the new chain the same per-request existence check that the staff context performs, so a deleted actor's old token fails closed. Spread your matcher array into `apps/backend/src/api/middlewares.ts`. Do not add a second middleware file.

## What You Should See

- The route check exits 0.
- The role matrix spec passes with your rows.
- A call to the new route as a role without the permission answers 403.
- A mutation writes an entry that the Audit log page shows.
