import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildDeclarationLines } from "../../../lib/catalog/declarations";
import { getCatalogService } from "../../../lib/catalog/load-content";
import { parseProductIdsQuery } from "../../../lib/catalog/middlewares/store";
import { defineAllowlistSerializer } from "../../../lib/serializers/define-allowlist-serializer";
import { filterSellableProducts } from "../../../lib/ship-from";
import {
  CUSTOMER_IDENTITY_DEFAULTS,
  type CustomerIdentitySettings,
  getCustomerIdentitySettings,
} from "../../../lib/settings/customer-identity";

const entrySerializer = defineAllowlistSerializer<{
  product_id: string;
  lines: { label: string; value: string }[];
}>({
  name: "store-product-declarations",
  audience: "store",
  shape: { product_id: true, lines: { label: true, value: true } },
});

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ids = parseProductIdsQuery(req);

  // A settings failure must never show text and never fail the page: answer hidden.
  let settings: CustomerIdentitySettings = CUSTOMER_IDENTITY_DEFAULTS;
  try {
    settings = await getCustomerIdentitySettings(req.scope);
  } catch (error) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as { warn: (message: string) => void };
    logger.warn(
      `[product-declarations] settings read failed, answering hidden: ${error instanceof Error ? error.message : "unknown"}`
    );
  }

  const mode = settings.lm_display_mode;
  if (mode === "hidden") {
    res.json({ mode: "hidden", declarations: [] });
    return;
  }

  const sellable = await filterSellableProducts(req.scope, ids);
  const declared = new Map<string, Record<string, string | null>>();
  if (mode === "product_declared" && sellable.length > 0) {
    const rows = await getCatalogService(req.scope).listProductDeclarations(
      { product_id: sellable },
      { take: null }
    );
    for (const row of rows) {
      declared.set(String(row.product_id), row as unknown as Record<string, string | null>);
    }
  }

  const entries = sellable
    .map((id) => ({
      product_id: id,
      lines: buildDeclarationLines(mode, settings, declared.get(id) ?? null),
    }))
    .filter((entry) => entry.lines.length > 0);

  res.json({ mode, declarations: entrySerializer.serializeMany(entries) });
}
