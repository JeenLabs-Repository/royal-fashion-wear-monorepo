import type { MedusaContainer } from "@medusajs/framework";
import { logger } from "@medusajs/framework/logger";
import {
  isAlreadySeeded,
  seedCategories,
  seedCollections,
  seedFulfillment,
  seedInventoryLevels,
  seedProductOptionMetadata,
  seedProductOptions,
  seedProducts,
  seedRegions,
  seedStockLocations,
  seedStore,
  seedTaxRegions,
  seedTranslations,
  step,
} from "./lib";

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  // Medusa can run this folder during db:migrate, so the demo store and catalog
  // appear only when someone asks for them. A real first deploy uses the
  // bootstrap script instead.
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    logger.info(
      "[initial-data-seed] skipped. Set ALLOW_DEMO_SEED=1 to create the demo store and catalog.",
    );
    return;
  }

  if (await isAlreadySeeded(container)) return;

  await step(seedStore(container), "store data");
  await step(seedRegions(container), "regions");
  await step(seedTaxRegions(container), "tax regions");
  await step(seedStockLocations(container), "stock locations");
  await step(seedFulfillment(container), "fulfillment data");
  await step(seedCategories(container), "product categories");
  await step(seedProductOptions(container), "product options");
  await step(seedProducts(container), "products");
  await step(seedProductOptionMetadata(container), "product option metadata");
  await step(seedCollections(container), "product collections");
  await step(seedTranslations(container), "translations");
  await step(seedInventoryLevels(container), "inventory levels");
}
