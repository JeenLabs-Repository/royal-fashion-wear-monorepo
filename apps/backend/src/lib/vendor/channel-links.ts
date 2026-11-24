import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";
import { getVendorModule } from "./vendor-module";

type ResolvingContainer = Pick<MedusaContainer, "resolve">;

export type ChannelLinkChanges = { added: string[]; removed: string[] };

/** The sales channel the storefront sells through, read from the store's default. */
export async function getStoreSalesChannelId(
  container: ResolvingContainer
): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  const { data } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  const salesChannelId = data[0]?.default_sales_channel_id as string | undefined;
  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "The store has no default sales channel."
    );
  }
  return salesChannelId;
}

/**
 * Makes the sales channel links match the rule "linked only while the vendor is
 * active and the location is active". It reads the current links, changes only
 * what differs, and is safe to run again. Returns the stock location ids it
 * changed so a caller can undo exactly that.
 */
export async function reconcileVendorChannelLinks(
  container: MedusaContainer,
  vendorId: string
): Promise<ChannelLinkChanges> {
  const vendorModule = getVendorModule(container);
  const [vendor] = await vendorModule.listVendors({ id: vendorId }, { take: 1 });
  if (!vendor) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor not found.");
  }

  const locations = (
    await vendorModule.listVendorLocations({ vendor_id: vendorId }, { take: null })
  ).filter((location) => Boolean(location.stock_location_id));
  const changes: ChannelLinkChanges = { added: [], removed: [] };
  if (locations.length === 0) {
    return changes;
  }

  const salesChannelId = await getStoreSalesChannelId(container);
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { id: locations.map((location) => location.stock_location_id) },
  });
  const linkedByStockLocation = new Map<string, Set<string>>(
    data.map((row) => [
      row.id as string,
      new Set<string>(
        ((row.sales_channels ?? []) as ({ id: string } | null)[])
          .filter((channel): channel is { id: string } => Boolean(channel))
          .map((channel) => channel.id)
      ),
    ])
  );

  for (const location of locations) {
    const stockLocationId = location.stock_location_id as string;
    const desired = vendor.status === "active" && location.status === "active";
    const linked = linkedByStockLocation.get(stockLocationId)?.has(salesChannelId) ?? false;

    if (desired && !linked) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocationId, add: [salesChannelId] },
      });
      changes.added.push(stockLocationId);
    } else if (!desired && linked) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocationId, remove: [salesChannelId] },
      });
      changes.removed.push(stockLocationId);
    }
  }
  return changes;
}
