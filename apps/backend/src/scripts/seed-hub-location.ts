import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import { deleteShippingOptionsWorkflow } from "@medusajs/medusa/core-flows";
import {
  ensureHubLocation,
  readHubEnvironment,
  STANDARD_DELIVERY_NAME,
} from "../lib/hub/ensure-hub-location";

const REMOVE_FLAG = "--remove-other-shipping-options";

// Run with: medusa exec ./src/scripts/seed-hub-location.ts
// Args are read from ExecArgs; REMOVE_OTHER_SHIPPING_OPTIONS=1 is the env fallback.
export default async function seedHubLocation({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const env = readHubEnvironment(process.env);

  if (process.env.NODE_ENV === "production" && env.problems.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `[seed-hub-location] Refusing to run in production: ${env.problems.join("; ")}`
    );
  }
  if (env.problems.length) {
    logger.warn(`[seed-hub-location] ${env.problems.join("; ")}`);
  }

  const result = await ensureHubLocation(container, {
    address: env.address,
    shippingPriceInr: env.shippingPriceInr,
  });

  const word = (made: boolean) => (made ? "created" : "exists");
  logger.info(`[seed-hub-location] stock location ${result.stockLocationId}: ${word(result.created)}`);
  logger.info(`[seed-hub-location] fulfilment set ${result.fulfillmentSetId}`);
  logger.info(`[seed-hub-location] service zone ${result.serviceZoneId}`);
  logger.info(`[seed-hub-location] shipping option ${result.shippingOptionId}: ${word(result.created)}`);

  const fulfillment = container.resolve(Modules.FULFILLMENT) as unknown as {
    listShippingOptions(
      filters: Record<string, unknown>
    ): Promise<{ id: string; name: string }[]>;
  };
  const others = (await fulfillment.listShippingOptions({})).filter(
    (option) => option.id !== result.shippingOptionId
  );

  const remove =
    (args ?? []).includes(REMOVE_FLAG) ||
    process.env.REMOVE_OTHER_SHIPPING_OPTIONS === "1";

  if (others.length && remove) {
    await deleteShippingOptionsWorkflow(container).run({
      input: { ids: others.map((option) => option.id) },
    });
    for (const option of others) {
      logger.info(`[seed-hub-location] removed shipping option ${option.id} (${option.name})`);
    }
  } else {
    for (const option of others) {
      logger.warn(
        `[seed-hub-location] WARNING other shipping option ${option.id} (${option.name}) still exists. Pass ${REMOVE_FLAG} to delete it.`
      );
    }
  }

  const final = await fulfillment.listShippingOptions({ name: STANDARD_DELIVERY_NAME });
  logger.info(`[seed-hub-location] "${STANDARD_DELIVERY_NAME}" options found: ${final.length}`);
}
