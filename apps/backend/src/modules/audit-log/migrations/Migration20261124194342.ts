import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261124194342 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "audit_entry" ("id" text not null, "at" timestamptz not null, "actor_id" text null, "actor_type" text check ("actor_type" in ('user', 'vendor', 'customer', 'system')) not null, "actor_label" text null, "roles" jsonb null, "action" text not null, "target_type" text null, "target_id" text null, "before" jsonb null, "after" jsonb null, "http_method" text null, "http_path" text null, "http_route" text null, "http_status" integer null, "ip" text null, "forwarded_for" text null, "user_agent" text null, "request_id" text null, "meta" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "audit_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_entry_deleted_at" ON "audit_entry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_entry_at" ON "audit_entry" ("at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_entry_actor_id_at" ON "audit_entry" ("actor_id", "at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_entry_action_at" ON "audit_entry" ("action", "at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_entry_target_id" ON "audit_entry" ("target_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "audit_entry" cascade;`);
  }

}
