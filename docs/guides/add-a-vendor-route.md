# Add a Vendor Route

This guide explains the steps to add a route under `/vendor`, so it is isolated from other vendors, rejects unknown input and is covered by the automatic checks.

## Know What the Chain Does

Every path under `/vendor`, including paths that no route serves yet, passes through the same chain before your handler runs. It authenticates the vendor user, requires two-factor enrolment, loads the vendor and checks its status on every request, and records an audit entry for writes. The only exception is the invitation route.

- An unauthenticated request gets 401, even on a path that does not exist yet.
- An authenticated and active vendor gets 404 on a path that does not exist.
- A suspended vendor gets 403 with the code `vendor_suspended` on every route.
- An invited vendor gets 403 with the code `vendor_not_active` unless the route is an onboarding route.
- A vendor that has not enrolled two-factor sign-in gets 403 with the code `mfa_enrollment_required` unless the route is exempt.

## Follow the Checklist

1. Write a strict schema for the body or the query with `z.strictObject` and wire it in `src/lib/vendor/middlewares.ts`. An unknown key must be a 400.
2. Keep the handler thin. Call a workflow for every write.
3. Take the vendor from `requireVendor(req)`. Never read a vendor id from the body, the query or the path.
4. Call `assertOwns` for every resource id you load. A missing resource and a resource of another vendor must both answer 404 with the same message, so the response never says that a resource exists.
5. Return data through an allowlist serializer under `src/lib/serializers/vendor/`. Never return a module record directly.
6. Decide whether an invited vendor may call the route. The default is no. To allow it, add the route to `ONBOARDING_ROUTES` in `src/lib/vendor/status-guard.ts` and extend its unit test.
7. Decide whether a vendor without two-factor enrolment may call the route. The default is no. To allow it, add the route to the two-factor allowlist in `src/lib/vendor/authenticate-vendor.ts`.
8. Add the matrix fixture, described below.
9. Add a canary surface if anything a customer can see changes. See [Add a Canary Surface](add-a-canary-surface.md).
10. Add a Playwright spec for every portal screen that uses the route. A portal screen may call only `/vendor/*`, `/auth/vendor/*` and `/auth/mfa/*`; the portal keeps its token in page memory only, so a browser spec reaches a screen by clicking a link or by a client-side route change after sign-in, never by a fresh page load; the portal's request helper refuses every other path, so a new route must live under `/vendor`.
11. Update the documentation in the same change.

## Add the Matrix Fixture

The cross-vendor matrix scans every `route.ts` under `src/api/vendor` and fails when a route or an exported method has no fixture. It also fails when a handler exports PUT or PATCH.

Name the fixture after the route: take the path below `/vendor`, join the segments with two underscores and write a dynamic segment `:name` as `_name_`. So `me/locations` is `me__locations.ts`, `accept-invite` is `accept-invite.ts` and `things/:id` is `things___id_.ts`. Put the file in `apps/backend/integration-tests/matrix`.

A fixture exports an array of entries as its default export.

```ts
import type { MatrixEntry } from "./types";

const entries: MatrixEntry[] = [
  {
    method: "POST",
    path: "/vendor/things/:id/archive",
    idParams: { id: (context) => context.vendors.a.locationIds[0] },
    body: () => ({ reason: "Archived by the matrix" }),
    onboardingRoute: false,
  },
];

export default entries;
```

- `method` and `path` are required and must match the route file.
- `idParams` gives vendor A's value for each dynamic segment. The matrix proves that vendor B gets 404 for them, identical to a missing id.
- `body` returns a valid body for vendor A. The matrix adds an unknown key and a vendor id and expects 400.
- `mfaExempt` and `onboardingRoute` repeat the decisions from the checklist.
- `public` is only for the invitation route.
- `plugin` marks a placeholder for routes a plugin will register.

For every authenticated entry the matrix checks these cases: vendor A succeeds, vendor B cannot reach A's data, foreign vendor ids in the query are rejected or ignored, unknown body keys are rejected, a suspended vendor is refused, a request without credentials is refused, and the two-factor and invited cases follow your flags.

## Plugin Routes

A plugin mounts its vendor routes under `/vendor/compliance`. They pass through the same chain and need the same fixtures. While no plugin route exists, the placeholder fixture `plugin__compliance.ts` is skipped. Once a real route file exists under `src/api/vendor/compliance`, the matrix fails until you replace the placeholder with real fixtures.

## Run the Checks

```sh
pnpm -C apps/backend run test:unit -- --testPathPattern=runner
pnpm -C apps/backend run test:integration:http -- --testPathPattern=vendor-matrix
```
