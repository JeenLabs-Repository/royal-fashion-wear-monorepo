import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261124224019 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vendor_user" drop constraint if exists "vendor_user_email_unique";`);
    this.addSql(`alter table if exists "vendor_location" drop constraint if exists "vendor_location_stock_location_id_unique";`);
    this.addSql(`alter table if exists "vendor_location" drop constraint if exists "vendor_location_code_unique";`);
    this.addSql(`alter table if exists "vendor_invite" drop constraint if exists "vendor_invite_token_hash_unique";`);
    this.addSql(`create table if not exists "location_code_seq" ("id" text not null, "last_value" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "location_code_seq_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_location_code_seq_deleted_at" ON "location_code_seq" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor" ("id" text not null, "internal_name" text not null, "contact_name" text not null, "contact_email" text not null, "status" text check ("status" in ('invited', 'active', 'suspended')) not null default 'invited', "activated_at" timestamptz null, "suspended_at" timestamptz null, "suspend_reason" text null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_deleted_at" ON "vendor" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_status" ON "vendor" ("status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_agreement_acceptance" ("id" text not null, "vendor_user_id" text not null, "version" text not null, "accepted_at" timestamptz not null, "ip" text null, "user_agent" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_agreement_acceptance_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_agreement_acceptance_deleted_at" ON "vendor_agreement_acceptance" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_agreement_acceptance_vendor_user_id" ON "vendor_agreement_acceptance" ("vendor_user_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_invite" ("id" text not null, "vendor_user_id" text not null, "token_hash" text not null, "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_invite_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_invite_token_hash_unique" ON "vendor_invite" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_invite_deleted_at" ON "vendor_invite" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_invite_vendor_user_id" ON "vendor_invite" ("vendor_user_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_location" ("id" text not null, "vendor_id" text not null, "code" text not null, "label" text not null, "state_code" text not null, "pin" text not null, "address_1" text not null, "address_2" text null, "city" text null, "pickup_contact_name" text not null, "pickup_contact_phone" text not null, "status" text check ("status" in ('active', 'inactive')) not null default 'active', "stock_location_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_location_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_location_code_unique" ON "vendor_location" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_location_stock_location_id_unique" ON "vendor_location" ("stock_location_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_location_deleted_at" ON "vendor_location" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_location_vendor_id" ON "vendor_location" ("vendor_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_user" ("id" text not null, "vendor_id" text not null, "email" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_user_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_user_email_unique" ON "vendor_user" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_user_deleted_at" ON "vendor_user" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_user_vendor_id" ON "vendor_user" ("vendor_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "location_code_seq" cascade;`);

    this.addSql(`drop table if exists "vendor" cascade;`);

    this.addSql(`drop table if exists "vendor_agreement_acceptance" cascade;`);

    this.addSql(`drop table if exists "vendor_invite" cascade;`);

    this.addSql(`drop table if exists "vendor_location" cascade;`);

    this.addSql(`drop table if exists "vendor_user" cascade;`);
  }

}
