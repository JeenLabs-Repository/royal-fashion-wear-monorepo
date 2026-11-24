import type { MedusaContainer } from "@medusajs/framework";
import { logger } from "@medusajs/framework/logger";
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { SEED_LOCALES } from "../data/i18n";
import { SEED_REGIONS } from "../data/regions";
import { SEED_STORE } from "../data/store";
import { getQuery } from "./utils";

export const getSalesChannel = async (container: MedusaContainer) => {
  const { data } = await getQuery(container).graph({
    entity: "sales_channel",
    fields: ["id"],
    filters: { name: SEED_STORE.sales_channel.name },
  });
  return data[0];
};

export const isAlreadySeeded = async (container: MedusaContainer) => {
  // createDefaults creates the same "Default Sales Channel" name on first boot,
  // so the channel alone is not a signal that the demo catalog exists. Products
  // are: a seeded store has them, a fresh migrate does not.
  const { data: products } = await getQuery(container).graph({
    entity: "product",
    fields: ["id"],
    pagination: { take: 1 },
  });
  if (!products.length) return false;

  logger.info("Store already seeded — skipping initial data seed.");
  return true;
};

export const seedStore = async (container: MedusaContainer) => {
  const query = getQuery(container);
  let salesChannel = await getSalesChannel(container);
  if (!salesChannel) {
    const {
      result: [created],
    } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [SEED_STORE.sales_channel] },
    });
    salesChannel = created;
  }

  const { data: existingKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "sales_channels.id"],
    filters: { type: "publishable" },
  });
  let publishableApiKey = existingKeys.find(
    (key) => key.title === SEED_STORE.publishable_api_key.title,
  ) ?? existingKeys[0];
  if (!publishableApiKey) {
    const {
      result: [created],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: SEED_STORE.publishable_api_key.title,
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });
    publishableApiKey = created;
  }

  const linked = publishableApiKey.sales_channels?.some(
    (channel) => channel?.id === salesChannel.id,
  );
  if (!linked) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: publishableApiKey.id, add: [salesChannel.id] },
    });
  }

  const currencyCodes = Array.from(
    new Set(SEED_REGIONS.map((seedRegion) => seedRegion.currency_code)),
  );

  if (!currencyCodes.includes(SEED_STORE.default_currency_code)) {
    throw new Error(
      `Default currency "${SEED_STORE.default_currency_code}" has no region. Use one of: ${currencyCodes.join(", ")}.`,
    );
  }

  const storeInput = {
    name: SEED_STORE.name,
    supported_currencies: currencyCodes.map((currency_code) => ({
      currency_code,
      is_default: currency_code === SEED_STORE.default_currency_code,
    })),
    supported_locales: SEED_LOCALES.map((locale_code) => ({
      locale_code,
    })),
    default_sales_channel_id: salesChannel.id,
  };

  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id"],
  });
  if (!stores[0]) {
    await createStoresWorkflow(container).run({
      input: { stores: [storeInput] },
    });
  } else {
    await updateStoresWorkflow(container).run({
      input: { selector: { id: stores[0].id }, update: storeInput },
    });
  }
};
