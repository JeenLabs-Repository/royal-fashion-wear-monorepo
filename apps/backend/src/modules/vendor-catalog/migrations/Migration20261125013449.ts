import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261125013449 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vendor_variant_ref" drop constraint if exists "vendor_variant_ref_vendor_sku_unique";`);
    this.addSql(`alter table if exists "vendor_variant_ref" drop constraint if exists "vendor_variant_ref_variant_id_unique";`);
    this.addSql(`alter table if exists "vendor_upload" drop constraint if exists "vendor_upload_file_key_unique";`);
    this.addSql(`alter table if exists "product_submission" drop constraint if exists "product_submission_product_id_unique";`);
    this.addSql(`alter table if exists "product_declaration" drop constraint if exists "product_declaration_product_id_unique";`);
    this.addSql(`alter table if exists "catalog_counter" drop constraint if exists "catalog_counter_name_unique";`);
    this.addSql(`create table if not exists "catalog_counter" ("id" text not null, "name" text not null, "value" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_counter_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_counter_name_unique" ON "catalog_counter" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_counter_deleted_at" ON "catalog_counter" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_declaration" ("id" text not null, "product_id" text not null, "vendor_id" text not null, "generic_name" text null, "country_of_origin" text null, "packed_by_name" text null, "packed_by_address" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_declaration_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_declaration_product_id_unique" ON "product_declaration" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_declaration_deleted_at" ON "product_declaration" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_submission" ("id" text not null, "product_id" text not null, "vendor_id" text not null, "state" text check ("state" in ('draft', 'submitted', 'approved', 'changes_requested', 'rejected', 'withdrawn')) not null default 'draft', "is_live" boolean not null default false, "revision" integer not null default 1, "content_hash" text not null, "approved_content_hash" text null, "pending_changes" jsonb null, "proposed_category_id" text null, "proposed_gst_class" text check ("proposed_gst_class" in ('GST-0', 'GST-5', 'GST-18', 'GST-40', 'not_sure')) not null default 'not_sure', "proposed_hsn" text null, "reviewer_user_id" text null, "reason" text null, "approver_edits" jsonb null, "submitted_at" timestamptz null, "decided_at" timestamptz null, "hidden_by_suspension" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_submission_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_submission_product_id_unique" ON "product_submission" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_submission_deleted_at" ON "product_submission" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_submission_vendor_id" ON "product_submission" ("vendor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_submission_state_submitted_at" ON "product_submission" ("state", "submitted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_upload" ("id" text not null, "vendor_id" text not null, "file_key" text not null, "url" text not null, "product_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_upload_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_upload_file_key_unique" ON "vendor_upload" ("file_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_upload_deleted_at" ON "vendor_upload" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_upload_vendor_id" ON "vendor_upload" ("vendor_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vendor_variant_ref" ("id" text not null, "variant_id" text not null, "product_id" text not null, "vendor_id" text not null, "vendor_sku" text not null, "payout_price" numeric not null, "mrp" numeric null, "net_quantity_value" real null, "net_quantity_unit" text check ("net_quantity_unit" in ('g', 'kg', 'ml', 'l', 'pcs')) null, "raw_payout_price" jsonb not null, "raw_mrp" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vendor_variant_ref_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_variant_ref_variant_id_unique" ON "vendor_variant_ref" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_variant_ref_deleted_at" ON "vendor_variant_ref" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_variant_ref_product_id" ON "vendor_variant_ref" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vendor_variant_ref_vendor_id" ON "vendor_variant_ref" ("vendor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vendor_variant_ref_vendor_sku_unique" ON "vendor_variant_ref" ("vendor_id", "vendor_sku") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "catalog_counter" cascade;`);

    this.addSql(`drop table if exists "product_declaration" cascade;`);

    this.addSql(`drop table if exists "product_submission" cascade;`);

    this.addSql(`drop table if exists "vendor_upload" cascade;`);

    this.addSql(`drop table if exists "vendor_variant_ref" cascade;`);
  }

}
