import type { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import {
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export const HUB_LOCATION_NAME = "HUB";
export const STANDARD_DELIVERY_NAME = "Standard Delivery";

// The only fulfilment provider the store ships with. Every stock location that
// can ship needs a link to it before a shipping option of that provider works.
export const HUB_PROVIDER_IDS = ["manual_manual"] as const;

export type HubAddress = {
  addressLine1: string;
  city: string;
  /** ISO 3166-2:IN code such as IN-MH. Stored lower-case on the stock location. */
  provinceCode: string;
  postalCode: string;
};

export type EnsureHubOptions = {
  address: HubAddress;
  /** Decimal rupees. Used only when the option is created, never to update it. */
  shippingPriceInr?: number;
  /** Defaults to HUB. Tests use another name for a hub without a fulfilment set. */
  locationName?: string;
  /** undefined: the store's default channel. null: do not link a channel. */
  salesChannelId?: string | null;
  /** Default true. False creates the stock location only. */
  fulfillmentSet?: boolean;
};

export type FulfilmentSetup = {
  fulfillmentSetId: string;
  serviceZoneId: string;
  shippingOptionId: string;
  created: boolean;
};

export type EnsureHubResult = {
  stockLocationId: string;
  fulfillmentSetId: string | null;
  serviceZoneId: string | null;
  shippingOptionId: string | null;
  created: boolean;
};

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

const queryOf = (container: MedusaContainer): Query =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

// Confirmed on 2.22.7: sales_channels is used in-repo; fulfillment_sets and
// fulfillment_providers are the stock-location link fields the Admin API walks.
const LOCATION_FIELDS = [
  "id",
  "name",
  "sales_channels.id",
  "fulfillment_providers.id",
  "fulfillment_sets.id",
  "fulfillment_sets.name",
  "fulfillment_sets.service_zones.id",
  "fulfillment_sets.service_zones.name",
];

async function findLocation(
  container: MedusaContainer,
  filters: Record<string, unknown>
): Promise<Record<string, any> | undefined> {
  const { data } = await queryOf(container).graph({
    entity: "stock_location",
    fields: LOCATION_FIELDS,
    filters,
  });
  return data[0];
}

export async function resolveDefaultSalesChannelId(
  container: MedusaContainer
): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  const id = data[0]?.default_sales_channel_id;
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "The store has no default sales channel to link the hub to."
    );
  }
  return String(id);
}

async function defaultShippingProfileId(container: MedusaContainer): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  if (!data[0]) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No shipping profile exists. Create the store defaults first."
    );
  }
  return String(data[0].id);
}

/** Links the stock location to each fulfilment provider it is missing. */
export async function ensureProviderLinks(
  container: MedusaContainer,
  stockLocationId: string
): Promise<void> {
  const location = await findLocation(container, { id: stockLocationId });
  const linked = new Set<string>(
    (location?.fulfillment_providers ?? []).map((p: { id: string }) => p.id)
  );
  const link = container.resolve(ContainerRegistrationKeys.LINK) as unknown as {
    create(definition: Record<string, unknown>): Promise<unknown>;
  };
  for (const providerId of HUB_PROVIDER_IDS) {
    if (linked.has(providerId)) {
      continue;
    }
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
    });
  }
}

type FulfillmentModule = {
  createFulfillmentSets(data: Record<string, unknown>): Promise<{
    id: string;
    service_zones: { id: string; name?: string }[];
  }>;
  listFulfillmentSets(
    filters: Record<string, unknown>,
    config?: { relations?: string[] }
  ): Promise<
    { id: string; name: string; service_zones: { id: string; name?: string }[] }[]
  >;
  listShippingOptions(
    filters: Record<string, unknown>
  ): Promise<{ id: string; name: string }[]>;
};

/**
 * One fulfilment set named "<location name> shipping" with an India service zone
 * and one flat "Standard Delivery" option. Find or create by name, so a second
 * call changes nothing. The price is applied only when the option is created.
 */
export async function ensureFulfilmentSetup(
  container: MedusaContainer,
  input: { stockLocationId: string; locationName: string; shippingPriceInr?: number }
): Promise<FulfilmentSetup> {
  await ensureProviderLinks(container, input.stockLocationId);
  const fulfillment = container.resolve(Modules.FULFILLMENT) as unknown as FulfillmentModule;
  const setName = `${input.locationName} shipping`;
  let created = false;

  const location = await findLocation(container, { id: input.stockLocationId });
  // Match the canonical name or the location-suffixed name used on create.
  // A set may link to only one stock location, so new locations need new sets.
  let set = (location?.fulfillment_sets ?? []).find(
    (s: { name: string }) =>
      s.name === setName || s.name.startsWith(`${setName} `)
  ) as { id: string; service_zones: { id: string; name: string }[] } | undefined;

  if (!set) {
    const uniqueSetName = `${setName} ${input.stockLocationId}`;
    // Service zone names are unique module-wide on 2.22.7; the starter seed
    // already owns bare "India", so scope the zone name to this location.
    const zoneName = `${input.locationName} India ${input.stockLocationId}`;
    const made = await fulfillment.createFulfillmentSets({
      name: uniqueSetName,
      type: "shipping",
      service_zones: [
        {
          name: zoneName,
          geo_zones: [{ country_code: "in", type: "country" }],
        },
      ],
    });
    const link = container.resolve(ContainerRegistrationKeys.LINK) as unknown as {
      create(definition: Record<string, unknown>): Promise<unknown>;
    };
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: input.stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_set_id: made.id },
    });
    set = { id: made.id, service_zones: made.service_zones as any };
    created = true;
  }

  const zone = set.service_zones[0];
  if (!zone) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Fulfilment set "${setName}" has no service zone.`
    );
  }

  const existing = await fulfillment.listShippingOptions({
    service_zone_id: zone.id,
    name: STANDARD_DELIVERY_NAME,
  });
  let optionId = existing[0]?.id;

  if (!optionId) {
    const profileId = await defaultShippingProfileId(container);
    // CreateShippingOptionsWorkflowInput is an array on 2.22.7.
    const { result } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: STANDARD_DELIVERY_NAME,
          price_type: "flat" as const,
          provider_id: HUB_PROVIDER_IDS[0],
          service_zone_id: zone.id,
          shipping_profile_id: profileId,
          type: {
            label: "Standard",
            description: "Standard delivery",
            code: "standard",
          },
          prices: [
            { currency_code: "inr", amount: input.shippingPriceInr ?? 0 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
            { attribute: "is_return", value: "false", operator: "eq" as const },
          ],
        },
      ],
    });
    optionId = (result as { id: string }[])[0].id;
    created = true;
  }

  return {
    fulfillmentSetId: set.id,
    serviceZoneId: zone.id,
    shippingOptionId: optionId,
    created,
  };
}

/** Idempotent. Never touches the price of an option that already exists. */
export async function ensureHubLocation(
  container: MedusaContainer,
  options: EnsureHubOptions
): Promise<EnsureHubResult> {
  const name = options.locationName ?? HUB_LOCATION_NAME;
  let created = false;

  let location = await findLocation(container, { name });
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name,
            address: {
              address_1: options.address.addressLine1,
              city: options.address.city,
              country_code: "in",
              province: options.address.provinceCode.toLowerCase(),
              postal_code: options.address.postalCode,
            },
          },
        ],
      },
    });
    location = { id: (result as { id: string }[])[0].id, sales_channels: [] };
    created = true;
  }
  const stockLocationId = String(location.id);

  if (options.salesChannelId !== null) {
    const channelId = options.salesChannelId ?? (await resolveDefaultSalesChannelId(container));
    const linkedChannels = new Set<string>(
      (location.sales_channels ?? []).map((c: { id: string }) => c.id)
    );
    if (!linkedChannels.has(channelId)) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocationId, add: [channelId] },
      });
    }
  }

  if (options.fulfillmentSet === false) {
    await ensureProviderLinks(container, stockLocationId);
    return {
      stockLocationId,
      fulfillmentSetId: null,
      serviceZoneId: null,
      shippingOptionId: null,
      created,
    };
  }

  const setup = await ensureFulfilmentSetup(container, {
    stockLocationId,
    locationName: name,
    shippingPriceInr: options.shippingPriceInr,
  });
  return {
    stockLocationId,
    fulfillmentSetId: setup.fulfillmentSetId,
    serviceZoneId: setup.serviceZoneId,
    shippingOptionId: setup.shippingOptionId,
    created: created || setup.created,
  };
}

/** The INR amount of a shipping option, or null when it has none. */
export async function readShippingOptionPriceInr(
  container: MedusaContainer,
  shippingOptionId: string
): Promise<number | null> {
  // Admin shipping-option query config defaults include *prices on 2.22.7.
  const { data } = await queryOf(container).graph({
    entity: "shipping_option",
    fields: ["id", "prices.amount", "prices.currency_code"],
    filters: { id: shippingOptionId },
  });
  const price = (data[0]?.prices ?? []).find(
    (p: { currency_code: string }) => p.currency_code === "inr"
  );
  return price ? Number(price.amount) : null;
}

/** The price of the Hub's option, 0 when the Hub or its option does not exist. */
export async function readHubShippingPriceInr(
  container: MedusaContainer
): Promise<number> {
  const location = await findLocation(container, { name: HUB_LOCATION_NAME });
  const zoneId = location?.fulfillment_sets?.[0]?.service_zones?.[0]?.id;
  if (!zoneId) {
    return 0;
  }
  const fulfillment = container.resolve(Modules.FULFILLMENT) as unknown as FulfillmentModule;
  const options = await fulfillment.listShippingOptions({
    service_zone_id: zoneId,
    name: STANDARD_DELIVERY_NAME,
  });
  if (!options[0]) {
    return 0;
  }
  return (await readShippingOptionPriceInr(container, options[0].id)) ?? 0;
}

export type HubEnvironment = {
  address: HubAddress;
  shippingPriceInr: number;
  /** One line per missing or invalid variable. Empty when the values are usable. */
  problems: string[];
};

/**
 * Reads the Hub values from the environment. Outside production a missing value
 * falls back to an obviously fake one. In production every address value is required.
 */
export function readHubEnvironment(env: NodeJS.ProcessEnv): HubEnvironment {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const pick = (key: string, fallback: string): string => {
    const value = (env[key] ?? "").trim();
    if (value) {
      return value;
    }
    if (production) {
      problems.push(`${key} is missing`);
    }
    return fallback;
  };

  const addressLine1 = pick("HUB_ADDRESS_LINE1", "1 Demo Hub Road");
  const city = pick("HUB_CITY", "Mumbai");
  const provinceCode = pick("HUB_STATE_CODE", "IN-MH");
  const postalCode = pick("HUB_PIN", "400001");

  if (!/^IN-[A-Z]{2}$/.test(provinceCode)) {
    problems.push("HUB_STATE_CODE must look like IN-MH");
  }
  if (!/^[1-9][0-9]{5}$/.test(postalCode)) {
    problems.push("HUB_PIN must be six digits and not start with 0");
  }

  const rawPrice = (env.HUB_SHIPPING_PRICE_INR ?? "").trim();
  const shippingPriceInr = rawPrice === "" ? 0 : Number(rawPrice);
  if (!Number.isFinite(shippingPriceInr) || shippingPriceInr < 0) {
    problems.push("HUB_SHIPPING_PRICE_INR must be a number of rupees, 0 or more");
  }

  return {
    address: { addressLine1, city, provinceCode, postalCode },
    shippingPriceInr: Number.isFinite(shippingPriceInr) ? shippingPriceInr : 0,
    problems,
  };
}
