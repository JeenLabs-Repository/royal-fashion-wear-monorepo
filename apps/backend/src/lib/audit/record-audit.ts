import { MedusaError } from "@medusajs/framework/utils";
import { AUDIT_LOG_MODULE } from "../../modules/audit-log/constants";
import { AUDIT_ACTIONS, type AuditAction } from "./actions";
import { redactAudit } from "./redact";

export type AuditContainer = { resolve: (key: string) => unknown };

export type AuditActorType = "user" | "vendor" | "customer" | "system";

export type RecordAuditInput = {
  action: AuditAction;
  actor: {
    id?: string | null;
    type: AuditActorType;
    label?: string | null;
    roles?: readonly string[];
  };
  /** The id is optional: a roster read, for example, has a target type and no single id. */
  target?: { type: string; id?: string | null };
  before?: unknown;
  after?: unknown;
  http?: { method?: string; path?: string; route?: string; status?: number };
  ip?: string | null;
  forwardedFor?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  meta?: unknown;
};

type LogLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type AuditWriter = {
  append: (row: Record<string, unknown>) => Promise<unknown>;
};

const resolveLogger = (container: AuditContainer): LogLike => {
  try {
    return container.resolve("logger") as LogLike;
  } catch {
    return { info: console.info, warn: console.warn, error: console.error };
  }
};

// A name outside the vocabulary is a programming error. It throws everywhere
// except production, where losing the row would be worse than a stray name.
const checkAction = (container: AuditContainer, action: string) => {
  if ((AUDIT_ACTIONS as readonly string[]).includes(action)) {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown audit action "${action}"`
    );
  }
  resolveLogger(container).warn(
    `[audit] unknown action "${action}" written anyway`
  );
};

const buildRow = (input: RecordAuditInput): Record<string, unknown> => ({
  actor_id: input.actor.id ?? null,
  actor_type: input.actor.type,
  actor_label: input.actor.label ?? null,
  roles: input.actor.roles ? [...input.actor.roles] : null,
  action: input.action,
  target_type: input.target?.type ?? null,
  target_id: input.target?.id ?? null,
  before: redactAudit(input.before) ?? null,
  after: redactAudit(input.after) ?? null,
  http_method: input.http?.method ?? null,
  http_path: input.http?.path ?? null,
  http_route: input.http?.route ?? null,
  http_status: input.http?.status ?? null,
  ip: input.ip ?? null,
  forwarded_for: input.forwardedFor ?? null,
  user_agent: input.userAgent ?? null,
  request_id: input.requestId ?? null,
  meta: redactAudit(input.meta) ?? null,
});

// Writes the row and logs one [audit] line. Logs and rethrows a write failure.
const persist = async (
  container: AuditContainer,
  row: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const logger = resolveLogger(container);
  try {
    const writer = container.resolve(AUDIT_LOG_MODULE) as AuditWriter;
    const stored = (await writer.append(row)) as Record<string, unknown>;
    logger.info(`[audit] ${JSON.stringify(stored ?? row)}`);
    return stored ?? row;
  } catch (error) {
    logger.error(
      `[audit] write failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
};

/**
 * Writes one audit row. Fails closed: a write failure rejects, so a workflow
 * step that calls this fails with it. Use inside workflow steps.
 */
export async function recordAudit(
  container: AuditContainer,
  input: RecordAuditInput
): Promise<Record<string, unknown>> {
  checkAction(container, input.action);
  return persist(container, buildRow(input));
}

/**
 * Same row, but a write failure is logged and swallowed. Use where the audit
 * must never break the request, such as the HTTP writer. An unknown action
 * still throws outside production because that is a programming error.
 */
export async function recordAuditSafe(
  container: AuditContainer,
  input: RecordAuditInput
): Promise<boolean> {
  checkAction(container, input.action);
  const row = buildRow(input);
  try {
    await persist(container, row);
    return true;
  } catch {
    return false;
  }
}
