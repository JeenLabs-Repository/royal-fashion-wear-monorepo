import { MedusaError, MedusaService } from "@medusajs/framework/utils";
import AuditEntry from "./models/audit-entry";

export type AuditEntryInput = {
  at?: Date;
  actor_id?: string | null;
  actor_type: "user" | "vendor" | "customer" | "system";
  actor_label?: string | null;
  roles?: string[] | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  before?: unknown;
  after?: unknown;
  http_method?: string | null;
  http_path?: string | null;
  http_route?: string | null;
  http_status?: number | null;
  ip?: string | null;
  forwarded_for?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
  meta?: unknown;
};

const MAX_HEADER_TEXT = 200;

const clip = (value: string | null | undefined) =>
  typeof value === "string" ? value.slice(0, MAX_HEADER_TEXT) : value;

const asJson = (value: unknown) =>
  (value === undefined ? null : value) as Record<string, unknown> | null;

const appendOnly = (): never => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "audit_entry is append-only"
  );
};

class AuditLogModuleService extends MedusaService({ AuditEntry }) {
  /** The only write path. Sets `at` when missing and clips the two header-derived fields. */
  async append(input: AuditEntryInput) {
    const [row] = await this.createAuditEntries([
      {
        ...input,
        at: input.at ?? new Date(),
        roles: input.roles
          ? ([...input.roles] as unknown as Record<string, unknown>)
          : null,
        before: asJson(input.before),
        after: asJson(input.after),
        meta: asJson(input.meta),
        forwarded_for: clip(input.forwarded_for),
        user_agent: clip(input.user_agent),
      },
    ]);
    return row;
  }

  // Defence in depth. The trigger on the table is the real guarantee.
  // MedusaService exposes these as instance properties, so they must be
  // overridden as arrow properties rather than methods.
  override updateAuditEntries = (..._args: unknown[]): Promise<never> =>
    appendOnly();

  override deleteAuditEntries = (..._args: unknown[]): Promise<never> =>
    appendOnly();

  override softDeleteAuditEntries = (..._args: unknown[]): Promise<never> =>
    appendOnly();

  override restoreAuditEntries = (..._args: unknown[]): Promise<never> =>
    appendOnly();
}

export default AuditLogModuleService;
