import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAuditSafe } from "../lib/audit";

// Event payload keys from the integration spike: actor, change, fields,
// provider_id. There is no integration row id and no change id on the event;
// provider_id is the stable key, and the newest change id is looked up after.
const INTEGRATION_ID_KEYS = ["provider_id"];
const CHANGE_ID_KEYS = ["change_id", "integration_change_id"];
const INTEGRATION_MODULE_KEY = "integration";
const LIST_CHANGES_METHOD = "listIntegrationChanges";

const pick = (
  data: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

// Only ever reads an id string from `change`; never copies option values.
const changeIdFromEvent = (data: Record<string, unknown>): string | undefined => {
  const fromKeys = pick(data, CHANGE_ID_KEYS);
  if (fromKeys) {
    return fromKeys;
  }
  const change = data.change;
  if (typeof change === "string" && change.length > 0) {
    return change;
  }
  if (
    change &&
    typeof change === "object" &&
    !Array.isArray(change) &&
    typeof (change as { id?: unknown }).id === "string"
  ) {
    const id = (change as { id: string }).id;
    return id.length > 0 ? id : undefined;
  }
  return undefined;
};

type ListChanges = (
  filters: Record<string, unknown>,
  config: Record<string, unknown>
) => Promise<{ id: string }[]>;

// Reads only the id column of the newest change row, never the option values.
const newestChangeId = async (
  container: SubscriberArgs<unknown>["container"],
  providerId: string
): Promise<string | undefined> => {
  const service = container.resolve(INTEGRATION_MODULE_KEY) as unknown as Record<
    string,
    unknown
  >;
  const list = service[LIST_CHANGES_METHOD] as ListChanges | undefined;
  if (typeof list !== "function") {
    return undefined;
  }
  const rows = await list.call(
    service,
    { provider_id: providerId },
    { select: ["id"], order: { created_at: "DESC" }, take: 1 }
  );
  return rows[0]?.id;
};

export default async function integrationUpdatedAuditHandler({
  event,
  container,
}: SubscriberArgs<Record<string, unknown>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  try {
    const data = event.data ?? {};
    const providerId = pick(data, INTEGRATION_ID_KEYS);
    if (!providerId) {
      logger.warn(
        "[integration-updated-audit] event carries no provider_id, skipping"
      );
      return;
    }

    let changeId = changeIdFromEvent(data);
    if (!changeId) {
      try {
        changeId = await newestChangeId(container, providerId);
      } catch (error) {
        logger.warn(
          `[integration-updated-audit] change id lookup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await recordAuditSafe(container, {
      action: "integration.updated",
      actor: { type: "system", label: "integration-module" },
      target: { type: "integration", id: providerId },
      meta: changeId ? { change_id: changeId } : {},
    });
  } catch (error) {
    logger.error(
      `[integration-updated-audit] failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export const config: SubscriberConfig = {
  event: "integration.updated",
};
