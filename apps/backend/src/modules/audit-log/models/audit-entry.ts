import { model } from "@medusajs/framework/utils";

// One row per recorded action. Rows are never changed: a database trigger
// rejects UPDATE, DELETE and TRUNCATE. The columns hold plain ids and key
// names, with no link to any other module, so a row stays readable after the
// thing it describes is gone.
const AuditEntry = model
  .define("audit_entry", {
    id: model.id({ prefix: "aud" }).primaryKey(),
    at: model.dateTime(),
    actor_id: model.text().nullable(),
    actor_type: model.enum(["user", "vendor", "customer", "system"]),
    // The email at the time of the action.
    actor_label: model.text().nullable(),
    // Role keys held at the time of the action.
    roles: model.json().nullable(),
    // <domain>.<verb>, from lib/audit/actions.ts.
    action: model.text(),
    target_type: model.text().nullable(),
    target_id: model.text().nullable(),
    before: model.json().nullable(),
    after: model.json().nullable(),
    http_method: model.text().nullable(),
    http_path: model.text().nullable(),
    // The permission manifest pattern that matched, not the raw path.
    http_route: model.text().nullable(),
    http_status: model.number().nullable(),
    ip: model.text().nullable(),
    forwarded_for: model.text().nullable(),
    user_agent: model.text().nullable(),
    request_id: model.text().nullable(),
    meta: model.json().nullable(),
  })
  .indexes([
    { name: "IDX_audit_entry_at", on: ["at"] },
    { name: "IDX_audit_entry_actor_id_at", on: ["actor_id", "at"] },
    { name: "IDX_audit_entry_action_at", on: ["action", "at"] },
    { name: "IDX_audit_entry_target_id", on: ["target_id"] },
  ]);

export default AuditEntry;
