// migrations/20260902120100_create_patient_notification_settings.js
//
// Per-patient, per-type enablement — the toggles a clinician/admin flips to turn
// an automated message ON for a patient. Enabling a type still requires SMS
// consent on file (patient_comm_prefs) AND the patient not being opted out; this
// table only says "the clinic wants this type for this patient".
//
// type: reading_reminder | call_prompt | birthday (see config/notifications.js).
// cadence_days applies to reading_reminder (default 3).

exports.up = async function (knex) {
  const has = await knex.schema.hasTable("patient_notification_settings");
  if (!has) {
    await knex.schema.createTable("patient_notification_settings", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table.foreign("patient_id").references("id").inTable("users").onDelete("CASCADE");
      table.string("type", 32).notNullable();
      table.boolean("enabled").notNullable().defaultTo(false);
      table.integer("cadence_days").nullable(); // reading_reminder only
      table.integer("updated_by").unsigned().nullable();
      table.foreign("updated_by").references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      table.unique(["patient_id", "type"], "patient_notification_settings_patient_type_unique");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_notification_settings");
};
