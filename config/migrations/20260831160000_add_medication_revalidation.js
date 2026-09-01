// migrations/20260831160000_add_medication_revalidation.js
//
// Medications step 4. When a clinician has confirmed a reported medication and the
// patient then edits it, the row resets to `unconfirmed` (a confirmed record must not
// silently drift). But that must NOT be a silent revert: the clinician who confirmed
// it needs to know their confirmation was invalidated.
//
// These columns preserve that signal. On a patient edit that resets a confirmed row,
// the service copies confirmed_by/confirmed_at into previously_confirmed_by/at before
// clearing them. The clinician view then surfaces `revalidation_needed` (status =
// unconfirmed AND previously_confirmed_at IS NOT NULL) as a distinct "changed after you
// confirmed it — re-review" state, not a generic new entry. A fresh clinician
// confirm/reject clears these again.

exports.up = async function (knex) {
  const hasBy = await knex.schema.hasColumn("patient_medications", "previously_confirmed_by");
  const hasAt = await knex.schema.hasColumn("patient_medications", "previously_confirmed_at");
  await knex.schema.alterTable("patient_medications", function (table) {
    if (!hasBy) {
      table.integer("previously_confirmed_by").unsigned().nullable();
      table
        .foreign("previously_confirmed_by")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    }
    if (!hasAt) {
      table.timestamp("previously_confirmed_at").nullable();
    }
  });
};

exports.down = async function (knex) {
  const hasBy = await knex.schema.hasColumn("patient_medications", "previously_confirmed_by");
  const hasAt = await knex.schema.hasColumn("patient_medications", "previously_confirmed_at");
  await knex.schema.alterTable("patient_medications", function (table) {
    if (hasBy) {
      table.dropForeign("previously_confirmed_by");
      table.dropColumn("previously_confirmed_by");
    }
    if (hasAt) table.dropColumn("previously_confirmed_at");
  });
};
