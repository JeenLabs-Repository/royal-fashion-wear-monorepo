import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { RAZORPAY_PAYMENT_PROVIDER_ID } from "../lib/commerce/india-seed";

// One-time setup for a real first deploy, run after the migration:
//   medusa exec ./src/scripts/bootstrap-production.ts
// It creates only what the store needs to start: the INR store settings, the
// India region with tax-inclusive pricing, the default sales channel and one
// publishable API key. It never creates products, categories, users or stock
// locations. Run it twice and the second run reports everything as present.

const ALLOW_FLAG = "--allow-non-production";
const SALES_CHANNEL_NAME = "Default Sales Channel";
const REGION_NAME = "India";
const COUNTRY_CODE = "in";
const CURRENCY_CODE = "inr";
const LOCALE = { code: "en", name: "English" };
const KEY_TITLE = "Storefront";

export type BootstrapResult = {
  created: string[];
  present: string[];
  postgresMajor: number | null;
  publishableKey: { id: string; token: string };
};

// Plain console output on purpose: the owner copies these lines from a terminal.
const say = (message: string) => console.log(`[bootstrap] ${message}`);

const readPostgresMajor = async (container: MedusaContainer) => {
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const result = await pg.raw("show server_version_num");
    const value = Number(result.rows?.[0]?.server_version_num);
    return Number.isFinite(value) ? Math.floor(value / 10000) : null;
  } catch {
    return null;
  }
};

export const ensureProductionEssentials = async (
  container: MedusaContainer,
): Promise<BootstrapResult> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const created: string[] = [];
  const present: string[] = [];
  const record = (label: string, wasCreated: boolean) => {
    (wasCreated ? created : present).push(label);
  };

  // Default sales channel.
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: SALES_CHANNEL_NAME },
  });
  let salesChannelId = channels[0]?.id as string | undefined;
  if (!salesChannelId) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          { name: SALES_CHANNEL_NAME, description: "Online store" },
        ],
      },
    });
    salesChannelId = result[0].id;
  }
  record("default sales channel", !channels[0]);

  // Locale used by the store settings.
  const translation = container.resolve(Modules.TRANSLATION);
  const locales = await translation.listLocales({ code: [LOCALE.code] });
  if (!locales.length) {
    await translation.createLocales([LOCALE]);
  }
  record(`locale ${LOCALE.code}`, !locales.length);

  // Store settings. The framework may already hold a default store, so update
  // it instead of creating a second one, and never overwrite its name.
  const { data: stores } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "name",
      "default_sales_channel_id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
      "supported_locales.locale_code",
    ],
  });
  const desired = {
    supported_currencies: [{ currency_code: CURRENCY_CODE, is_default: true }],
    supported_locales: [{ locale_code: LOCALE.code }],
    default_sales_channel_id: salesChannelId,
  };
  const store = stores[0];
  const defaultCurrency = store?.supported_currencies?.[0];
  const defaultLocale = store?.supported_locales?.[0];
  const storeReady =
    Boolean(store) &&
    store.default_sales_channel_id === salesChannelId &&
    store.supported_currencies?.length === 1 &&
    defaultCurrency?.currency_code === CURRENCY_CODE &&
    defaultCurrency?.is_default === true &&
    store.supported_locales?.length === 1 &&
    defaultLocale?.locale_code === LOCALE.code;
  if (!store) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [{ name: process.env.STORE_NAME?.trim() || "Store", ...desired }],
      },
    });
  } else if (!storeReady) {
    await updateStoresWorkflow(container).run({
      input: { selector: { id: store.id }, update: desired },
    });
  }
  record("store settings (INR, English)", !storeReady);

  // India region.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
    filters: { currency_code: CURRENCY_CODE },
  });
  let regionId = regions.find((candidate) =>
    candidate.countries?.some(
      (country) => country?.iso_2 === COUNTRY_CODE,
    ),
  )?.id;
  const regionWasMissing = !regionId;
  if (!regionId) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: CURRENCY_CODE,
            countries: [COUNTRY_CODE],
            payment_providers: [RAZORPAY_PAYMENT_PROVIDER_ID],
          },
        ],
      },
    });
    regionId = result[0].id;
  }
  record(`region ${REGION_NAME}`, regionWasMissing);

  // Tax region for India with the system provider.
  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id"],
    filters: { country_code: COUNTRY_CODE },
  });
  if (!taxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY_CODE, provider_id: "tp_system" }],
    });
  }
  record("tax region IN", !taxRegions.length);

  // Prices are entered tax-inclusive for the India region.
  const pricing = container.resolve(Modules.PRICING);
  const preferences = await pricing.listPricePreferences({
    attribute: "region_id",
    value: regionId,
  });
  const preferenceMissing = !preferences.length;
  const preferenceWrong = !preferenceMissing && !preferences[0].is_tax_inclusive;
  if (preferenceMissing) {
    await pricing.createPricePreferences({
      attribute: "region_id",
      value: regionId,
      is_tax_inclusive: true,
    });
  } else if (preferenceWrong) {
    await pricing.updatePricePreferences(preferences[0].id, {
      is_tax_inclusive: true,
    });
  }
  record("tax-inclusive pricing for India", preferenceMissing || preferenceWrong);

  // One publishable key tied to the default sales channel. The framework's
  // createDefaultsWorkflow may already have created "Default Publishable API
  // Key" on first boot, so reuse any publishable key instead of adding a second.
  const keyFields = ["id", "token", "title", "sales_channels.id"];
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: keyFields,
    filters: { type: "publishable" },
  });
  let key = keys[0];
  if (!key) {
    await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: KEY_TITLE, type: "publishable", created_by: "" }],
      },
    });
    const { data: made } = await query.graph({
      entity: "api_key",
      fields: keyFields,
      filters: { type: "publishable" },
    });
    key = made[0];
  }
  record("publishable key", !keys[0]);
  const linked = key.sales_channels?.some(
    (channel) => channel?.id === salesChannelId,
  );
  if (!linked) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [salesChannelId] },
    });
    if (keys[0]) {
      record("publishable key link to the default sales channel", true);
    }
  }

  return {
    created,
    present,
    postgresMajor: await readPostgresMajor(container),
    publishableKey: { id: key.id, token: key.token },
  };
};

export default async function bootstrapProduction({
  container,
  args = [],
}: ExecArgs) {
  const allowed =
    args.includes(ALLOW_FLAG) ||
    process.env.BOOTSTRAP_ALLOW_NON_PRODUCTION === "1";
  if (process.env.NODE_ENV !== "production" && !allowed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Refusing to run: NODE_ENV is "${process.env.NODE_ENV ?? "unset"}". ` +
        `This script prepares a real first deploy. Run it with NODE_ENV=production, ` +
        `or pass ${ALLOW_FLAG} for a throwaway database.`,
    );
  }

  const result = await ensureProductionEssentials(container);

  for (const label of result.created) say(`created ${label}`);
  for (const label of result.present) say(`already present: ${label}`);
  say(`Postgres major: ${result.postgresMajor ?? "unknown"}`);
  say(`Publishable key id: ${result.publishableKey.id}`);
  say(
    `Publishable key token: ${result.publishableKey.token} (the value for NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY, public by design)`,
  );
}
