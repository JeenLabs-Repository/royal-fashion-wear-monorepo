import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createRegionsWorkflow,
  createTaxRatesWorkflow,
  createTaxRegionsWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/medusa/core-flows";
import { ensureGstProductTypes } from "../catalog/ensure-gst-types";

// A local constant on purpose: the application builds before the plugin is installed.
export const RAZORPAY_PAYMENT_PROVIDER_ID = "pp_razorpay_razorpay";

export const INDIA_REGION_NAME = "India";
export const INDIA_COUNTRY_CODE = "in";
export const INDIA_CURRENCY_CODE = "inr";
export const TAX_PROVIDER_ID = "tp_system";

export const DEFAULT_GST_RATE = { code: "gst-18", name: "GST 18%", rate: 18 } as const;
export const SHIPPING_GST_RATE = {
  code: "gst-18-shipping",
  name: "GST 18% on shipping",
  rate: 18,
} as const;

/** One rate per product type value. The catalog code keeps its own list of allowed class names. */
export const GST_CLASS_RATES = [
  { value: "GST-0", code: "gst-0", name: "GST 0%", rate: 0 },
  { value: "GST-5", code: "gst-5", name: "GST 5%", rate: 5 },
  { value: "GST-18", code: "gst-18-class", name: "GST 18% (class)", rate: 18 },
  { value: "GST-40", code: "gst-40", name: "GST 40%", rate: 40 },
] as const;

export type SeedReport = {
  /** Plain text lines, one per thing the run created. Empty on a repeat run. */
  created: string[];
  /** Plain text lines, one per thing the run changed. Empty on a repeat run. */
  updated: string[];
};

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

type RuleSpec = { reference: "product_type" | "shipping_option"; reference_id: string };

type RateRow = {
  id: string;
  code: string;
  rate: number | null;
  rules: RuleSpec[];
};

const queryOf = (container: MedusaContainer): Query =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && [...left].sort().join("|") === [...right].sort().join("|");

type RegionRow = { id: string; name: string; providers: string[] };

// <RESOLVE: confirm the region graph exposes payment_providers. Command:
// grep -rn "payment_providers" apps/backend/node_modules/@medusajs/core-flows/dist/region/workflows/*.d.ts | head>
async function readRegions(container: MedusaContainer): Promise<RegionRow[]> {
  const { data } = await queryOf(container).graph({
    entity: "region",
    fields: ["id", "name", "payment_providers.id"],
  });
  return data.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    providers: (row.payment_providers ?? []).map((provider: { id: string }) => String(provider.id)),
  }));
}

async function setRegionProviders(
  container: MedusaContainer,
  regionId: string,
  providers: string[]
): Promise<void> {
  // <RESOLVE: confirm updateRegionsWorkflow replaces the provider list and accepts an empty list. Command:
  // grep -n "payment_providers\|selector\|update" apps/backend/node_modules/@medusajs/core-flows/dist/region/workflows/update-regions.d.ts>
  await updateRegionsWorkflow(container).run({
    input: { selector: { id: regionId }, update: { payment_providers: providers } },
  });
}

async function ensureRegion(container: MedusaContainer, report: SeedReport): Promise<string> {
  const regions = await readRegions(container);
  const india = regions.find((region) => region.name === INDIA_REGION_NAME);
  if (!india) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: INDIA_REGION_NAME,
            currency_code: INDIA_CURRENCY_CODE,
            countries: [INDIA_COUNTRY_CODE],
            payment_providers: [RAZORPAY_PAYMENT_PROVIDER_ID],
          },
        ],
      },
    });
    report.created.push(`region ${INDIA_REGION_NAME}`);
    return (result as { id: string }[])[0].id;
  }
  if (!sameSet(india.providers, [RAZORPAY_PAYMENT_PROVIDER_ID])) {
    await setRegionProviders(container, india.id, [RAZORPAY_PAYMENT_PROVIDER_ID]);
    report.updated.push(`region ${INDIA_REGION_NAME} payment providers`);
  }
  return india.id;
}

async function clearOtherRegionProviders(
  container: MedusaContainer,
  indiaRegionId: string,
  report: SeedReport
): Promise<void> {
  for (const region of await readRegions(container)) {
    if (region.id === indiaRegionId || region.providers.length === 0) {
      continue;
    }
    await setRegionProviders(container, region.id, []);
    report.updated.push(`region ${region.name} payment providers removed`);
  }
}

async function ensureOnePricePreference(
  container: MedusaContainer,
  attribute: "region_id" | "currency_code",
  value: string,
  label: string,
  report: SeedReport
): Promise<void> {
  // Currency-only prices need a currency_code preference. A region_id preference
  // only applies when the price itself carries a region_id rule (Medusa isTaxInclusive).
  const pricing = container.resolve(Modules.PRICING) as any;
  const found = await pricing.listPricePreferences({ attribute, value });
  if (found.length === 0) {
    await pricing.createPricePreferences({
      attribute,
      value,
      is_tax_inclusive: true,
    });
    report.created.push(label);
    return;
  }
  if (found[0].is_tax_inclusive !== true) {
    await pricing.updatePricePreferences(found[0].id, { is_tax_inclusive: true });
    report.updated.push(`${label} made tax inclusive`);
  }
}

async function ensurePricePreference(
  container: MedusaContainer,
  regionId: string,
  report: SeedReport
): Promise<void> {
  await ensureOnePricePreference(
    container,
    "region_id",
    regionId,
    "price preference for the India region",
    report
  );
  await ensureOnePricePreference(
    container,
    "currency_code",
    INDIA_CURRENCY_CODE,
    "price preference for INR",
    report
  );
}

async function ensureTaxRegion(container: MedusaContainer, report: SeedReport): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "tax_region",
    fields: ["id", "country_code", "province_code", "provider_id"],
    filters: { country_code: INDIA_COUNTRY_CODE },
  });
  const country = data.find((row) => !row.province_code);
  if (country) {
    return String(country.id);
  }
  // <RESOLVE: confirm default_tax_rate is accepted on a tax region. Command:
  // grep -n "default_tax_rate" apps/backend/node_modules/@medusajs/types/dist/tax/mutations.d.ts>
  const { result } = await createTaxRegionsWorkflow(container).run({
    input: [
      {
        country_code: INDIA_COUNTRY_CODE,
        provider_id: TAX_PROVIDER_ID,
        default_tax_rate: {
          rate: DEFAULT_GST_RATE.rate,
          code: DEFAULT_GST_RATE.code,
          name: DEFAULT_GST_RATE.name,
        },
      },
    ],
  });
  report.created.push("tax region IN");
  return (result as { id: string }[])[0].id;
}

async function readRates(container: MedusaContainer, taxRegionId: string): Promise<RateRow[]> {
  // <RESOLVE: confirm the tax_rate graph exposes rules. Command:
  // grep -rn "rules" apps/backend/node_modules/@medusajs/tax/dist/models/tax-rate.js | head>
  const { data } = await queryOf(container).graph({
    entity: "tax_rate",
    fields: ["id", "code", "rate", "rules.reference", "rules.reference_id"],
    filters: { tax_region_id: taxRegionId },
  });
  return data.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
    rules: (row.rules ?? []).map((rule: RuleSpec) => ({
      reference: rule.reference,
      reference_id: String(rule.reference_id),
    })),
  }));
}

type RateSpec = {
  code: string;
  name: string;
  rate: number;
  isDefault?: boolean;
  rules: RuleSpec[];
};

/**
 * Creates the rate when its code is missing. When the rate exists its value and
 * name are left alone (an accountant may have changed them in Admin) and only
 * rules that are missing get added.
 */
async function ensureRate(
  container: MedusaContainer,
  taxRegionId: string,
  spec: RateSpec,
  report: SeedReport
): Promise<void> {
  const current = (await readRates(container, taxRegionId)).find((rate) => rate.code === spec.code);
  if (!current) {
    await createTaxRatesWorkflow(container).run({
      input: [
        {
          tax_region_id: taxRegionId,
          name: spec.name,
          code: spec.code,
          rate: spec.rate,
          is_default: spec.isDefault ?? false,
          rules: spec.rules,
        },
      ],
    });
    report.created.push(`tax rate ${spec.code}`);
    return;
  }
  const have = new Set(current.rules.map((rule) => `${rule.reference}:${rule.reference_id}`));
  const missing = spec.rules.filter((rule) => !have.has(`${rule.reference}:${rule.reference_id}`));
  if (missing.length === 0) {
    return;
  }
  // <RESOLVE: confirm the generated method name for the rule model. Command:
  // grep -n "createTaxRateRules" apps/backend/node_modules/@medusajs/types/dist/tax/service.d.ts>
  const tax = container.resolve(Modules.TAX) as any;
  await tax.createTaxRateRules(missing.map((rule) => ({ tax_rate_id: current.id, ...rule })));
  report.updated.push(`tax rate ${spec.code} rules`);
}

async function ensureClassRates(
  container: MedusaContainer,
  taxRegionId: string,
  report: SeedReport
): Promise<void> {
  const before = await queryOf(container).graph({
    entity: "product_type",
    fields: ["value"],
    filters: { value: GST_CLASS_RATES.map((entry) => entry.value) },
  });
  const known = new Set(before.data.map((row) => String(row.value)));
  const typeIds = await ensureGstProductTypes(container);
  for (const entry of GST_CLASS_RATES) {
    if (!known.has(entry.value)) {
      report.created.push(`product type ${entry.value}`);
    }
    await ensureRate(
      container,
      taxRegionId,
      {
        code: entry.code,
        name: entry.name,
        rate: entry.rate,
        rules: [{ reference: "product_type", reference_id: typeIds[entry.value] }],
      },
      report
    );
  }
}

async function ensureShippingRate(
  container: MedusaContainer,
  taxRegionId: string,
  report: SeedReport
): Promise<void> {
  // Shipping options whose service zone covers India. Return options are included on purpose.
  const { data } = await queryOf(container).graph({
    entity: "shipping_option",
    fields: ["id", "service_zone.geo_zones.country_code"],
  });
  const ids = data
    .filter((option) =>
      (option.service_zone?.geo_zones ?? []).some(
        (zone: { country_code: string }) => zone.country_code === INDIA_COUNTRY_CODE
      )
    )
    .map((option) => String(option.id));
  await ensureRate(
    container,
    taxRegionId,
    {
      code: SHIPPING_GST_RATE.code,
      name: SHIPPING_GST_RATE.name,
      rate: SHIPPING_GST_RATE.rate,
      rules: ids.map((id) => ({ reference: "shipping_option" as const, reference_id: id })),
    },
    report
  );
}

/**
 * Makes the India region, its tax setup and the payment provider list match the
 * store's rules. Creates and updates only, never deletes, and never changes the
 * value of a rate that already exists. Safe to run any number of times.
 */
export async function seedIndiaCommerce(container: MedusaContainer): Promise<SeedReport> {
  const report: SeedReport = { created: [], updated: [] };
  const regionId = await ensureRegion(container, report);
  await ensurePricePreference(container, regionId, report);
  await clearOtherRegionProviders(container, regionId, report);
  const taxRegionId = await ensureTaxRegion(container, report);
  await ensureRate(
    container,
    taxRegionId,
    {
      code: DEFAULT_GST_RATE.code,
      name: DEFAULT_GST_RATE.name,
      rate: DEFAULT_GST_RATE.rate,
      isDefault: true,
      rules: [],
    },
    report
  );
  await ensureClassRates(container, taxRegionId, report);
  await ensureShippingRate(container, taxRegionId, report);
  return report;
}