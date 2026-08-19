// migrations/20260819120100_add_unique_users_username.js
//
// UNIQUE(users.username). Today username is NOT NULL but has no unique
// constraint, so two users can share a username — which lets findRoleByUsername
// resolve the wrong user's role. That is a live weakness independent of the
// passwordless-patient change.
//
// Written DEFENSIVELY: rename duplicates first (keep the lowest id unchanged,
// append `_<id>` to the rest — usernames are unique by id) so it applies cleanly
// even where duplicates exist. Usernames are not the patient login credential
// (patients authenticate by phone/email), so renaming is safe. role.username is
// kept in sync afterward.

async function indexExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

exports.up = async function (knex) {
  // 1. Rename duplicate usernames (keep the lowest id; append _<id> to the rest).
  //    No-op when there are no duplicates.
  await knex.raw(`
    UPDATE users u
    JOIN (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY username ORDER BY id ASC) AS rn
      FROM users
    ) ranked ON u.id = ranked.id
    SET u.username = CONCAT(u.username, '_', u.id)
    WHERE ranked.rn > 1
  `);

  // 2. Keep the denormalised role.username in sync with any renamed users.
  await knex.raw(`
    UPDATE role r
    JOIN users u ON r.user_id = u.id
    SET r.username = u.username
    WHERE r.username <> u.username
  `);

  // 3. Add the unique constraint (idempotent guard for partial re-runs).
  if (!(await indexExists(knex, "users", "users_username_unique"))) {
    await knex.schema.alterTable("users", function (table) {
      table.unique(["username"], "users_username_unique");
    });
  }
};

exports.down = async function (knex) {
  if (await indexExists(knex, "users", "users_username_unique")) {
    await knex.schema.alterTable("users", function (table) {
      table.dropUnique(["username"], "users_username_unique");
    });
  }
  // Renamed usernames are NOT reverted (data change).
};
