import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedCanary } from "./lib/canary-seed";

const readFlag = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

// Creates the canary vendors, a publishable key and the crawl manifest.
// Development and test only: it refuses to run in production.
export default async function seedCanaryScript({ container, args }: ExecArgs) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[seed-canary] Refusing to run in production.");
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const { manifestPath } = await seedCanary(container, {
    outDir: readFlag(args ?? [], "--out-dir"),
  });
  logger.info(`[seed-canary] manifest written to ${manifestPath}`);
}
