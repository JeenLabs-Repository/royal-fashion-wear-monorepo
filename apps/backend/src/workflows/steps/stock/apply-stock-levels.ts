import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createInventoryLevelsWorkflow,
  deleteInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows";
import { getQuery } from "../../../lib/catalog/load-content";
import type { ResolvedEntry } from "./validate-stock-entries";

export type ApplyStockLevelsInput = { entries: ResolvedEntry[] };

type Compensation = {
  created: { inventory_item_id: string; location_id: string }[];
  updated: { inventory_item_id: string; location_id: string; previous: number }[];
};

/**
 * Writes absolute quantities through the core inventory workflows only: missing levels are
 * created in one batch, existing ones updated in one batch. The compensation restores the
 * previous quantities and removes the levels this step created.
 */
export const applyStockLevelsStep = createStep(
  "apply-stock-levels",
  async (input: ApplyStockLevelsInput, { container }) => {
    const toCreate = input.entries.filter((entry) => entry.level_id === null);
    const toUpdate = input.entries.filter((entry) => entry.level_id !== null);

    if (toCreate.length > 0) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: toCreate.map((entry) => ({
            inventory_item_id: entry.inventory_item_id,
            location_id: entry.location_id,
            stocked_quantity: entry.stocked_quantity,
          })),
        },
      });
    }
    if (toUpdate.length > 0) {
      await updateInventoryLevelsWorkflow(container).run({
        input: {
          updates: toUpdate.map((entry) => ({
            inventory_item_id: entry.inventory_item_id,
            location_id: entry.location_id,
            stocked_quantity: entry.stocked_quantity,
          })),
        },
      });
    }

    const compensation: Compensation = {
      created: toCreate.map((entry) => ({
        inventory_item_id: entry.inventory_item_id,
        location_id: entry.location_id,
      })),
      updated: toUpdate.map((entry) => ({
        inventory_item_id: entry.inventory_item_id,
        location_id: entry.location_id,
        previous: entry.previous_quantity as number,
      })),
    };
    return new StepResponse({ applied: input.entries.length }, compensation);
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    if (compensation.updated.length > 0) {
      await updateInventoryLevelsWorkflow(container).run({
        input: {
          updates: compensation.updated.map((entry) => ({
            inventory_item_id: entry.inventory_item_id,
            location_id: entry.location_id,
            stocked_quantity: entry.previous,
          })),
        },
      });
    }
    if (compensation.created.length > 0) {
      const { data } = await getQuery(container).graph({
        entity: "inventory_level",
        fields: ["id"],
        filters: {
          inventory_item_id: compensation.created.map((entry) => entry.inventory_item_id),
          location_id: compensation.created.map((entry) => entry.location_id),
        },
      });
      const ids = data.map((level) => String(level.id));
      if (ids.length > 0) {
        await deleteInventoryLevelsWorkflow(container).run({ input: { id: ids } as never });
      }
    }
  }
);
