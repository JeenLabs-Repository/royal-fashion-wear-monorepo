import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";
import {
  getStoreSalesChannelId,
  reconcileVendorChannelLinks,
} from "../../../lib/vendor/channel-links";

export type ReconcileChannelLinksInput = { vendor_id: string };

export const reconcileChannelLinksStep = createStep(
  "reconcile-channel-links",
  async (input: ReconcileChannelLinksInput, { container }) => {
    const changes = await reconcileVendorChannelLinks(container, input.vendor_id);
    return new StepResponse(changes, {
      added: changes.added,
      removed: changes.removed,
    });
  },
  // Reverses exactly the links this run changed, no more.
  async (compensation, { container }) => {
    if (!compensation || (compensation.added.length === 0 && compensation.removed.length === 0)) {
      return;
    }
    const salesChannelId = await getStoreSalesChannelId(container);
    for (const stockLocationId of compensation.added) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocationId, remove: [salesChannelId] },
      });
    }
    for (const stockLocationId of compensation.removed) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocationId, add: [salesChannelId] },
      });
    }
  }
);
