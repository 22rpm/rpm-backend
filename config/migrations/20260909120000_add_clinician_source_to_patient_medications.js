// Add 'clinician' to patient_medications.source.
//
// Provenance: a clinician entering a med from the chart is a different origin from a patient
// self-report (typed/photo). We keep that distinction in the data — source records the
// ORIGIN, reported_by records WHO, and clinician-entered meds are created status='confirmed'
// (the entering clinician is the authoritative reviewer; self-confirmation is a no-op). The
// three source values are meaningfully different provenance; do NOT collapse to a boolean.
//
// REVIEW BEFORE RUNNING: this is an ENUM widen on a table with prod rows. It only ADDS a
// permitted value — existing 'typed'/'photo' rows are untouched, no backfill. Reversible only
// while no row uses 'clinician' (the down guards against data loss).

exports.up = async function (knex) {
  await knex.schema.alterTable("patient_medications", (t) => {
    t.enu("source", ["typed", "photo", "clinician"]).notNullable().defaultTo("typed").alter();
  });
};

exports.down = async function (knex) {
  const [rows] = await knex.raw(
    "SELECT COUNT(*) AS n FROM patient_medications WHERE source = 'clinician'"
  );
  const n = Array.isArray(rows) ? rows[0].n : rows.n;
  if (Number(n) > 0) {
    throw new Error(`Refusing to revert: ${n} medication row(s) have source='clinician'.`);
  }
  await knex.schema.alterTable("patient_medications", (t) => {
    t.enu("source", ["typed", "photo"]).notNullable().defaultTo("typed").alter();
  });
};
