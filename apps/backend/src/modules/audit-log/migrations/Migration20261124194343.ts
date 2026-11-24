import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Makes audit_entry append-only at the database. A role that owns the table can
// still drop the triggers, because Medusa uses one database role for migrations
// and for running. Off-host backups and monitoring record that limit, and every
// entry is also logged as an [audit] line.
export class Migration20261124194343 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create or replace function audit_entry_reject_change() returns trigger language plpgsql as $$ begin raise exception 'audit_entry is append-only'; end; $$;`
    );
    this.addSql(
      `drop trigger if exists audit_entry_no_row_change on "audit_entry";`
    );
    this.addSql(
      `create trigger audit_entry_no_row_change before update or delete on "audit_entry" for each row execute function audit_entry_reject_change();`
    );
    this.addSql(
      `drop trigger if exists audit_entry_no_truncate on "audit_entry";`
    );
    this.addSql(
      `create trigger audit_entry_no_truncate before truncate on "audit_entry" for each statement execute function audit_entry_reject_change();`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists audit_entry_no_truncate on "audit_entry";`
    );
    this.addSql(
      `drop trigger if exists audit_entry_no_row_change on "audit_entry";`
    );
    this.addSql(`drop function if exists audit_entry_reject_change();`);
  }
}
