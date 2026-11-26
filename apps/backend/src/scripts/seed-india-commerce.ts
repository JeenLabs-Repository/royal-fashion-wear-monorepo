import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedIndiaCommerce } from "../lib/commerce/india-seed";

export default async function seedIndiaCommerceScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const report = await seedIndiaCommerce(container);
  for (const line of report.created) {
    logger.info(`[seed-india] created: ${line}`);
  }
  for (const line of report.updated) {
    logger.info(`[seed-india] updated: ${line}`);
  }
  if (report.created.length === 0 && report.updated.length === 0) {
    logger.info("[seed-india] nothing to change");
  }
}