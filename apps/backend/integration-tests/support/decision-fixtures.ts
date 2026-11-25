import type { MedusaContainer } from "@medusajs/framework/types";
import { contentHash } from "../../src/lib/catalog/content-snapshot";
import { loadEffectiveSnapshot } from "../../src/lib/catalog/load-content";
import { createStaffUser, probe, staffHeaders, type ApiClient } from "../helpers/staff-users";
import { catalogService, createDraftFor, type ActiveVendor } from "./catalog-fixtures";

type Row = Record<string, any>;

export const FULL_CHECKLIST = {
  no_identifying_text: true,
  no_watermark_or_logo: true,
  images_checked: true,
  declarations_reviewed: true,
  gst_and_hsn_set: true,
  selling_price_set: true,
};

// Customer prices used by the helpers, one per variant of `validContent`: both are below the MRP
// of 299.00 and 319.00 and above the payout prices of 199.99 and 209.50.
export const SELLING_PRICES = ["249.00", "259.50"];

/** A staff user with the given roles and an enrolled, authenticated session. */
export async function makeApprover(
  api: ApiClient,
  container: MedusaContainer,
  roleKeys: string[] = ["catalog_approver"]
): Promise<{ id: string; email: string; headers: Record<string, string> }> {
  const user = await createStaffUser(container, { roleKeys });
  const headers = (await staffHeaders(api, user)) as Record<string, string>;
  return { id: user.id, email: user.email, headers };
}

/** The hash the review detail returns for a submission: the hash of its effective snapshot. */
export async function currentHash(container: MedusaContainer, submissionId: string): Promise<string> {
  return contentHash(await loadEffectiveSnapshot(container, submissionId));
}

export async function readSubmission(container: MedusaContainer, productId: string): Promise<Row> {
  const [row] = await catalogService(container).listProductSubmissions(
    { product_id: productId },
    { take: 1 }
  );
  return row as Row;
}

export type SubmittedDraft = {
  productId: string;
  submissionId: string;
  uploadId: string;
  suffix: string;
  body: Row;
  hash: string;
};

/** A valid draft created and submitted through the vendor routes. */
export async function submitDraft(
  api: ApiClient,
  container: MedusaContainer,
  vendor: ActiveVendor,
  categoryId: string,
  suffix: string
): Promise<SubmittedDraft> {
  const draft = await createDraftFor(api, container, vendor, categoryId, suffix);
  if (!draft.productId) {
    throw new Error(`Creating the draft failed with status ${draft.result.status}`);
  }
  const submitted = await probe(api, vendor.headers, "POST", `/vendor/products/${draft.productId}/submit`);
  if (submitted.status !== 200) {
    throw new Error(`Submitting the draft failed with status ${submitted.status}`);
  }
  const row = await readSubmission(container, draft.productId);
  return {
    productId: draft.productId,
    submissionId: String(row.id),
    uploadId: draft.upload.id,
    suffix: suffix,
    body: draft.body,
    hash: await currentHash(container, String(row.id)),
  };
}

/** The approve body for a draft made by `validContent`, with the shared prices and checklist. */
export function approveBodyFor(
  draft: Pick<SubmittedDraft, "body" | "hash">,
  categoryId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    content_hash: draft.hash,
    checklist: FULL_CHECKLIST,
    gst_class: "GST-5",
    hsn: "6109",
    category_id: categoryId,
    prices: (draft.body.variants as Row[]).map((variant, index) => ({
      vendor_sku: variant.vendor_sku,
      selling_price: SELLING_PRICES[index] ?? "249.00",
    })),
    ...overrides,
  };
}

/** Submit and approve through the real routes. Fails loudly when the approval is refused. */
export async function approveViaApi(
  api: ApiClient,
  container: MedusaContainer,
  approverHeaders: Record<string, string>,
  vendor: ActiveVendor,
  categoryId: string,
  suffix: string
): Promise<SubmittedDraft> {
  const draft = await submitDraft(api, container, vendor, categoryId, suffix);
  const response = await probe(
    api,
    approverHeaders,
    "POST",
    `/admin/product-reviews/${draft.submissionId}/approve`,
    approveBodyFor(draft, categoryId)
  );
  if (response.status !== 200) {
    throw new Error(`Approving the draft failed with status ${response.status} ${response.code ?? ""}`);
  }
  return draft;
}
