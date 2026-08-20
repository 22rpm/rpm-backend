// migrations/20260818120200_create_patient_profiles.js
//
// 1:1 patient master data (patients are `users` with a 'patient' role row).
// Kept off `users` so patient-only fields don't pollute a table shared by all
// roles. Mutable master data (edited via enrollment) — NOT append-only.
//
// enrolled_at drives billing periods, so a change to it must write an audit_log
// entry with ACTIONS.PATIENT_ENROLLMENT_CHANGE (done in the enrollment endpoint,
// not here). Age is derived from date_of_birth at read time — never stored.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_profiles");
  if (exists) return;

  await knex.schema.createTable("patient_profiles", function (table) {
    table.increments("id").primary();

    table.integer("user_id").unsigned().notNullable().unique();
    table.foreign("user_id").references("id").inTable("users").onDelete("CASCADE");

    table.date("date_of_birth").nullable();
    table.date("enrolled_at").nullable();

    table
      .enu("program_status", ["active", "pending", "discharged"])
      .notNullable()
      .defaultTo("active");

    table.integer("insurance_payer_id").unsigned().nullable();
    table
      .foreign("insurance_payer_id")
      .references("id")
      .inTable("insurance_payers")
      .onDelete("SET NULL");

    table.string("comments", 1000).nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_profiles");
};
