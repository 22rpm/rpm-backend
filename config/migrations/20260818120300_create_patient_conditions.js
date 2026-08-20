// migrations/20260818120300_create_patient_conditions.js
//
// Conditions / diagnoses — many per patient (1:N). Free text for now; an
// `icd10_code` column + a coded lookup can be added later without reshaping.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_conditions");
  if (exists) return;

  await knex.schema.createTable("patient_conditions", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.string("name", 255).notNullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["patient_id"], "patient_conditions_patient_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_conditions");
};
