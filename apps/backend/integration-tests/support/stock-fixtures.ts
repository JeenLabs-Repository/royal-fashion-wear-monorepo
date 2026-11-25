import type { MedusaContainer } from "@medusajs/framework/types";
import { createReservationsWorkflow } from "@medusajs/medusa/core-flows";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log";
import type { ApiClient } from "../helpers/staff-users";
import { catalogService, createCategory, queryOf, type ActiveVendor } from "./catalog-fixtures";
import { approveViaApi, makeApprover } from "./decision-fixtures";

type Row = Record<string, any>;

/** Values the matrix fixtures read lazily; the seed function fills them. */
export const matrixStock = { variantId: "", locationCode: "", sku: "" };

/** Core variant id of every vendor SKU of a product. */
export async function variantIdsBySku(
  container: MedusaContainer,
  productId: string
): Promise<Map<string, string>> {
  const refs = (await catalogService(container).listVendorVariantRefs(
    { product_id: productId },
    { take: null }
  )) as Row[];
  return new Map(refs.map((ref) => [String(ref.vendor_sku), String(ref.variant_id)]));
}

/** Stocked and reserved quantity of a variant at a stock location, or null when there is no level. */
export async function levelOf(
  container: MedusaContainer,
  variantId: string,
  stockLocationId: string
): Promise<{ stocked: number; reserved: number; inventoryItemId: string } | null> {
  const query = queryOf(container);
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { id: variantId },
  });
  const itemId = String(variants[0].inventory_items[0].inventory_item_id);
  const { data } = await query.graph({
    entity: "inventory_level",
    fields: ["stocked_quantity", "reserved_quantity"],
    filters: { inventory_item_id: itemId, location_id: stockLocationId },
  });
  if (data.length === 0) {
    return null;
  }
  return {
    stocked: Number(data[0].stocked_quantity),
    reserved: Number(data[0].reserved_quantity),
    inventoryItemId: itemId,
  };
}

/** Reserves stock at a location through the core reservation workflow. */
export async function reserve(
  container: MedusaContainer,
  variantId: string,
  stockLocationId: string,
  quantity: number
): Promise<void> {
  const level = await levelOf(container, variantId, stockLocationId);
  if (!level) {
    throw new Error("Cannot reserve at a location without a level");
  }
  await createReservationsWorkflow(container).run({
    input: {
      reservations: [
        { inventory_item_id: level.inventoryItemId, location_id: stockLocationId, quantity },
      ],
    },
  });
}

/** Audit rows of one action for a target, newest first. */
export async function auditRows(
  container: MedusaContainer,
  filter: { action: string; target_id?: string }
): Promise<Row[]> {
  const audit = container.resolve(AUDIT_LOG_MODULE) as {
    listAuditEntries: (filters: Row, config: Row) => Promise<Row[]>;
  };
  return audit.listAuditEntries(
    { action: filter.action, ...(filter.target_id ? { target_id: filter.target_id } : {}) },
    { order: { at: "DESC" }, take: 500 }
  );
}

/** Rows the stock matrix fixtures point at. Call it after the other matrix seeds. */
export async function seedStockMatrix(input: {
  api: ApiClient;
  container: MedusaContainer;
  vendorA: ActiveVendor;
}): Promise<void> {
  const { api, container, vendorA } = input;
  const approver = await makeApprover(api, container);
  const categoryId = await createCategory(container, { name: "Matrix Stock Category" });
  const draft = await approveViaApi(api, container, approver.headers, vendorA, categoryId, "matrix-stock");
  const ids = await variantIdsBySku(container, draft.productId);
  matrixStock.sku = `${draft.suffix}-S`;
  matrixStock.variantId = String(ids.get(matrixStock.sku));
  matrixStock.locationCode = vendorA.locations[0].code;
}
