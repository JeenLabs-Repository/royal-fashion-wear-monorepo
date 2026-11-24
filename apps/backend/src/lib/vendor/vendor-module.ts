import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { VENDOR_MODULE } from "../../modules/vendor";
import type VendorModuleService from "../../modules/vendor/service";

type ResolvingContainer = Pick<MedusaContainer, "resolve">;

/** The one place that knows how the vendor module service is resolved. */
export const getVendorModule = (
  container: ResolvingContainer
): VendorModuleService => container.resolve<VendorModuleService>(VENDOR_MODULE);

type LogLevel = "info" | "warn" | "error";

/** Logs through the Medusa logger and falls back to the console when the container has none. */
export const logWith = (
  container: ResolvingContainer,
  level: LogLevel,
  message: string
): void => {
  try {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Record<
      LogLevel,
      (text: string) => void
    >;
    logger[level](message);
  } catch {
    console[level](message);
  }
};
