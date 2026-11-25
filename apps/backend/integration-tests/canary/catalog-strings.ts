// Distinctive fake values the catalog fixture puts into vendor-only places:
// declaration fields, vendor SKUs, the uploaded file name and the camera data
// inside the image. None of them may appear on any customer-facing surface.
// This file has no imports so the scanner, the fixture and the registry test
// can all read it.
export const CATALOG_CANARY = {
  vendor_sku: "CANARY-SKU-ALPHA-1",
  vendor_sku_second: "CANARY-SKU-ALPHA-2",
  packed_by_name: "Canary Packers Pvt Ltd",
  packed_by_address: "99 Canary Lane",
  generic_name: "Canary generic",
  image_name: "canary-vendor-photo.jpg",
  image_stem: "canary-vendor-photo",
  camera_make: "CanaryCam",
  camera_model: "CANARY-9000",
} as const;

export const CATALOG_CANARY_TOKENS: string[] = [
  CATALOG_CANARY.vendor_sku,
  CATALOG_CANARY.vendor_sku_second,
  CATALOG_CANARY.packed_by_name,
  CATALOG_CANARY.packed_by_address,
  CATALOG_CANARY.generic_name,
  CATALOG_CANARY.image_stem,
  CATALOG_CANARY.camera_make,
  CATALOG_CANARY.camera_model,
];

// The declaration strings that only the entered-declaration display mode may
// show. The default mode and the owner-text mode must never show them.
export const DECLARATION_CANARY_VALUES: string[] = [
  CATALOG_CANARY.packed_by_name,
  CATALOG_CANARY.packed_by_address,
  CATALOG_CANARY.generic_name,
];

// The surfaces this area registers. The registry test compares the registered
// ids with this list, so dropping a surface fails the suite.
export const CATALOG_SURFACE_IDS = [
  "storefront.product.html",
  "storefront.product.rsc",
  "storefront.product.jsonld",
  "storefront.product.image.url",
  "storefront.product.image.bytes",
  "storefront.sitemap.products",
  "storefront.llms",
  "store.products.starter-fields",
  "store.products.minimal-fields",
  "store.product.by-handle",
  "store.ship-from",
  "store.product-declarations",
  "store.search.q",
] as const;
