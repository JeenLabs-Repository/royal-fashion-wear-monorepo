import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";

export const AUDIT_PAGE_SIZE = 50;

export type AuditRow = {
  id: string;
  at: Date | string;
  actor_id: string | null;
  actor_type: string;
  actor_label: string | null;
  roles: unknown;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  http_method: string | null;
  http_path: string | null;
  http_route: string | null;
  http_status: number | null;
  ip: string | null;
  forwarded_for: string | null;
  user_agent: string | null;
  request_id: string | null;
  meta: unknown;
};

export type AuditReader = {
  listAuditEntries: (
    filters: Record<string, unknown>,
    config: { take: number; order: Record<string, "ASC" | "DESC"> }
  ) => Promise<AuditRow[]>;
};

const CURSOR_ID_PATTERN = /^[A-Za-z0-9_]{3,64}$/;

// The cursor only marks a position in the listing, so it is opaque and not secret.
export const encodeCursor = (at: Date | string, id: string): string =>
  Buffer.from(
    JSON.stringify({ at: new Date(at).toISOString(), id }),
    "utf8"
  ).toString("base64url");

export const decodeCursor = (cursor: string): { at: Date; id: string } => {
  const invalid = () =>
    new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The cursor is not valid.",
      "invalid_cursor"
    );
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const { at, id } = (parsed ?? {}) as { at?: unknown; id?: unknown };
  if (typeof at !== "string" || typeof id !== "string" || !CURSOR_ID_PATTERN.test(id)) {
    throw invalid();
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    throw invalid();
  }
  return { at: date, id };
};

export const auditQuerySchema = z.strictObject({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  actor: z.string().trim().min(1).max(100).optional(),
  action_prefix: z
    .string()
    .regex(/^[A-Za-z_.]{1,40}$/)
    .optional(),
  target_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

// Percent, underscore and backslash are pattern characters in LIKE, so a typed value must not carry them through.
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

export const buildAuditFilter = (params: Partial<AuditQuery>): Record<string, unknown> => {
  const conditions: Record<string, unknown>[] = [];

  if (params.from) {
    conditions.push({ at: { $gte: new Date(params.from) } });
  }
  if (params.to) {
    conditions.push({ at: { $lte: new Date(params.to) } });
  }
  if (params.actor) {
    conditions.push({
      $or: [
        { actor_id: params.actor },
        { actor_label: { $ilike: `%${escapeLike(params.actor)}%` } },
      ],
    });
  }
  if (params.action_prefix) {
    conditions.push({ action: { $like: `${escapeLike(params.action_prefix)}%` } });
  }
  if (params.target_id) {
    conditions.push({ target_id: params.target_id });
  }
  if (params.cursor) {
    const position = decodeCursor(params.cursor);
    conditions.push({
      $or: [
        { at: { $lt: position.at } },
        { at: position.at, id: { $lt: position.id } },
      ],
    });
  }

  return conditions.length > 0 ? { $and: conditions } : {};
};

export const queryAuditEntries = async (
  service: AuditReader,
  params: Partial<AuditQuery>
): Promise<{ rows: AuditRow[]; next_cursor: string | null }> => {
  const limit = params.limit ?? AUDIT_PAGE_SIZE;
  const rows = await service.listAuditEntries(buildAuditFilter(params), {
    take: limit + 1,
    order: { at: "DESC", id: "DESC" },
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    next_cursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
  };
};

// Response rows are built field by field from the table's columns, never spread.
export const toAuditResponse = (row: AuditRow) => ({
  id: row.id,
  at: row.at,
  actor_id: row.actor_id,
  actor_type: row.actor_type,
  actor_label: row.actor_label,
  roles: row.roles,
  action: row.action,
  target_type: row.target_type,
  target_id: row.target_id,
  before: row.before,
  after: row.after,
  http_method: row.http_method,
  http_path: row.http_path,
  http_route: row.http_route,
  http_status: row.http_status,
  ip: row.ip,
  forwarded_for: row.forwarded_for,
  user_agent: row.user_agent,
  request_id: row.request_id,
  meta: row.meta,
});
