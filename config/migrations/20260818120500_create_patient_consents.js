// migrations/20260818120500_create_patient_consents.js
//
// RPM consent — METADATA ONLY. Required before device setup and before 99453 can
// be billed. Append-only event log: each consent event ('obtained'/'withdrawn')
// is a new row, never updated or deleted, so the consent-date history that gates
// billing is preserved intrinsically (a payer can ask "when did they consent" and
// the answer can never have been silently edited). Current consent = the latest
// 'obtained' row not followed by a 'withdrawn'.
//
// document_key is a nullable placeholder for a future PHI-document reference. NO
// file upload/storage is built — it stays null until the PHI-storage decision.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_consents");
  if (exists) return;

  await knex.schema.createTable("patient_consents", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("CASCADE");

    table.enu("status", ["obtained", "withdrawn"]).notNullable();
    table.date("consent_date").notNullable();
    table.enu("method", ["verbal", "written"]).notNullable();

    table.integer("obtained_by").unsigned().nullable();
    table
      .foreign("obtained_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table.integer("supervising_provider_id").unsigned().nullable();
    table
      .foreign("supervising_provider_id")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table.string("document_key", 255).nullable(); // future PHI-doc reference

    table.string("notes", 500).nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    // Append-only: no updated_at.

    table.index(["patient_id", "consent_date"], "patient_consents_patient_date_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_consents");
};
