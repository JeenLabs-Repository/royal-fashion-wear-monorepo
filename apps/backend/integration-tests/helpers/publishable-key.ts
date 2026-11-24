import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows";

// Creates a publishable key linked to the store's default sales channel and
// returns its token, for Store API calls in tests. When the test database has
// no default channel, a channel is created first.
export const createPublishableKey = async (
  container: MedusaContainer
): Promise<string> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });

  let channelId: string | undefined = stores[0]?.default_sales_channel_id;
  if (!channelId) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Test Channel" }] },
    });
    channelId = result[0].id;
  }

  const {
    result: [key],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [{ title: "Store guard test", type: "publishable", created_by: "" }],
    },
  });

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: key.id, add: [channelId] },
  });

  return key.token;
};
