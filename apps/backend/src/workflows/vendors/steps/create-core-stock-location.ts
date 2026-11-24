import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createStockLocationsWorkflow,
  deleteStockLocationsWorkflow,
  updateStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { MedusaContainer } from "@medusajs/framework/types";
import { getStateByCode, toMedusaProvince } from "../../../lib/geo-india/states";

export type CreateCoreStockLocationInput = { code: string; state_code: string };

// The stock location is the only vendor-related record the Store API can reach,
// so it carries nothing about the vendor. The name is the opaque code. The
// address holds the country and the state only, and there is no metadata.
export const createCoreStockLocationStep = createStep(
  "create-core-stock-location",
  async (input: CreateCoreStockLocationInput, { container }) => {
    const province = toMedusaProvince(input.state_code);
    const fallbackLine = getStateByCode(input.state_code)?.name ?? "India";

    const run = (addressLine: string) =>
      createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: input.code,
              address: { address_1: addressLine, country_code: "in", province },
            },
          ],
        },
      });
    let created;
    try {
      created = await run("");
    } catch {
      created = await run(fallbackLine);
    }
    const [stockLocation] = created.result;
    return new StepResponse({ id: stockLocation.id as string }, { id: stockLocation.id as string });
  },
  async (compensation, { container }) => {
    if (!compensation?.id) {
      return;
    }
    await deleteStockLocationsWorkflow(container).run({ input: { ids: [compensation.id] } });
  }
);

/**
 * Sets the province of an existing stock location. Reads the current first
 * address line so the vendor's data is never needed here.
 */
export async function setStockLocationProvince(
  container: MedusaContainer,
  stockLocationId: string,
  stateCode: string
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "address.address_1"],
    filters: { id: stockLocationId },
  });
  const currentLine = (data[0]?.address?.address_1 as string | undefined) ?? "";
  await updateStockLocationsWorkflow(container).run({
    input: {
      selector: { id: stockLocationId },
      update: {
        address: {
          address_1: currentLine,
          country_code: "in",
          province: toMedusaProvince(stateCode),
        },
      },
    },
  });
}
