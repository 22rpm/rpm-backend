// migrations/20260824120000_add_dev_data_reading_index.js
//
// dev_data currently has only PRIMARY(id) and an index on dev_type. The reading
// queries (doctor.service device-data: main page, COUNT, getAllReadingsInRange)
// all filter `WHERE user_id = ? AND dev_type = ? AND created_at <range>` and
// ORDER BY created_at — a full scan today. This composite index covers the
// equality columns, the created_at range (now SARGABLE — the DATE() wrappers
// were removed), and the ORDER BY.
//
// NOT YET APPLIED. Two reasons, both flagged in VITALS_MONTH_EXPORT_NOTES.md:
//   1. This file sits on a branch off `main`, whose migration directory does not
//      yet contain the care-activity migrations that rpm_db_v1 has applied, so
//      `migrate:latest` refuses here until that lineage is reconciled/merged.
//   2. On prod, ALTER TABLE dev_data ADD INDEX rebuilds a large, growing table —
//      a maintenance-window operation, and prod has no backups. Run it
//      deliberately, not as a side effect of a deploy.
// Idempotent + guarded so it is safe whenever it does run.

const INDEX = "dev_data_user_type_time_index";

async function indexExists(knex) {
  const res = await knex.raw("SHOW INDEX FROM dev_data WHERE Key_name = ?", [INDEX]);
  const rows = Array.isArray(res) ? res[0] : res;
  return rows && rows.length > 0;
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("dev_data"))) return;
  if (await indexExists(knex)) return;
  await knex.schema.alterTable("dev_data", (t) => {
    t.index(["user_id", "dev_type", "created_at"], INDEX);
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable("dev_data"))) return;
  if (!(await indexExists(knex))) return;
  await knex.schema.alterTable("dev_data", (t) => {
    t.dropIndex(["user_id", "dev_type", "created_at"], INDEX);
  });
};
