import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";
import {
  type ActiveVendor,
  catalogService,
  createActiveVendor,
  createCategory,
  createDraftFor,
  forceApprove,
  queryOf,
} from "./catalog-fixtures";

type Api = Parameters<typeof createActiveVendor>[0];

export const PINS: Record<string, string> = {
  "IN-MH": "400001",
  "IN-KA": "560001",
  "IN-TN": "600001",
  "IN-DL": "110001",
  "IN-GJ": "380001",
};

/** An active vendor plus the state code of each location, in the order the locations were created. */
export type StateVendor = ActiveVendor & { stateCodes: string[] };

/** A vendor with one location per listed state code (the fixture always adds Maharashtra first). */
export async function vendorInStates(
  api: Api,
  container: MedusaContainer,
  states: string[]
): Promise<StateVendor> {
  const extra = states.filter((state) => state !== "IN-MH").map((state) => ({ state_code: state, pin: PINS[state] }));
  const vendor = await createActiveVendor(api, container, { extraLocations: extra });
  // The fixture creates Maharashtra first and then the extra locations in order; its location rows carry no state code.
  return { ...vendor, stateCodes: ["IN-MH", ...extra.map((location) => location.state_code)] };
}

export const stockLocationOf = (vendor: StateVendor, stateCode: string): string => {
  const index = vendor.stateCodes.indexOf(stateCode);
  const found = index < 0 ? undefined : vendor.locations[index];
  if (!found) {
    throw new Error(`The fixture vendor has no location in ${stateCode}.`);
  }
  return found.stock_location_id;
};

export async function inventoryItemIds(container: MedusaContainer, productId: string): Promise<string[]> {
  const { data } = await queryOf(container).graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.inventory_items.inventory_item_id"],
    filters: { id: productId },
  });
  const variants = ((data[0] as Record<string, any>)?.variants ?? []) as Record<string, any>[];
  return variants.flatMap((variant) =>
    (variant.inventory_items ?? []).map((link: Record<string, any>) => String(link.inventory_item_id))
  );
}

export type StockSpec = { locationId: string; quantity: number; reserved?: number };

/** Sets stock (and optionally a reservation) for the first variant's inventory item. */
export async function stockProduct(
  container: MedusaContainer,
  productId: string,
  specs: StockSpec[]
): Promise<void> {
  const [itemId] = await inventoryItemIds(container, productId);
  if (!itemId) {
    throw new Error(`Product ${productId} has no inventory item.`);
  }
  const inventory = container.resolve(Modules.INVENTORY) as any;
  for (const spec of specs) {
    await inventory.createInventoryLevels([
      { inventory_item_id: itemId, location_id: spec.locationId, stocked_quantity: spec.quantity },
    ]);
    if (spec.reserved) {
      await inventory.createReservationItems([
        { inventory_item_id: itemId, location_id: spec.locationId, quantity: spec.reserved },
      ]);
    }
  }
}

export type LiveProduct = { productId: string; vendor: ActiveVendor };

/** A draft by the vendor, approved with the test helper, stocked as described. */
export async function liveProduct(
  api: Api,
  container: MedusaContainer,
  vendor: ActiveVendor,
  categoryId: string,
  stock: StockSpec[],
  suffix: string
): Promise<LiveProduct> {
  const { productId } = await createDraftFor(api, container, vendor, categoryId, suffix);
  await forceApprove(container, productId);
  await stockProduct(container, productId, stock);
  return { productId, vendor };
}

/** Sets the declaration text of a product through the module, to plant distinctive strings. */
export async function setDeclaration(
  container: MedusaContainer,
  productId: string,
  values: Partial<Record<"generic_name" | "country_of_origin" | "packed_by_name" | "packed_by_address", string>>
): Promise<void> {
  const service = catalogService(container) as any;
  const [row] = await service.listProductDeclarations({ product_id: productId }, { take: 1 });
  await service.updateProductDeclarations({ id: row.id, ...values });
}

export async function unlinkLocationFromChannel(
  container: MedusaContainer,
  stockLocationId: string,
  channelId: string
): Promise<void> {
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocationId, remove: [channelId] },
  });
}

export async function linkLocationToChannel(
  container: MedusaContainer,
  stockLocationId: string,
  channelId: string
): Promise<void> {
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocationId, add: [channelId] },
  });
}

export { createCategory };
