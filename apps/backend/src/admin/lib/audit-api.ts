import { sdk } from "./client";

export type AuditEntry = {
  id: string;
  at: string;
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

export type AuditFilters = {
  from?: string;
  to?: string;
  actor?: string;
  action_prefix?: string;
  target_id?: string;
};

export type AuditLogResponse = { entries: AuditEntry[]; next_cursor: string | null };

const AUDIT_PATH = "/admin/audit-log";

export const auditKeys = {
  list: (filters: AuditFilters) => ["audit-log", filters] as const,
};

export const fetchAuditLog = (filters: AuditFilters, cursor?: string) => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      query[key] = value;
    }
  }
  if (cursor) {
    query.cursor = cursor;
  }
  return sdk.client.fetch<AuditLogResponse>(AUDIT_PATH, { query });
};
