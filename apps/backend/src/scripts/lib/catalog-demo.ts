import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";
import sharp from "sharp";
import { resolveRoleRecipients } from "../../lib/alerts/send-staff-alert";
import { contentHash } from "../../lib/catalog/content-snapshot";
import { ensureGstProductTypes } from "../../lib/catalog/ensure-gst-types";
import { getCatalogService, getQuery, loadEffectiveSnapshot } from "../../lib/catalog/load-content";
import { ensureHubLocation, readHubEnvironment } from "../../lib/hub/ensure-hub-location";
import { processImage } from "../../lib/images/process-image";
import { getVendorModule } from "../../lib/vendor/vendor-module";
import { approveProductWorkflow } from "../../workflows/catalog/approve-product";
import { requestChangesWorkflow } from "../../workflows/catalog/request-changes";
import { vendorCreateProductWorkflow } from "../../workflows/catalog/vendor-create-product";
import { vendorRecordUploadWorkflow } from "../../workflows/catalog/vendor-record-upload";
import { vendorSubmitProductWorkflow } from "../../workflows/catalog/vendor-submit-product";
import { vendorUpdateProductWorkflow } from "../../workflows/catalog/vendor-update-product";
import { createVendorLocationWorkflow } from "../../workflows/vendors/create-vendor-location";
import { setVendorStockWorkflow } from "../../workflows/stock/set-vendor-stock";

// Run with: pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts --catalog
// (the hook in seed-vendors.ts calls seedCatalogDemo). Needs the test-data seed (a catalog
// approver) and the demo vendor seed to have run. Everything is created through the same
// workflows the routes use, never by direct writes.

type Row = Record<string, any>;

const TAG = "[seed-vendors:catalog]";
const ACTOR = { id: "seed-vendors-catalog", label: "seed-vendors-catalog" };
const CHECKLIST = {
  no_identifying_text: true,
  no_watermark_or_logo: true,
  images_checked: true,
  declarations_reviewed: true,
  gst_and_hsn_set: true,
  selling_price_set: true,
};

type VariantPlan = { sku: string; size: string; payout: string; mrp: string; selling: string };

type ProductPlan = {
  title: string;
  vendor: "alpha" | "bravo";
  state: "approved" | "submitted" | "changes_requested" | "draft" | "approved_with_pending_edit";
  category: "Demo Apparel" | "Demo Home";
  color: { r: number; g: number; b: number };
  variants: VariantPlan[];
  /** Stock to set after approval: variant index, location index, quantity. */
  stock?: [number, number, number][];
};

const PLANS: ProductPlan[] = [
  {
    title: "Demo Alpha Cotton Tee",
    vendor: "alpha",
    state: "approved",
    category: "Demo Apparel",
    color: { r: 200, g: 80, b: 60 },
    variants: [
      { sku: "DEMO-A1-S", size: "S", payout: "199.99", mrp: "299.00", selling: "249.00" },
      { sku: "DEMO-A1-M", size: "M", payout: "209.50", mrp: "319.00", selling: "259.50" },
    ],
    stock: [
      [0, 0, 20],
      [0, 1, 8],
    ],
  },
  {
    title: "Demo Alpha Rain Jacket",
    vendor: "alpha",
    state: "submitted",
    category: "Demo Apparel",
    color: { r: 60, g: 120, b: 200 },
    variants: [{ sku: "DEMO-A2-M", size: "M", payout: "899.00", mrp: "1499.00", selling: "1199.00" }],
  },
  {
    title: "Demo Alpha Wool Scarf",
    vendor: "alpha",
    state: "changes_requested",
    category: "Demo Apparel",
    color: { r: 90, g: 160, b: 90 },
    variants: [{ sku: "DEMO-A3-M", size: "M", payout: "299.00", mrp: "499.00", selling: "399.00" }],
  },
  {
    title: "Demo Alpha Canvas Cap",
    vendor: "alpha",
    state: "draft",
    category: "Demo Apparel",
    color: { r: 160, g: 160, b: 60 },
    variants: [{ sku: "DEMO-A4-M", size: "M", payout: "149.00", mrp: "249.00", selling: "199.00" }],
  },
  {
    title: "Demo Alpha Fleece Hoodie",
    vendor: "alpha",
    state: "approved_with_pending_edit",
    category: "Demo Apparel",
    color: { r: 120, g: 60, b: 160 },
    variants: [{ sku: "DEMO-A5-M", size: "M", payout: "599.00", mrp: "999.00", selling: "799.00" }],
  },
  {
    title: "Demo Bravo Canvas Sneakers",
    vendor: "bravo",
    state: "approved",
    category: "Demo Apparel",
    color: { r: 60, g: 60, b: 60 },
    variants: [
      { sku: "DEMO-B1-S", size: "S", payout: "799.00", mrp: "1299.00", selling: "999.00" },
      { sku: "DEMO-B1-M", size: "M", payout: "799.00", mrp: "1299.00", selling: "999.00" },
    ],
    stock: [
      [0, 0, 0],
      [1, 0, 6],
    ],
  },
];

const word = (made: boolean): string => (made ? "created" : "exists");

// The hash the review detail returns: the hash of the effective snapshot. Decisions compare
// against it, so the seed reads it the same way.
const currentHashOf = async (container: MedusaContainer, submissionId: string): Promise<string> =>
  contentHash(await loadEffectiveSnapshot(container, submissionId));

async function findProductByTitle(container: MedusaContainer, title: string): Promise<Row | undefined> {
  const { data } = await getQuery(container).graph({
    entity: "product",
    fields: ["id", "title"],
    filters: { title },
  });
  return data[0];
}

async function ensureCategory(container: MedusaContainer, name: string, log: (line: string) => void) {
  const { data } = await getQuery(container).graph({
    entity: "product_category",
    fields: ["id", "name"],
    filters: { name },
  });
  if (data[0]) {
    log(`category ${name}: exists`);
    return String(data[0].id);
  }
  const { result } = await createProductCategoriesWorkflow(container).run({
    input: { product_categories: [{ name, is_active: true, is_internal: false }] },
  });
  log(`category ${name}: created`);
  return String((result as Row[])[0].id);
}

async function findVendor(container: MedusaContainer, internalName: string) {
  const vendors = getVendorModule(container);
  const [vendor] = (await vendors.listVendors({ internal_name: internalName }, { take: 1 })) as Row[];
  if (!vendor) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `${TAG} ${internalName} does not exist. Run the demo vendor seed first: pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts`
    );
  }
  const [user] = (await vendors.listVendorUsers({ vendor_id: vendor.id }, { take: 1 })) as Row[];
  return { vendor, user };
}

// Alpha needs Maharashtra and Karnataka locations, Bravo one in Delhi. Missing ones are
// created through the location workflow, which allocates the opaque codes.
async function ensureLocations(
  container: MedusaContainer,
  vendorId: string,
  wanted: { state_code: string; pin: string; label: string }[],
  log: (line: string) => void
): Promise<Row[]> {
  const vendors = getVendorModule(container);
  const existing = (await vendors.listVendorLocations({ vendor_id: vendorId }, { take: null })) as Row[];
  for (const spec of wanted) {
    if (existing.some((location) => location.state_code === spec.state_code)) {
      continue;
    }
    await createVendorLocationWorkflow(container).run({
      input: {
        vendor_id: vendorId,
        label: spec.label,
        state_code: spec.state_code,
        pin: spec.pin,
        address_1: "1 Demo Warehouse Road",
        city: "Demo City",
        pickup_contact_name: "Demo Pickup Desk",
        pickup_contact_phone: "+919000000001",
        actor: { id: ACTOR.id, label: ACTOR.label },
      },
    });
    log(`location ${spec.state_code} for ${vendorId}: created`);
  }
  const all = (await vendors.listVendorLocations({ vendor_id: vendorId }, { take: null, order: { code: "ASC" } })) as Row[];
  // Order the wanted states first so stock plans can address them by index.
  return wanted
    .map((spec) => all.find((location) => location.state_code === spec.state_code))
    .filter((location): location is Row => Boolean(location));
}

async function makeUpload(container: MedusaContainer, vendorId: string, userId: string, color: Row): Promise<string> {
  const base = sharp({ create: { width: 640, height: 640, channels: 3, background: color as never } }).jpeg({ quality: 85 });
  // A fake camera tag proves the real pipeline strips metadata.
  const tagged = (base as unknown as { withExif?: (value: unknown) => typeof base }).withExif;
  const source = tagged ? tagged.call(base, { IFD0: { Make: "DemoCam" } }) : base;
  const processed = await processImage(await source.toBuffer());
  const { result } = await vendorRecordUploadWorkflow(container).run({
    input: {
      vendor_id: vendorId,
      vendor_user_id: userId,
      image_base64: processed.data.toString("base64"),
    },
  });
  return String((result as Row).id);
}

const contentFor = (plan: ProductPlan, uploadId: string, categoryId: string, title = plan.title) => ({
  title,
  description: `${title}. A plain demo product made by the demo seed.`,
  images: [{ upload_id: uploadId }],
  options: [{ title: "Size", values: plan.variants.map((variant) => variant.size) }],
  variants: plan.variants.map((variant) => ({
    vendor_sku: variant.sku,
    option_values: { Size: variant.size },
    payout_price: variant.payout,
    mrp: variant.mrp,
    net_quantity_value: 1,
    net_quantity_unit: "pcs" as const,
    weight_g: 300,
  })),
  proposed_category_id: categoryId,
  proposed_gst_class: "GST-5" as const,
  proposed_hsn: "6109",
  declaration: {
    generic_name: "Demo Garment",
    country_of_origin: "IN",
    packed_by_name: "Demo Packing Works",
    packed_by_address: "1 Demo Street, Mumbai 400001",
  },
});

export async function seedCatalogDemo(container: MedusaContainer): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${TAG} Refusing to run in production.`);
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const log = (line: string) => logger.info(`${TAG} ${line}`);

  // 1. Shared setup.
  await ensureGstProductTypes(container);
  const hubEnv = readHubEnvironment(process.env);
  const hub = await ensureHubLocation(container, {
    address: hubEnv.address,
    shippingPriceInr: hubEnv.shippingPriceInr,
  });
  log(`hub ${hub.stockLocationId}: ${word(hub.created)}`);
  const categories = {
    "Demo Apparel": await ensureCategory(container, "Demo Apparel", log),
    "Demo Home": await ensureCategory(container, "Demo Home", log),
  };

  // 2. Vendors and locations.
  const alpha = await findVendor(container, "Demo Vendor Alpha");
  const bravo = await findVendor(container, "Demo Vendor Bravo");
  const alphaLocations = await ensureLocations(
    container,
    alpha.vendor.id,
    [
      { state_code: "IN-MH", pin: "400001", label: "Demo Mumbai Warehouse" },
      { state_code: "IN-KA", pin: "560001", label: "Demo Bengaluru Warehouse" },
    ],
    log
  );
  const bravoLocations = await ensureLocations(
    container,
    bravo.vendor.id,
    [{ state_code: "IN-DL", pin: "110001", label: "Demo Delhi Warehouse" }],
    log
  );
  const vendors = { alpha: { ...alpha, locations: alphaLocations }, bravo: { ...bravo, locations: bravoLocations } };

  // The approver is the demo catalog approver made by the staff seed; the demo admin is the fallback.
  const approverEmails = await resolveRoleRecipients(container, ["catalog_approver"]);
  const approverEmail = approverEmails[0] ?? "admin@example.test";
  const users = container.resolve(Modules.USER) as unknown as {
    listUsers: (filters: Record<string, unknown>) => Promise<{ id: string }[]>;
  };
  const [approver] = await users.listUsers({ email: approverEmail });
  if (!approver) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `${TAG} No staff user ${approverEmail}. Run the test-data seed first.`
    );
  }

  // 3 and 4. Products, one per planned state, through the real workflows.
  const catalog = getCatalogService(container);
  const created: { title: string; state: string }[] = [];
  for (const plan of PLANS) {
    if (await findProductByTitle(container, plan.title)) {
      log(`product ${plan.title}: exists`);
      created.push({ title: plan.title, state: `${plan.state} (exists)` });
      continue;
    }
    const owner = vendors[plan.vendor];
    const categoryId = categories[plan.category];
    const uploadId = await makeUpload(container, owner.vendor.id, owner.user.id, plan.color);
    const content = contentFor(plan, uploadId, categoryId);
    const { result: draft } = await vendorCreateProductWorkflow(container).run({
      input: { vendor_id: owner.vendor.id, content: content as never },
    });
    const productId = String((draft as Row).product_id);

    if (plan.state !== "draft") {
      await vendorSubmitProductWorkflow(container).run({
        input: { vendor_id: owner.vendor.id, product_id: productId },
      });
    }
    const [submission] = (await catalog.listProductSubmissions({ product_id: productId }, { take: 1 })) as Row[];

    if (plan.state === "changes_requested") {
      await requestChangesWorkflow(container).run({
        input: {
          submission_id: String(submission.id),
          actor: { id: String(approver.id), label: approverEmail },
          body: {
            content_hash: await currentHashOf(container, String(submission.id)),
            reason: "Please remove the studio name from the description.",
          },
        },
      });
    }

    if (plan.state === "approved" || plan.state === "approved_with_pending_edit") {
      await approveProductWorkflow(container).run({
        input: {
          submission_id: String(submission.id),
          actor: { id: String(approver.id), label: approverEmail },
          body: {
            content_hash: await currentHashOf(container, String(submission.id)),
            checklist: CHECKLIST,
            gst_class: "GST-5",
            hsn: "6109",
            category_id: categoryId,
            prices: plan.variants.map((variant) => ({ vendor_sku: variant.sku, selling_price: variant.selling })),
          },
        },
      });
    }

    if (plan.state === "approved_with_pending_edit") {
      await vendorUpdateProductWorkflow(container).run({
        input: {
          vendor_id: owner.vendor.id,
          product_id: productId,
          content: contentFor(plan, uploadId, categoryId, `${plan.title} Deluxe`) as never,
        },
      });
    }

    if (plan.stock?.length) {
      const refs = (await catalog.listVendorVariantRefs({ product_id: productId }, { take: null })) as Row[];
      const entries = plan.stock.map(([variantIndex, locationIndex, quantity], index) => ({
        index,
        variant_id: String(refs.find((ref) => ref.vendor_sku === plan.variants[variantIndex].sku)?.variant_id),
        location_code: String(owner.locations[locationIndex].code),
        stocked_quantity: quantity,
      }));
      await setVendorStockWorkflow(container).run({
        input: {
          vendor_id: owner.vendor.id,
          actor: { id: String(owner.user.id), label: String(owner.user.email) },
          entries,
          mode: "strict",
        },
      });
    }
    log(`product ${plan.title}: created (${plan.state})`);
    created.push({ title: plan.title, state: plan.state });
  }

  // 5. The sample file, with the real location codes of the demo locations.
  const samplePath = path.resolve(
    process.cwd(),
    "src/scripts/demo-data/stock-import.sample.csv"
  );
  const alphaCode = String(alphaLocations[0].code);
  const bravoCode = String(bravoLocations[0].code);
  writeFileSync(
    samplePath,
    [
      "vendor_sku,location_code,stocked_quantity",
      `DEMO-A1-S,${alphaCode},25`,
      `DEMO-A1-M,${alphaCode},12`,
      `DEMO-B1-S,${bravoCode},9`,
      "DEMO-A1-S,LOC-9999,5",
      `NOT-A-DEMO-SKU,${alphaCode},3`,
      "",
    ].join("\n")
  );

  // 6. The untracked credentials file, through the shared writer. Loaded by path at run time
  // because the helper lives outside the backend source tree.
  try {
    const helperPath = path.resolve(process.cwd(), "..", "..", "e2e", "support", "credentials-log.ts");
    const helper = (await import(pathToFileURL(helperPath).href)) as {
      appendCredentialEntry: (entry: {
        section: string;
        what: string;
        flow: string;
        reset: string;
        values: string;
      }) => void;
    };
    const reset =
      "Delete the products whose title starts with Demo through the Admin product screen, or re-create the database and run the seed commands again.";
    helper.appendCredentialEntry({
      section: "Catalog demo data",
      what: "Demo vendor accounts used by the catalog demo",
      flow: "seed-vendors.ts --catalog",
      reset,
      values: `Demo Vendor Alpha (${alpha.user.email}), Demo Vendor Bravo (${bravo.user.email}). Passwords are in the vendor demo data section.`,
    });
    for (const item of created) {
      helper.appendCredentialEntry({
        section: "Catalog demo data",
        what: `Demo product: ${item.title}`,
        flow: "seed-vendors.ts --catalog",
        reset,
        values: `State: ${item.state}`,
      });
    }
    helper.appendCredentialEntry({
      section: "Catalog demo data",
      what: "Demo Hub stock location and sample stock file",
      flow: "seed-vendors.ts --catalog",
      reset,
      values: `Hub ${hub.stockLocationId}. Sample file: apps/backend/src/scripts/demo-data/stock-import.sample.csv`,
    });
  } catch (error) {
    logger.warn(
      `${TAG} Could not write the credentials file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  log("done");
}
