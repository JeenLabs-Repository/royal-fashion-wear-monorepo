import fs from "fs";
import path from "path";
import type { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createReservationsWorkflow,
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  deleteReservationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateReservationsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  ensureFulfilmentSetup,
  ensureHubLocation,
  ensureProviderLinks,
  type HubAddress,
} from "../../src/lib/hub/ensure-hub-location";

export type SpikeLayout = "hub-only" | "per-location";
export type LocationLabel = "A" | "B" | "HUB";
export type SpikeId = "S1" | "S2" | "S3";

export const PROVINCE_A = "in-mh";
export const PROVINCE_B = "in-ka";
export const AWB = "AWB-TEST-0001";

const HUB_TEST_ADDRESS: HubAddress = {
  addressLine1: "1 Demo Hub Road",
  city: "Mumbai",
  provinceCode: "IN-MH",
  postalCode: "400001",
};

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

type ApiClient = {
  get(url: string, config?: Record<string, unknown>): Promise<{ data: any }>;
  post(url: string, body?: unknown, config?: Record<string, unknown>): Promise<{ data: any }>;
};

export type SpikeFixture = {
  container: MedusaContainer;
  api: ApiClient;
  layout: SpikeLayout;
  channelId: string;
  regionId: string;
  publishableKey: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;
  locationIds: Record<LocationLabel, string>;
  /** Labels in the order the stock locations were created. */
  candidateOrder: LocationLabel[];
};

export type BuildOptions = {
  layout: SpikeLayout;
  /** Stocked quantity per vendor location. 0 means no inventory level at all. */
  stocks: { a: number; b: number };
  creationOrder?: "AB" | "BA";
  hubInChannel?: boolean;
};

const queryOf = (container: MedusaContainer): Query =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

const errorText = (e: any): string =>
  e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message ?? e);

let buildCounter = 0;

export function assertSpikeEnvironment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Spike fixtures create demo regions and payment providers and never run in production."
    );
  }
}

/** Fails unless the backend pins the exact Medusa version the experiments were written for. */
export function assertMedusaVersion(expected = "2.22.7"): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const pinned = manifest.dependencies?.["@medusajs/medusa"];
  if (pinned !== expected) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Expected @medusajs/medusa ${expected} but apps/backend/package.json pins ${pinned}.`
    );
  }
  return pinned;
}

/** A fresh test database may hold no store, no INR currency or no default channel. */
export async function ensureStoreAndDefaultChannel(
  container: MedusaContainer
): Promise<{ storeId: string; channelId: string }> {
  const query = queryOf(container);
  let { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code"],
  });
  if (!stores[0]) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Spike Store",
            supported_currencies: [{ currency_code: "inr", is_default: true }],
          },
        ],
      },
    });
    ({ data: stores } = await query.graph({
      entity: "store",
      fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code"],
    }));
  }
  const store = stores[0];
  const existingCurrencies = (store.supported_currencies ?? []) as {
    currency_code: string;
    is_default?: boolean;
  }[];
  const currencies = existingCurrencies.map((c) => c.currency_code);
  if (!currencies.includes("inr")) {
    // Preserve any existing default flag. Adding INR without one makes
    // updateStores reject with "There should be a default currency".
    const hasDefault = existingCurrencies.some((c) => Boolean(c.is_default));
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [
            ...existingCurrencies.map((c) => ({
              currency_code: c.currency_code,
              is_default: Boolean(c.is_default),
            })),
            { currency_code: "inr", is_default: !hasDefault },
          ],
        },
      },
    });
  }
  let channelId = store.default_sales_channel_id as string | null;
  if (!channelId) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Spike Default Channel" }] },
    });
    channelId = (result as { id: string }[])[0].id;
    await updateStoresWorkflow(container).run({
      input: { selector: { id: store.id }, update: { default_sales_channel_id: channelId } },
    });
  }
  return { storeId: String(store.id), channelId };
}

async function ensureIndiaRegion(container: MedusaContainer): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "region",
    fields: ["id", "name"],
    filters: { name: "India" },
  });
  if (data[0]) {
    return String(data[0].id);
  }
  // pp_system_default is the built-in test payment provider. It exists only in test databases.
  const { result } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "India",
          currency_code: "inr",
          countries: ["in"],
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  return (result as { id: string }[])[0].id;
}

async function ensureShippingProfile(container: MedusaContainer): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  if (data[0]) {
    return String(data[0].id);
  }
  const { result } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
  });
  return (result as { id: string }[])[0].id;
}

/** Makes sure a shipping profile exists. Used by the hub spec, which builds no fixture. */
export async function ensureBareDefaults(container: MedusaContainer): Promise<void> {
  await ensureShippingProfile(container);
}

export async function buildSpikeFixture(
  container: MedusaContainer,
  api: ApiClient,
  options: BuildOptions
): Promise<SpikeFixture> {
  assertSpikeEnvironment();
  buildCounter += 1;
  const stamp = `${buildCounter}-${Date.now()}`;
  const hubInChannel = options.hubInChannel ?? true;

  await ensureStoreAndDefaultChannel(container);
  const regionId = await ensureIndiaRegion(container);
  const profileId = await ensureShippingProfile(container);

  const { result: channels } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Spike Channel ${stamp}` }] },
  });
  const channelId = (channels as { id: string }[])[0].id;

  const { result: keys } = await createApiKeysWorkflow(container).run({
    input: { api_keys: [{ title: `spike-${stamp}`, type: "publishable", created_by: "" }] },
  });
  const key = (keys as { id: string; token: string }[])[0];
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: key.id, add: [channelId] },
  });

  const createVendorLocation = async (name: string, province: string): Promise<string> => {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name,
            address: {
              address_1: "1 Spike Road",
              city: "Spike City",
              country_code: "in",
              province,
              postal_code: "400001",
            },
          },
        ],
      },
    });
    const id = (result as { id: string }[])[0].id;
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id, add: [channelId] },
    });
    await ensureProviderLinks(container, id);
    return id;
  };

  const ids: Partial<Record<LocationLabel, string>> = {};
  const candidateOrder: LocationLabel[] = [];
  const order: ("A" | "B")[] = options.creationOrder === "BA" ? ["B", "A"] : ["A", "B"];
  for (const label of order) {
    ids[label] =
      label === "A"
        ? await createVendorLocation("LOC-S1A", PROVINCE_A)
        : await createVendorLocation("LOC-S1B", PROVINCE_B);
    candidateOrder.push(label);
  }

  if (options.layout === "hub-only") {
    const hub = await ensureHubLocation(container, {
      address: HUB_TEST_ADDRESS,
      salesChannelId: hubInChannel ? channelId : null,
    });
    ids.HUB = hub.stockLocationId;
  } else {
    for (const label of ["A", "B"] as const) {
      await ensureFulfilmentSetup(container, {
        stockLocationId: ids[label]!,
        locationName: label === "A" ? "LOC-S1A" : "LOC-S1B",
        shippingPriceInr: 0,
      });
    }
    const hub = await ensureHubLocation(container, {
      address: HUB_TEST_ADDRESS,
      locationName: "HUB-NOSET",
      fulfillmentSet: false,
      salesChannelId: hubInChannel ? channelId : null,
    });
    ids.HUB = hub.stockLocationId;
  }
  candidateOrder.push("HUB");

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: `Spike Product ${stamp}`,
          handle: `spike-product-${stamp}`,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: profileId,
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              sku: `SPIKE-${stamp}`,
              options: { Size: "M" },
              manage_inventory: true,
              prices: [{ amount: 100, currency_code: "inr" }],
            },
          ],
          sales_channels: [{ id: channelId }],
        },
      ],
    },
  });
  const product = (products as { id: string; variants: { id: string }[] }[])[0];
  const variantId = product.variants[0].id;

  const { data: variants } = await queryOf(container).graph({
    entity: "product_variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { id: variantId },
  });
  const inventoryItemId = String(variants[0]?.inventory_items?.[0]?.inventory_item_id ?? "");
  if (!inventoryItemId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The spike variant has no inventory item."
    );
  }

  const levels: { location_id: string; inventory_item_id: string; stocked_quantity: number }[] = [];
  if (options.stocks.a > 0) {
    levels.push({ location_id: ids.A!, inventory_item_id: inventoryItemId, stocked_quantity: options.stocks.a });
  }
  if (options.stocks.b > 0) {
    levels.push({ location_id: ids.B!, inventory_item_id: inventoryItemId, stocked_quantity: options.stocks.b });
  }
  if (levels.length) {
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levels } });
  }

  return {
    container,
    api,
    layout: options.layout,
    channelId,
    regionId,
    publishableKey: key.token,
    productId: product.id,
    variantId,
    inventoryItemId,
    locationIds: ids as Record<LocationLabel, string>,
    candidateOrder,
  };
}

export function labelOf(fixture: SpikeFixture, locationId: string | null | undefined): string {
  const found = (Object.entries(fixture.locationIds) as [LocationLabel, string][]).find(
    ([, id]) => id === locationId
  );
  return found ? found[0] : String(locationId ?? "none");
}

export function otherVendorLocation(label: string): "A" | "B" {
  return label === "A" ? "B" : "A";
}

const storeHeaders = (f: SpikeFixture) => ({
  headers: { "x-publishable-api-key": f.publishableKey },
});

export type OpenCartResult = {
  cartId?: string;
  shippingOptions: { id: string; name: string }[];
  error?: string;
};

export type CompleteCartResult = OpenCartResult & {
  orderId?: string;
  lineItemId?: string;
};

/** Creates a cart, adds the variant, sets the address and lists the shipping options. Never throws. */
export async function openCart(
  f: SpikeFixture,
  input: { quantity: number; province: string }
): Promise<OpenCartResult> {
  const headers = storeHeaders(f);
  let cartId: string | undefined;
  try {
    const cart = await f.api.post(
      "/store/carts",
      { region_id: f.regionId, sales_channel_id: f.channelId, email: "spike@example.test" },
      headers
    );
    cartId = cart.data.cart.id;
    await f.api.post(
      `/store/carts/${cartId}/line-items`,
      { variant_id: f.variantId, quantity: input.quantity },
      headers
    );
    await f.api.post(
      `/store/carts/${cartId}`,
      {
        shipping_address: {
          first_name: "Spike",
          last_name: "Buyer",
          address_1: "7 Test Street",
          city: "Test City",
          country_code: "in",
          province: input.province,
          postal_code: "560001",
          phone: "+910000000000",
        },
      },
      headers
    );
    const options = await f.api.get(`/store/shipping-options?cart_id=${cartId}`, headers);
    return {
      cartId,
      shippingOptions: (options.data.shipping_options ?? []).map(
        (o: { id: string; name: string }) => ({ id: o.id, name: o.name })
      ),
    };
  } catch (e) {
    return { cartId, shippingOptions: [], error: errorText(e) };
  }
}

/** Opens a cart and completes it with the first shipping option. Never throws. */
export async function completeCart(
  f: SpikeFixture,
  input: { quantity: number; province: string }
): Promise<CompleteCartResult> {
  const opened = await openCart(f, input);
  if (opened.error || !opened.cartId) {
    return opened;
  }
  if (!opened.shippingOptions.length) {
    return { ...opened, error: "no shipping options offered" };
  }
  const headers = storeHeaders(f);
  try {
    await f.api.post(
      `/store/carts/${opened.cartId}/shipping-methods`,
      { option_id: opened.shippingOptions[0].id },
      headers
    );
    const collection = await f.api.post(
      "/store/payment-collections",
      { cart_id: opened.cartId },
      headers
    );
    await f.api.post(
      `/store/payment-collections/${collection.data.payment_collection.id}/payment-sessions`,
      { provider_id: "pp_system_default" },
      headers
    );
    const done = await f.api.post(`/store/carts/${opened.cartId}/complete`, {}, headers);
    if (done.data.type !== "order") {
      return { ...opened, error: JSON.stringify(done.data.error ?? done.data) };
    }
    return {
      ...opened,
      orderId: done.data.order.id,
      lineItemId: done.data.order.items?.[0]?.id,
    };
  } catch (e) {
    return { ...opened, error: errorText(e) };
  }
}

export type LevelSnapshot = { stocked: number; reserved: number; available: number };
export type InventorySnapshot = Partial<Record<LocationLabel, LevelSnapshot>>;

export async function snapshotInventory(f: SpikeFixture): Promise<InventorySnapshot> {
  const { data } = await queryOf(f.container).graph({
    entity: "inventory_level",
    fields: ["location_id", "stocked_quantity", "reserved_quantity"],
    filters: { inventory_item_id: f.inventoryItemId },
  });
  const snapshot: InventorySnapshot = {};
  for (const row of data) {
    const label = labelOf(f, row.location_id) as LocationLabel;
    const stocked = Number(row.stocked_quantity);
    const reserved = Number(row.reserved_quantity);
    snapshot[label] = { stocked, reserved, available: stocked - reserved };
  }
  return snapshot;
}

export function levelOf(snapshot: InventorySnapshot, label: string): LevelSnapshot {
  return snapshot[label as LocationLabel] ?? { stocked: 0, reserved: 0, available: 0 };
}

/** after minus before for one field at one location. */
export function delta(
  before: InventorySnapshot,
  after: InventorySnapshot,
  label: string,
  field: keyof LevelSnapshot
): number {
  return levelOf(after, label)[field] - levelOf(before, label)[field];
}

export type ReservationRow = {
  id: string;
  location: string;
  quantity: number;
  line_item_id: string | null;
};

export async function listReservations(f: SpikeFixture): Promise<ReservationRow[]> {
  const inventory = f.container.resolve(Modules.INVENTORY) as unknown as {
    listReservationItems(filters: Record<string, unknown>): Promise<Record<string, any>[]>;
  };
  const rows = await inventory.listReservationItems({ inventory_item_id: [f.inventoryItemId] });
  return rows.map((r) => ({
    id: String(r.id),
    location: labelOf(f, r.location_id),
    quantity: Number(r.quantity),
    line_item_id: r.line_item_id ?? null,
  }));
}

export type Attempt<T = unknown> = { ok: boolean; error?: string; result?: T };

export async function attempt<T>(fn: () => Promise<{ result: T }>): Promise<Attempt<T>> {
  try {
    const { result } = await fn();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

// Confirmed on 2.22.7: updates[{id,location_id|quantity}], reservations[{...}], ids[].
export const moveReservation = (f: SpikeFixture, reservationId: string, label: LocationLabel) =>
  attempt(() =>
    updateReservationsWorkflow(f.container).run({
      input: { updates: [{ id: reservationId, location_id: f.locationIds[label] }] },
    })
  );

export const reduceReservation = (f: SpikeFixture, reservationId: string, quantity: number) =>
  attempt(() =>
    updateReservationsWorkflow(f.container).run({
      input: { updates: [{ id: reservationId, quantity }] },
    })
  );

export const addReservation = (
  f: SpikeFixture,
  input: { label: LocationLabel; quantity: number; lineItemId: string }
) =>
  attempt(() =>
    createReservationsWorkflow(f.container).run({
      input: {
        reservations: [
          {
            inventory_item_id: f.inventoryItemId,
            location_id: f.locationIds[input.label],
            quantity: input.quantity,
            line_item_id: input.lineItemId,
          },
        ],
      },
    })
  );

export const removeReservation = (f: SpikeFixture, reservationId: string) =>
  attempt(() =>
    deleteReservationsWorkflow(f.container).run({ input: { ids: [reservationId] } })
  );

// Confirmed on 2.22.7: location_id on fulfilment; labels[{tracking_number,...}] on shipment.
export const fulfilOrder = (
  f: SpikeFixture,
  input: { orderId: string; lineItemId: string; quantity: number; locationId: string }
) =>
  attempt(() =>
    createOrderFulfillmentWorkflow(f.container).run({
      input: {
        order_id: input.orderId,
        items: [{ id: input.lineItemId, quantity: input.quantity }],
        location_id: input.locationId,
        no_notification: true,
      },
    })
  );

export const shipFulfilment = (
  f: SpikeFixture,
  input: { orderId: string; fulfillmentId: string; lineItemId: string; quantity: number }
) =>
  attempt(() =>
    createOrderShipmentWorkflow(f.container).run({
      input: {
        order_id: input.orderId,
        fulfillment_id: input.fulfillmentId,
        items: [{ id: input.lineItemId, quantity: input.quantity }],
        labels: [{ tracking_number: AWB, tracking_url: "", label_url: "" }],
        no_notification: true,
      },
    })
  );

/** Order, fulfilments and labels as stored. Falls back to fewer fields when the graph rejects one. */
export async function readOrder(f: SpikeFixture, orderId: string): Promise<Record<string, unknown>> {
  const full = [
    "id",
    "status",
    "fulfillment_status",
    "shipping_methods.id",
    "shipping_methods.name",
    "fulfillments.id",
    "fulfillments.location_id",
    "fulfillments.labels.tracking_number",
    "fulfillments.labels.tracking_url",
    "fulfillments.labels.label_url",
  ];
  const minimal = full.filter((field) => field !== "fulfillment_status");
  for (const fields of [full, minimal]) {
    try {
      const { data } = await queryOf(f.container).graph({
        entity: "order",
        fields,
        filters: { id: orderId },
      });
      return data[0] ?? {};
    } catch (e) {
      if (fields === minimal) {
        return { error: String((e as Error)?.message ?? e) };
      }
    }
  }
  return {};
}

/** What the storefront shows as available quantity for the spike variant. */
export async function storeVariantQuantity(f: SpikeFixture): Promise<number | null> {
  try {
    const res = await f.api.get(
      `/store/products/${f.productId}?region_id=${f.regionId}&fields=%2Bvariants.inventory_quantity`,
      storeHeaders(f)
    );
    const quantity = res.data.product?.variants?.[0]?.inventory_quantity;
    return quantity === undefined ? null : Number(quantity);
  } catch {
    return null;
  }
}

const RESULTS_DIR = path.join(process.cwd(), "integration-tests", ".spike-results");
const started = new Set<string>();

/** One JSON line to the console and to integration-tests/.spike-results/<id>.jsonl. */
export function recordSpike(
  id: SpikeId,
  layout: string,
  step: string,
  payload: Record<string, unknown>
): void {
  const line = JSON.stringify({ spike: id, layout, step, data: payload });
  console.log(`[spike:${id}] ${line}`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${id.toLowerCase()}.jsonl`);
  if (!started.has(id)) {
    fs.writeFileSync(file, "");
    started.add(id);
  }
  fs.appendFileSync(file, `${line}\n`);
}

/**
 * Runs one experiment step and records what it returned. A thrown error is also an
 * answer: it is recorded and the suite carries on, so only broken setup fails a spec.
 */
export async function observe<T extends Record<string, unknown>>(
  id: SpikeId,
  layout: string,
  step: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    const result = await fn();
    recordSpike(id, layout, step, result);
    return result;
  } catch (e) {
    recordSpike(id, layout, step, { threw: String((e as Error)?.message ?? e) });
    return undefined;
  }
}
