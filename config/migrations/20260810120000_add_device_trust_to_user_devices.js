// migrations/20260810120000_add_device_trust_to_user_devices.js
//
// Adds device-trust support to user_devices:
//   - trusted_until: when set to a future timestamp, this device may skip OTP
//   - unique index on (user_id, device_fingerprint) so trustDevice() can
//     safely use ON DUPLICATE KEY UPDATE
//
// Existing rows all share the placeholder fingerprint "unique-browser-hash",
// so duplicates are collapsed before the unique index is added. The most
// recently used row per (user_id, device_fingerprint) is kept.

exports.up = async function (knex) {
  // 1. Add the trust column (idempotent guard so re-runs don't explode)
  const hasTrustedUntil = await knex.schema.hasColumn(
    "user_devices",
    "trusted_until"
  );
  if (!hasTrustedUntil) {
    await knex.schema.alterTable("user_devices", function (table) {
      table.timestamp("trusted_until").nullable().defaultTo(null);
    });
  }

  // 2. Collapse duplicate (user_id, device_fingerprint) pairs, keeping the
  //    highest id in each group. Required before the unique index can apply.
  await knex.raw(`
    DELETE ud FROM user_devices ud
    INNER JOIN (
      SELECT user_id, device_fingerprint, MAX(id) AS keep_id
      FROM user_devices
      GROUP BY user_id, device_fingerprint
      HAVING COUNT(*) > 1
    ) dupes
      ON ud.user_id = dupes.user_id
     AND ud.device_fingerprint = dupes.device_fingerprint
     AND ud.id <> dupes.keep_id
  `);

  // 3. Add the unique index. device_fingerprint is varchar(512), which
  //    exceeds MySQL's index key limit, so index a 191-char prefix — ample
  //    for the 64-char SHA-256 hashes we now store.
  const [existing] = await knex.raw(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'user_devices'
      AND index_name = 'user_devices_user_fingerprint_unique'
  `);
  const alreadyIndexed = existing[0] && existing[0].cnt > 0;

  if (!alreadyIndexed) {
    await knex.raw(`
      ALTER TABLE user_devices
      ADD UNIQUE INDEX user_devices_user_fingerprint_unique
        (user_id, device_fingerprint(191))
    `);
  }
};

exports.down = async function (knex) {
  const [existing] = await knex.raw(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'user_devices'
      AND index_name = 'user_devices_user_fingerprint_unique'
  `);
  if (existing[0] && existing[0].cnt > 0) {
    await knex.raw(`
      ALTER TABLE user_devices
      DROP INDEX user_devices_user_fingerprint_unique
    `);
  }

  const hasTrustedUntil = await knex.schema.hasColumn(
    "user_devices",
    "trusted_until"
  );
  if (hasTrustedUntil) {
    await knex.schema.alterTable("user_devices", function (table) {
      table.dropColumn("trusted_until");
    });
  }
};
