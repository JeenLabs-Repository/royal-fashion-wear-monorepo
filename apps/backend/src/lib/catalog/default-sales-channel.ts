import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { getQuery } from "./load-content";

/** The store's default sales channel, the one products are linked to when they go on sale. */
export async function getDefaultSalesChannelId(scope: MedusaContainer): Promise<string> {
  const { data } = await getQuery(scope).graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  const channelId = data[0]?.default_sales_channel_id;
  if (!channelId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The store has no default sales channel."
    );
  }
  return String(channelId);
}
