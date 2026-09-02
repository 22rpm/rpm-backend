// migrations/20260901140100_add_secondary_insurance_to_patient_profiles.js
//
// Secondary insurance payer. The existing `insurance_payer_id` is the PRIMARY;
// this adds a parallel nullable FK for the secondary. Payer NAME only (same
// insurance_payers lookup) — no member IDs / policy numbers, consistent with the
// primary and the payer table's standing "name only, ever" rule.
//
// The RPM note shows PRIMARY only (we bill Medicare today). Secondary is recorded
// but wired to nothing — see the note in patientEdit/enrollment services.

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn("patient_profiles", "secondary_insurance_payer_id");
  if (!has) {
    await knex.schema.alterTable("patient_profiles", function (table) {
      table
        .integer("secondary_insurance_payer_id")
        .unsigned()
        .nullable()
        .after("insurance_payer_id");
      table
        .foreign("secondary_insurance_payer_id")
        .references("id")
        .inTable("insurance_payers")
        .onDelete("SET NULL");
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn("patient_profiles", "secondary_insurance_payer_id");
  if (has) {
    await knex.schema.alterTable("patient_profiles", function (table) {
      // Drop the FK before the column (MySQL requires the constraint gone first).
      table.dropForeign("secondary_insurance_payer_id");
      table.dropColumn("secondary_insurance_payer_id");
    });
  }
};
