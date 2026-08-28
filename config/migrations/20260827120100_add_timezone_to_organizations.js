// migrations/20260827120100_add_timezone_to_organizations.js
//
// Clinic timezone for day-bucketing and display (TZ_FIX_DESIGN.md PR 3). A
// "transmission day" and every displayed time are the CLINIC's local day, not
// the server's. Storage stays UTC (session pinned in config/db.js); this column
// is the tz that CONVERT_TZ('+00:00', <tz>) buckets and formats into.
//
// Nullable on purpose: NULL resolves to the app-level default CLINIC_TZ
// ('America/Los_Angeles'). One clinic today, but org-scoping and the
// half-built super-admin multi-clinic flow make a later retrofit into the
// billing queries worse than a nullable column nobody has to populate yet.
//
// IANA name (e.g. 'America/Los_Angeles'), NOT a numeric offset — the named zone
// is DST-correct (PDT vs PST); an offset is not. Requires the MySQL named-tz
// tables to be loaded (a hard deploy gate; see the runbook).

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("organizations");
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn("organizations", "timezone");
  if (hasColumn) return;

  await knex.schema.alterTable("organizations", function (table) {
    table.string("timezone", 64).nullable().after("org_code");
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("organizations");
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn("organizations", "timezone");
  if (!hasColumn) return;
  await knex.schema.alterTable("organizations", function (table) {
    table.dropColumn("timezone");
  });
};
