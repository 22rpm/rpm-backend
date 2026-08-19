// migrations/20260819120000_add_unique_role_user_id.js
//
// UNIQUE(role.user_id). Today `role.user_id` is only a (non-unique) FK index, so
// a user can accumulate multiple role rows, and updateUserRole's
// `INSERT ... ON DUPLICATE KEY UPDATE` never fires (it silently inserts a dup).
// Once this constraint exists that statement behaves as intended, and role
// resolution can no longer be ambiguous.
//
// Written DEFENSIVELY: dedup first (keep the MOST-PRIVILEGED row per user, then
// lowest id) so it applies cleanly even where duplicates exist — the checked
// envs have none, but production is unverified. The keep-rule matches the
// most-privileged-wins resolution used in code.

async function indexExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

exports.up = async function (knex) {
  // 1. Collapse duplicate role rows: keep one per user_id, preferring the highest
  //    privilege, tie-broken by the lowest id. Deletes nothing when there are no
  //    duplicates.
  await knex.raw(`
    DELETE FROM role
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY CASE role_type
              WHEN 'super-admin' THEN 4
              WHEN 'admin' THEN 3
              WHEN 'clinician' THEN 2
              WHEN 'patient' THEN 1
              ELSE 0 END DESC,
              id ASC
          ) AS rn
        FROM role
      ) ranked
      WHERE ranked.rn > 1
    )
  `);

  // 2. Add the unique constraint (idempotent guard for partial re-runs).
  if (!(await indexExists(knex, "role", "role_user_id_unique"))) {
    await knex.schema.alterTable("role", function (table) {
      table.unique(["user_id"], "role_user_id_unique");
    });
  }
};

exports.down = async function (knex) {
  if (await indexExists(knex, "role", "role_user_id_unique")) {
    await knex.schema.alterTable("role", function (table) {
      table.dropUnique(["user_id"], "role_user_id_unique");
    });
  }
  // Deleted duplicate role rows are NOT restored (data change).
};
