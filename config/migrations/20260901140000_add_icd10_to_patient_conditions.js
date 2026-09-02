// migrations/20260901140000_add_icd10_to_patient_conditions.js
//
// Adds the ICD-10 code column the patient_conditions table was designed to grow
// (see the table's own header comment) and BACKFILLS the handful of conditions
// already recorded to their codes in one pass.
//
// The column is nullable on purpose: a diagnosis outside the curated shortlist is
// recorded as free text (code null) rather than guessed at. The backfill only
// touches names that map CLEANLY (config/icd10Conditions BACKFILL_NAME_TO_CODE);
// anything else stays uncoded. Recorded on the patient only — not yet on the note
// or the biller report (that wiring is a later, small change).

const { BACKFILL_NAME_TO_CODE } = require("../icd10Conditions");

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn("patient_conditions", "icd10_code");
  if (!has) {
    await knex.schema.alterTable("patient_conditions", function (table) {
      // ICD-10-CM codes are at most 7 chars + a dot; 10 is comfortable headroom.
      table.string("icd10_code", 10).nullable().after("name");
    });
  }
  // One-time backfill: map the exact existing names to codes. Idempotent — only
  // sets rows that still match a mapped name and don't already carry that code.
  for (const [name, code] of Object.entries(BACKFILL_NAME_TO_CODE)) {
    await knex("patient_conditions")
      .where({ name })
      .whereNull("icd10_code")
      .update({ icd10_code: code });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn("patient_conditions", "icd10_code");
  if (has) {
    await knex.schema.alterTable("patient_conditions", function (table) {
      table.dropColumn("icd10_code");
    });
  }
};
