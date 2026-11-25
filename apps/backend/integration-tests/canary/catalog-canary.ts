import axios from "axios";
import { enrollVendorMfa, loginVendorWithMfa } from "../helpers/mfa";
import { vendorBearer, vendorLogin } from "../helpers/vendor-fixtures";
import { makeExifJpeg } from "../support/make-exif-image";
import { validContent } from "../support/catalog-fixtures";
import type { SurfaceContext } from "./surfaces/registry";
import { CATALOG_CANARY } from "./catalog-strings";

// One approved product whose vendor-only fields carry the catalog canary
// strings, made through the real routes: an image upload through the real
// processing path, a draft, a submit, a staff approval and per-location stock.
// Nothing here uses the test-only approval shortcut.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = { request: (config: Record<string, unknown>) => Promise<{ status: number; data: any }> };
type Headers = Record<string, string>;

export type CatalogCanary = {
  productId: string;
  submissionId: string;
  handle: string;
  title: string;
  imageUrl: string;
  vendorSkus: string[];
  platformSkus: string[];
  locationCodes: string[];
};

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
// The local provider may put a timestamp in front and the S3 provider may add a 26-character suffix.
export const IMAGE_URL_PATTERN = new RegExp(`/products/(\\d+-)?${UUID_V4}(-[0-9A-Z]{26})?\\.webp$`);

const call = async (
  api: Api,
  method: string,
  url: string,
  headers: Headers,
  data?: unknown
): Promise<{ status: number; body: any }> => {
  const response = await api.request({
    method,
    url,
    headers,
    data,
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return { status: response.status, body: response.data };
};

const expectStatus = (result: { status: number; body: unknown }, wanted: number, label: string): void => {
  if (result.status !== wanted) {
    throw new Error(`${label} answered ${result.status}, expected ${wanted}: ${JSON.stringify(result.body).slice(0, 300)}`);
  }
};

const CHECKLIST = {
  no_identifying_text: true,
  no_watermark_or_logo: true,
  images_checked: true,
  declarations_reviewed: true,
  gst_and_hsn_set: true,
  selling_price_set: true,
};

export type SeedCatalogCanaryInput = {
  api: Api;
  vendorHeaders: Headers;
  approverHeaders: Headers;
  publishableKey: string;
  categoryId?: string;
  suffix?: string;
};

/**
 * Creates and approves the canary product, then stocks every owned location.
 * Returns the identifiers the checks need. Each call makes a new product.
 */
export const seedCatalogCanary = async (input: SeedCatalogCanaryInput): Promise<CatalogCanary> => {
  const { api, vendorHeaders, approverHeaders, publishableKey } = input;
  const suffix = input.suffix ?? `cat${Date.now().toString(36)}`;

  let categoryId = input.categoryId;
  if (!categoryId) {
    const categories = await call(api, "GET", "/vendor/categories", vendorHeaders);
    expectStatus(categories, 200, "GET /vendor/categories");
    categoryId = categories.body.categories?.[0]?.id;
    if (!categoryId) {
      throw new Error("No product category exists. Create one as the owner before seeding the catalog canary.");
    }
  }

  // Real upload path: a JPEG with GPS and a camera model, under the canary file name.
  const form = new FormData();
  const jpeg = await makeExifJpeg({ width: 600, height: 400, orientation: 1 });
  form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), CATALOG_CANARY.image_name);
  const upload = await call(api, "POST", "/vendor/uploads", vendorHeaders, form);
  expectStatus(upload, 200, "POST /vendor/uploads");
  const uploadId: string = upload.body.upload.id;

  const body = validContent({ uploadIds: [uploadId], categoryId, suffix });
  const skus = [CATALOG_CANARY.vendor_sku, CATALOG_CANARY.vendor_sku_second];
  body.variants = body.variants.map((variant: Record<string, unknown>, index: number) => ({
    ...variant,
    vendor_sku: `${skus[index] ?? `${CATALOG_CANARY.vendor_sku}-${index}`}-${suffix}`,
  }));
  body.declaration = {
    ...body.declaration,
    generic_name: CATALOG_CANARY.generic_name,
    packed_by_name: CATALOG_CANARY.packed_by_name,
    packed_by_address: CATALOG_CANARY.packed_by_address,
  };
  // The vendor SKU must still contain the canary string so a leak is found; the suffix keeps reruns apart.
  const vendorSkus: string[] = body.variants.map((variant: { vendor_sku: string }) => variant.vendor_sku);

  const created = await call(api, "POST", "/vendor/products", vendorHeaders, body);
  expectStatus(created, 201, "POST /vendor/products");
  const productId: string = created.body.product.id;

  expectStatus(await call(api, "POST", `/vendor/products/${productId}/submit`, vendorHeaders, {}), 200, "submit");

  const queue = await call(api, "GET", "/admin/product-reviews?tab=new&limit=25", approverHeaders);
  expectStatus(queue, 200, "GET /admin/product-reviews");
  const row = (queue.body.reviews as { id: string; title: string }[]).find((entry) => entry.title === body.title);
  if (!row) {
    throw new Error(`The submitted canary product "${body.title}" is not in the New tab of the review queue.`);
  }
  const submissionId = row.id;

  const detail = await call(api, "GET", `/admin/product-reviews/${submissionId}`, approverHeaders);
  expectStatus(detail, 200, "GET review detail");
  const contentHash: string = detail.body.review.content_hash;

  const approved = await call(api, "POST", `/admin/product-reviews/${submissionId}/approve`, approverHeaders, {
    content_hash: contentHash,
    checklist: CHECKLIST,
    gst_class: "GST-5",
    hsn: "6109",
    category_id: categoryId,
    prices: vendorSkus.map((vendor_sku) => ({ vendor_sku, selling_price: "249.00" })),
  });
  expectStatus(approved, 200, "approve");

  // Stock every owned location so the ship-from route has states to report.
  const stock = await call(api, "GET", `/vendor/inventory?limit=50&q=${encodeURIComponent(body.title)}`, vendorHeaders);
  expectStatus(stock, 200, "GET /vendor/inventory");
  const locationCodes: string[] = (stock.body.locations as { code: string }[]).map((location) => location.code);
  const variants = stock.body.variants as { variant_id: string; vendor_sku: string }[];
  const updates = variants
    .filter((variant) => vendorSkus.includes(variant.vendor_sku))
    .flatMap((variant) =>
      locationCodes.map((location_code) => ({ variant_id: variant.variant_id, location_code, stocked_quantity: 10 }))
    );
  if (updates.length === 0) {
    throw new Error("The approved canary product has no variant in the vendor stock list.");
  }
  expectStatus(await call(api, "PUT", "/vendor/inventory", vendorHeaders, { updates }), 200, "PUT /vendor/inventory");

  const store = await call(
    api,
    "GET",
    `/store/products?id=${productId}&fields=id,handle,title,*variants,*images`,
    { "x-publishable-api-key": publishableKey }
  );
  expectStatus(store, 200, "GET /store/products");
  const product = store.body.products?.[0];
  if (!product) {
    throw new Error("The approved canary product is not listed by the Store API.");
  }

  return {
    productId,
    submissionId,
    handle: product.handle,
    title: product.title,
    imageUrl: product.images?.[0]?.url ?? "",
    vendorSkus,
    platformSkus: (product.variants as { sku?: string }[]).map((variant) => String(variant.sku ?? "")),
    locationCodes,
  };
};

// The registry's collectors call this. The in-process spec stores its own
// product here; the live crawl seeds one through the HTTP routes on first use.
const memo = new Map<string, Promise<CatalogCanary>>();

export const setCatalogCanary = (context: SurfaceContext, value: CatalogCanary): void => {
  memo.set(context.manifestPath, Promise.resolve(value));
};

export const ensureCatalogCanary = (context: SurfaceContext): Promise<CatalogCanary> => {
  const existing = memo.get(context.manifestPath);
  if (existing) {
    return existing;
  }
  const seeded = seedCatalogCanaryLive(context);
  memo.set(context.manifestPath, seeded);
  return seeded;
};

type VendorCredentials = { email: string; password: string; totp_secret?: string };

// Canary vendors have email/password and an optional stored TOTP secret, not a
// mintable token_secret. Sign in the same way the plugin-placeholder surface does.
const vendorHeadersFromManifest = async (
  api: Api,
  alpha: VendorCredentials
): Promise<Headers> => {
  let secret = alpha.totp_secret;
  if (!secret) {
    const firstFactor = await vendorLogin(api as never, {
      email: alpha.email,
      password: alpha.password,
    });
    const enrolled = await enrollVendorMfa(api as never, firstFactor);
    secret = enrolled.secret;
  }
  const token = await loginVendorWithMfa(api as never, {
    email: alpha.email,
    password: alpha.password,
    secret,
  });
  return vendorBearer(token);
};

const seedCatalogCanaryLive = async (context: SurfaceContext): Promise<CatalogCanary> => {
  const manifest = context.manifest as unknown as {
    publishable_key: string;
    vendors: Record<string, VendorCredentials & Record<string, unknown>>;
    approver?: {
      id: string;
      email: string;
      password: string;
      identityId: string;
      roleKeys: string[];
      isBreakGlass: boolean;
      mfaEnrolled: boolean;
      tokenSecret: string;
    };
  };
  const alpha = manifest.vendors?.alpha;
  if (!alpha || !manifest.approver) {
    throw new Error(
      "The canary manifest needs `vendors.alpha` and an `approver` entry (the staff user fields the canary seed writes). Apply the catalog change to src/scripts/lib/canary-seed.ts, then run the canary seed again."
    );
  }

  const api = axios.create({ baseURL: context.backendUrl, validateStatus: () => true }) as unknown as Api;
  const { staffHeaders } = await import("../helpers/staff-users");
  const vendorHeaders = await vendorHeadersFromManifest(api, alpha);
  const approverHeaders = await staffHeaders(api as never, manifest.approver as never);

  return seedCatalogCanary({
    api,
    vendorHeaders,
    approverHeaders,
    publishableKey: manifest.publishable_key,
  });
};

