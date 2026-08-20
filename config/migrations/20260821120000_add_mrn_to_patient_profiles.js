// Add MRN (medical record number) to patient_profiles. Nullable — MRNs come
// from the practice's EHR and are backfilled/captured at enrollment; the RPM
// note shows it as a data gap until populated. Not the internal user id.
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn("patient_profiles", "mrn");
  if (has) return;
  await knex.schema.alterTable("patient_profiles", function (table) {
    table.string("mrn", 64).nullable();
  });
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn("patient_profiles", "mrn");
  if (!has) return;
  await knex.schema.alterTable("patient_profiles", function (table) {
    table.dropColumn("mrn");
  });
};
