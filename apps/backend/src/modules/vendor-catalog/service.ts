import type { Context } from "@medusajs/framework/types";
import {
  InjectManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import CatalogCounter from "./models/catalog-counter";
import ProductDeclaration from "./models/product-declaration";
import ProductSubmission from "./models/product-submission";
import VendorUpload from "./models/vendor-upload";
import VendorVariantRef from "./models/vendor-variant-ref";

const PLATFORM_SKU_COUNTER = "platform_sku";

// The injected manager is a MikroORM manager. Only what this file calls is typed.
type SqlManager = {
  execute?: (sql: string, params?: unknown[]) => Promise<unknown>;
  getConnection?: () => {
    execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  };
};

// Matches the vendor module runSql helper. manager.execute is confirmed on the
// injected MikroORM manager in Phase 3; getConnection().execute is the fallback.
const runSql = async (
  sharedContext: Context,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> => {
  const manager = sharedContext.manager as unknown as SqlManager | undefined;
  if (!manager) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "No database manager in the module context."
    );
  }
  const result = manager.execute
    ? await manager.execute(sql, params)
    : await manager.getConnection!().execute(sql, params);
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  return (result as { rows?: Record<string, unknown>[] } | undefined)?.rows ?? [];
};

class VendorCatalogService extends MedusaService({
  ProductSubmission,
  VendorVariantRef,
  ProductDeclaration,
  VendorUpload,
  CatalogCounter,
}) {
  /**
   * Next platform SKU number. One statement: the upsert takes the row lock, so
   * concurrent callers are served one after another and never share a number.
   * It never reads and then writes.
   */
  @InjectManager()
  async nextSkuNumber(@MedusaContext() sharedContext: Context = {}): Promise<number> {
    const rows = await runSql(
      sharedContext,
      `insert into catalog_counter (id, name, value, created_at, updated_at)
       values (?, ?, 1, now(), now())
       on conflict (id) do update set value = catalog_counter.value + 1, updated_at = now()
       returning value`,
      [PLATFORM_SKU_COUNTER, PLATFORM_SKU_COUNTER]
    );
    const value = Number(rows[0]?.value);
    if (!Number.isInteger(value) || value <= 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The platform SKU counter returned no number."
      );
    }
    return value;
  }
}

export default VendorCatalogService;
