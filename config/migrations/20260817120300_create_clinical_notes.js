// migrations/20260817120300_create_clinical_notes.js
//
// Structured, timestamped clinical notes tied to a staff member and a patient
// (§3.6 "Clinical notes"). Append-only: an edit writes a new row referencing the
// original via `supersedes` so history is never silently overwritten (§4
// Auditability). Notes do not themselves record time — clinical time is captured
// separately via the timer/manual entry (category 'documentation').

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("clinical_notes");
  if (exists) return;

  await knex.schema.createTable("clinical_notes", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");

    table.integer("staff_user_id").unsigned().notNullable();
    table
      .foreign("staff_user_id")
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("RESTRICT");

    table.string("note_type", 50).nullable(); // optional structured type
    table.text("body").notNullable();

    // Correction chain, linear (see time_entries migration for rationale).
    table.bigInteger("supersedes").unsigned().nullable();
    table
      .foreign("supersedes")
      .references("id")
      .inTable("clinical_notes")
      .onDelete("RESTRICT");
    table.unique(["supersedes"], "clinical_notes_supersedes_unique");

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    // No updated_at: append-only.

    table.index(["patient_id", "created_at"], "clinical_notes_patient_created_index");
    table.index(["organization_id"], "clinical_notes_org_index");
    table.index(["staff_user_id"], "clinical_notes_staff_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("clinical_notes");
};
