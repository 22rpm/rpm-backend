// migrations/20260818120600_create_rpm_device_setups.js
//
// CPT 99453 — the one-time device-setup record. Billed ONCE per patient per
// device type for the life of the RPM episode, NOT monthly. Durable forever.
//
// Double-billing defense is structural: UNIQUE(patient_id, device_type) makes a
// second 99453 setup row for the same patient + device type impossible to
// insert, so a replacement device of the same type reuses the one setup and no
// second 99453 can be created. Re-billing an already-billed row is refused in the
// application; the row is never deleted.
//
// EPISODE CAVEAT: the unique key assumes ONE lifelong RPM episode per patient. If
// discharge/re-enroll episodes are ever modeled, 99453 becomes billable again per
// new episode, which requires a MIGRATION to add episode_id to this table AND to
// the unique key — not just a new column. Recorded in CARE_ACTIVITY_NOTES.md.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("rpm_device_setups");
  if (exists) return;

  await knex.schema.createTable("rpm_device_setups", function (table) {
    table.bigIncrements("id").primary();

    // RESTRICT: a billing record must not be destroyed by deleting the patient/org.
    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("RESTRICT");

    table.string("device_type", 32).notNullable();
    table.foreign("device_type").references("key").inTable("device_types");

    table.date("setup_date").notNullable();

    table.integer("performed_by").unsigned().nullable();
    table
      .foreign("performed_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    // The consent that gated this setup (consent is required before 99453).
    table.bigInteger("consent_id").unsigned().nullable();
    table
      .foreign("consent_id")
      .references("id")
      .inTable("patient_consents")
      .onDelete("RESTRICT");

    table.boolean("billed").notNullable().defaultTo(false); // one-way 0 -> 1
    table.date("billed_at").nullable();
    table.integer("billed_by").unsigned().nullable();
    table
      .foreign("billed_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.string("claim_reference", 100).nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    // One 99453 per patient per device type, for the life of the episode.
    table.unique(["patient_id", "device_type"], "rpm_device_setups_patient_type_unique");
    table.index(["organization_id"], "rpm_device_setups_org_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("rpm_device_setups");
};
