// migrations/20260901130000_add_dialysis_to_patient_profiles.js
//
// Dialysis patient flag + the dialysis clinic name. Some RPM patients dialyze at an
// external center; care teams need to see who, and where, and to group/filter by it.
//
// clinic is FREE TEXT (varchar) for v1 — fast to capture, no maintained-list admin UI.
// The dashboard form offers a datalist of existing values so spellings self-normalize,
// and the patient list filters by a distinct-values dropdown. If a maintained list is
// wanted later, seed it from the distinct values already entered (no data migration).

exports.up = async function (knex) {
  const hasFlag = await knex.schema.hasColumn("patient_profiles", "is_dialysis");
  const hasClinic = await knex.schema.hasColumn("patient_profiles", "dialysis_clinic");
  await knex.schema.alterTable("patient_profiles", function (table) {
    if (!hasFlag) table.boolean("is_dialysis").notNullable().defaultTo(false);
    if (!hasClinic) table.string("dialysis_clinic", 255).nullable();
  });
};

exports.down = async function (knex) {
  const hasFlag = await knex.schema.hasColumn("patient_profiles", "is_dialysis");
  const hasClinic = await knex.schema.hasColumn("patient_profiles", "dialysis_clinic");
  await knex.schema.alterTable("patient_profiles", function (table) {
    if (hasClinic) table.dropColumn("dialysis_clinic");
    if (hasFlag) table.dropColumn("is_dialysis");
  });
};
