import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261124193718 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "staff_role" drop constraint if exists "staff_role_key_unique";`);
    this.addSql(`alter table if exists "staff_assignment" drop constraint if exists "staff_assignment_break_glass_unique";`);
    this.addSql(`alter table if exists "staff_assignment" drop constraint if exists "staff_assignment_user_role_unique";`);
    this.addSql(`alter table if exists "break_glass_review" drop constraint if exists "break_glass_review_open_unique";`);
    this.addSql(`create table if not exists "break_glass_review" ("id" text not null, "opened_at" timestamptz not null, "actor_user_id" text not null, "window_key" text not null, "first_ip" text null, "first_request" text null, "closed_at" timestamptz null, "closed_by" text null, "rotated_confirmed" boolean not null default false, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "break_glass_review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_break_glass_review_deleted_at" ON "break_glass_review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_break_glass_review_actor_user_id" ON "break_glass_review" ("actor_user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_break_glass_review_open_unique" ON "break_glass_review" ("actor_user_id") WHERE closed_at IS NULL AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "staff_assignment" ("id" text not null, "user_id" text not null, "role_key" text not null, "is_break_glass" boolean not null default false, "assigned_by" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "staff_assignment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_assignment_deleted_at" ON "staff_assignment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_assignment_user_id" ON "staff_assignment" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_assignment_role_key" ON "staff_assignment" ("role_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_assignment_user_role_unique" ON "staff_assignment" ("user_id", "role_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_assignment_break_glass_unique" ON "staff_assignment" ("is_break_glass") WHERE is_break_glass = true AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "staff_role" ("id" text not null, "key" text not null, "label" text not null, "description" text null, "permissions" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "staff_role_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_role_key_unique" ON "staff_role" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_role_deleted_at" ON "staff_role" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "break_glass_review" cascade;`);

    this.addSql(`drop table if exists "staff_assignment" cascade;`);

    this.addSql(`drop table if exists "staff_role" cascade;`);
  }

}
