import { randomUUID } from "node:crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  linkProductsToSalesChannelWorkflow,
  createProductCategoriesWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import { appendCredentialEntry } from "../../../../e2e/support/credentials-log";
import { VENDOR_CATALOG_MODULE } from "../../src/modules/vendor-catalog";
import type VendorCatalogService from "../../src/modules/vendor-catalog/service";
import { getVendorSession } from "../helpers/mfa";
import { probe, type ApiClient } from "../helpers/staff-users";
import {
  createVendorFixture,
  ensureDefaultSalesChannel,
  type FixtureLocationSpec,
  type VendorFixture,
} from "../helpers/vendor-fixtures";

export type ActiveVendor = VendorFixture & { headers: Record<string, string> };

type Row = Record<string, any>;

export const catalogService = (container: MedusaContainer) =>
  container.resolve<VendorCatalogService>(VENDOR_CATALOG_MODULE);

// Demo data goes to the untracked credentials file. A failed write never fails a test.
function recordDemo(what: string, flow: string, reset: string, values = "none"): void {
  try {
    appendCredentialEntry({ section: "Catalog test data", what, flow, reset, values });
  } catch {
    // The file is a convenience for manual checks only.
  }
}

/**
 * An active vendor with the agreement accepted, an enrolled session and its locations.
 * Reuses the shared vendor fixture; there is no second creation path.
 */
export async function createActiveVendor(
  api: ApiClient,
  container: MedusaContainer,
  options: { label?: string; extraLocations?: FixtureLocationSpec[] } = {}
): Promise<ActiveVendor> {
  const label = options.label ?? `catalog-${randomUUID().slice(0, 6)}`;
  const fixture = await createVendorFixture(container, {
    label,
    status: "active",
    locations: [{ state_code: "IN-MH", pin: "400001" }, ...(options.extraLocations ?? [])],
  });
  const headers = await vendorSession(api, fixture);
  recordDemo(
    `Demo vendor ${fixture.email}, ${fixture.locations.length} location(s)`,
    "catalog fixtures: createActiveVendor",
    "drop the test database; the vendor lives only there",
    `password ${fixture.password}`
  );
  return { ...fixture, headers };
}

/** Headers of an enrolled session for a fixture vendor. */
export async function vendorSession(
  api: ApiClient,
  fixture: VendorFixture,
  options: { enrolled?: boolean } = {}
): Promise<Record<string, string>> {
  const session = await getVendorSession(api, fixture, { enrolled: options.enrolled ?? true });
  return session.headers;
}

export async function createCategory(
  container: MedusaContainer,
  options: { name?: string; is_active?: boolean; is_internal?: boolean } = {}
): Promise<string> {
  const { result } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: options.name ?? `Demo Category ${randomUUID().slice(0, 6)}`,
          is_active: options.is_active ?? true,
          is_internal: options.is_internal ?? false,
        },
      ],
    },
  });
  return String((result as Row[])[0].id);
}

/** An upload row as the upload route would leave it, with a synthetic URL. */
export async function createUploadRow(
  container: MedusaContainer,
  vendorId: string
): Promise<{ id: string; url: string }> {
  const key = `products/${randomUUID()}.webp`;
  const url = `https://files.example.test/${key}`;
  const created = await catalogService(container).createVendorUploads([
    { vendor_id: vendorId, file_key: key, url },
  ] as never);
  const row = (Array.isArray(created) ? created[0] : created) as { id: string };
  recordDemo(
    `Demo upload ${key} for vendor ${vendorId}`,
    "catalog fixtures: createUploadRow",
    "drop the test database"
  );
  return { id: String(row.id), url };
}

export type ValidContentOptions = {
  uploadIds: string[];
  categoryId: string;
  /** Prefix of the vendor SKUs and part of the title; keep it unique per call. */
  suffix?: string;
  overrides?: Record<string, unknown>;
};

/**
 * A body that passes the strict content schema: one option with two values, two variants,
 * the declaration and a category. The first variant's payout price is exactly 199.99.
 */
export function validContent(options: ValidContentOptions): Record<string, any> {
  const suffix = options.suffix ?? randomUUID().slice(0, 8);
  return {
    title: `Demo Cotton T-Shirt ${suffix}`,
    description: "Soft demo cotton t-shirt.\nMachine washable.",
    images: options.uploadIds.map((upload_id) => ({ upload_id })),
    options: [{ title: "Size", values: ["S", "M"] }],
    variants: [
      {
        vendor_sku: `${suffix}-S`,
        option_values: { Size: "S" },
        payout_price: "199.99",
        mrp: "299.00",
        net_quantity_value: 1,
        net_quantity_unit: "pcs",
        weight_g: 250,
      },
      {
        vendor_sku: `${suffix}-M`,
        option_values: { Size: "M" },
        payout_price: "209.50",
        mrp: "319.00",
        net_quantity_value: 1,
        net_quantity_unit: "pcs",
        weight_g: 260,
      },
    ],
    proposed_category_id: options.categoryId,
    proposed_gst_class: "GST-5",
    proposed_hsn: "6109",
    declaration: {
      generic_name: "Cotton T-Shirt",
      country_of_origin: "IN",
      packed_by_name: "Demo Packing Works",
      packed_by_address: "1 Demo Street, Mumbai 400001",
    },
    ...(options.overrides ?? {}),
  };
}

/** Posts a body to the create route with a vendor session. */
export async function createDraftViaApi(
  api: ApiClient,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const result = await probe(api, headers, "POST", "/vendor/products", body);
  const product = (result.body as { product?: { id?: string } } | undefined)?.product;
  if (result.status === 201 && product?.id) {
    recordDemo(
      `Demo draft product ${product.id}`,
      "catalog fixtures: createDraftViaApi",
      "drop the test database"
    );
  }
  return result;
}

/** A vendor with one upload and one valid draft; returns the pieces tests need. */
export async function createDraftFor(
  api: ApiClient,
  container: MedusaContainer,
  vendor: ActiveVendor,
  categoryId: string,
  suffix?: string
) {
  const upload = await createUploadRow(container, vendor.vendor_id);
  const body = validContent({ uploadIds: [upload.id], categoryId, suffix });
  const result = await createDraftViaApi(api, vendor.headers, body);
  const product = (result.body as { product?: { id: string } }).product;
  return { result, body, upload, productId: product?.id as string };
}

/**
 * Test-only: marks a draft approved and live without the review workflow, publishes the core
 * product and links it to the default sales channel through core workflows. Later specs
 * use the real approval instead.
 */
export async function forceApprove(container: MedusaContainer, productId: string): Promise<void> {
  const service = catalogService(container);
  const [submission] = await service.listProductSubmissions({ product_id: productId }, { take: 1 });
  await service.updateProductSubmissions({
    id: submission.id,
    state: "approved",
    is_live: true,
    approved_content_hash: submission.content_hash,
    decided_at: new Date(),
  });
  const channelId = await ensureDefaultSalesChannel(container);
  await updateProductsWorkflow(container).run({
    input: { selector: { id: productId }, update: { status: "published" } as never },
  });
  await linkProductsToSalesChannelWorkflow(container).run({
    input: { id: channelId, add: [productId] },
  });
}

type Query = { graph(config: Record<string, unknown>): Promise<{ data: Row[] }> };

export const queryOf = (container: MedusaContainer) =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

/** Store API call with the publishable key. */
export function storeGet(api: ApiClient, publishableKey: string, path: string) {
  return api.get(path, {
    headers: { "x-publishable-api-key": publishableKey },
    validateStatus: () => true,
  });
}

// --- matrix seeds ---

/** Values the matrix fixtures read lazily; the seed function fills them. */
export const matrixCatalog = {
  categoryId: "",
  createUploadId: "",
  detailProductId: "",
};

/**
 * Creates the rows the matrix fixtures of the catalog routes point at. Call it once from the
 * matrix spec after the vendor context is built.
 */
export async function seedCatalogMatrix(input: {
  api: ApiClient;
  container: MedusaContainer;
  vendorA: ActiveVendor;
}): Promise<void> {
  const { api, container, vendorA } = input;
  matrixCatalog.categoryId = await createCategory(container, { name: "Matrix Category" });
  matrixCatalog.createUploadId = (await createUploadRow(container, vendorA.vendor_id)).id;
  const detail = await createDraftFor(
    api,
    container,
    vendorA as ActiveVendor,
    matrixCatalog.categoryId,
    "matrix-detail"
  );
  matrixCatalog.detailProductId = detail.productId;
}

// --- matrix seeds end ---
