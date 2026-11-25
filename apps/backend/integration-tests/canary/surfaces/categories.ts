import type { SurfaceKind } from "./registry";

// Everything a customer can see. The launch checks assert that nothing in this
// list is missing from the registry, so a forgotten area fails the build.
export const REQUIRED_KINDS: SurfaceKind[] = [
  "store-api",
  "storefront-html",
  "storefront-rsc",
  "storefront-json-ld",
  "sitemap",
  "llms-txt",
  "image",
  "email",
  "pdf",
  "tracking",
];

export const missingCategories = (registeredKinds: SurfaceKind[]): SurfaceKind[] =>
  REQUIRED_KINDS.filter((kind) => !registeredKinds.includes(kind));
