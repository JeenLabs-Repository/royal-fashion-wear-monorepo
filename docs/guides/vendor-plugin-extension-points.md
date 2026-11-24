# Extend the Vendor Module With a Plugin

This guide shows how a compliance plugin attaches to the vendor module without changing core code. You import from one path, register your handlers when your plugin loads, and the vendor workflows, the vendor API and the Admin pick them up.

## What a Plugin May and May Not Do

A plugin may block or allow activation, add rules to locations, react to suspension, keep its own data per vendor, add onboarding steps, add a link to the vendor page in the Admin and mount its own vendor and admin routes.

A plugin may not edit vendor tables, add columns to them, link its data to commerce models, import anything from this project except the public surface, or read a vendor id from a request. Vendor data must never reach a customer, so a plugin that returns vendor data goes through an allowlist serializer.

## Import From One Path

Import every extension point from `src/modules/vendor/public.ts`. The sections below name each export.

```ts
import {
  onVendorActivating,
  registerOnboardingStep,
  registerVendorAdminSection,
} from "src/modules/vendor/public";
```

The file only re-exports, so importing it registers nothing. A plugin registers its handlers by calling the functions.

## The Seven Extension Points

### 1. Workflow Hooks

Three hooks cover the lifecycle. Each helper takes a handler and an optional compensation function.

- `onVendorActivating` runs before activation and reactivation change anything. The payload is `{ vendor_id, trigger }` where `trigger` is `activation` or `reactivation`.
- `onVendorLocationValidating` runs before a location is created or updated. The payload is `{ vendor_id, operation, location_id, proposed }`.
- `onVendorSuspended` runs after the vendor is suspended and unlinked from the sales channel. The payload is `{ vendor_id, reason }`.

Every handler also receives `{ container }`. Several handlers can attach to one hook. They run in the order they attached.

### 2. Plain-Id Data Models

Keep plugin data in your own module with a plain `vendor_id` column and, where needed, a plain `vendor_location_id` column. Do not link your models to vendor or commerce models. A link would make vendor data reachable through the Store API field expansion, which the anonymity rules forbid.

### 3. Public Utilities

- `authenticateVendor` is the vendor request chain as an array of middleware, for routes you mount outside `/vendor`.
- `requireVendor` returns the vendor of the request. Use it instead of reading an id from the request.
- `assertOwns` answers not found for a resource that belongs to another vendor.
- `defineAllowlistSerializer` builds the only kind of response serializer a vendor, store or document response may use.
- `recordAudit` writes an audit entry from a workflow step.
- `VENDOR_MODULE` is the key of the vendor module service.

### 4. Admin Sections

Call `registerVendorAdminSection({ key, title, path })` once. The vendor page shows the section as a link under Plugin sections. The path is inside the Admin, starts with one slash and may contain `:vendorId`, which becomes the vendor's id. A path that points to another site, uses a scheme or contains `..` is refused when you register it.

### 5. Onboarding Steps

Call `registerOnboardingStep` with a key, a title, `required_for_activation`, an optional portal path in `link` and an `isComplete` function. A required step that is not complete blocks activation and shows its title to the owner. The portal shows an unknown step as a plain row that links to your path. A step whose check throws counts as incomplete, so one broken plugin cannot break the list.

### 6. The Plugin Settings Card

Ship your own settings card in the settings plugin repository, and read its values at call time through a typed reader in the app, as the settings card page describes. Do not read settings in a constructor.

### 7. Manifest Entries for Admin Routes

Every admin route a plugin adds needs a rule in the permission manifest in the same change. A route with no rule is open to the superadmin only, and the route check fails the build until you map it.

## Worked Example

The test stub plugin in `integration-tests/stubs/vendor-compliance-stub` uses only the public surface. The calls below are taken from it.

```ts
onVendorActivating(async ({ vendor_id }) => {
  if (!(await taxDetailsVerified(vendor_id))) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Compliance check pending: tax details not verified"
    );
  }
});

registerOnboardingStep({
  key: "compliance",
  title: "Complete compliance details",
  required_for_activation: true,
  link: "/compliance",
  isComplete: async ({ vendor }) => taxDetailsVerified(vendor.id),
});

registerVendorAdminSection({
  key: "compliance",
  title: "Compliance",
  path: "/vendors/:vendorId/compliance",
});
```

The first call blocks activation with a message the owner reads as written. The second adds a required step that the owner sees on the vendor page. The third adds the link.

## Where Handlers Load and When They Register

In production, register by placing a file under `src/workflows/hooks` that calls the helpers, or by calling them from a second module's loader. In tests, call the helpers at the top of a Jest HTTP spec before the application starts. Those three places are discovered at boot, load time and test time respectively. Importing `public.ts` alone registers nothing.

## What a Thrown Error Does

An error thrown in an activation or location handler stops the workflow and rolls back earlier steps, so a blocked activation or location change leaves nothing written. The error message reaches the owner unchanged. Throw a `MedusaError` with a message written for a person.

A suspension handler runs after the status change and the sales channel unlink. When it throws, those earlier steps roll back and the vendor returns to the status it had before the suspend call. Write suspension handlers defensively anyway, because a failed cleanup still surfaces as an error to the owner.

## Mount Vendor Routes

Mount plugin routes for vendors under `/vendor/compliance/*`. The vendor request chain already covers that prefix, so a route there is unreachable without a sign-in, two-step sign-in and an active vendor, even before you write the route. Three more rules apply to every plugin route.

- Add a fixture for the route to the cross-vendor matrix so the isolation tests cover it.
- Add a surface for the route to the canary registry when a customer can reach it.
- Take the vendor from `requireVendor` and never from the body, query or path.

## Names Stay Stable

The names exported from `public.ts` are a published contract. A test pins the list. Renaming or removing a name needs a deprecation note in this guide and a replacement that keeps the old name working for one release.

## Where the Compliance Plugin Will Live

The compliance plugin will live in its own repository, `medusa-vendor-compliance`, and is built later. How it consumes this surface, as a published package or a shared package, is decided when it is extracted. Until then the stub plugin in the integration tests is the proof that the surface is enough.
