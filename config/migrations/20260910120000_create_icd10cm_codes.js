// migrations/20260910120000_create_icd10cm_codes.js
//
// The FULL ICD-10-CM code set — reference data, NO PHI (public CMS/CDC dataset).
// Backs the conditions picker's search so a clinician can record ANY valid diagnosis,
// not just a curated shortlist. Seeded from the CMS "order file" by
// scripts/loadIcd10cm.js (see CONDITIONS_PICKER_DESIGN.md).
//
// `code` is stored WITHOUT the decimal point, exactly as the CMS order file ships it
// (e.g. "L603", "E1122", "I10") — the picker adds the dot for display/storage. `billable`
// is the order file's validity flag: 1 = a fully-specified, submittable code; 0 = a
// non-billable header/category (e.g. bare "E11"). The picker only lets you STORE billable
// codes — a header code on a claim is a rejection — but headers are loaded too so a paste
// of one can be answered with "that's a category, pick a specific code" at ENTRY.
//
// Refresh: ICD-10-CM revises annually (Oct 1), occasionally with an Apr 1 addendum. Re-run
// the loader against the new order file; it replaces the table transactionally.

exports.up = async function (knex) {
  const has = await knex.schema.hasTable("icd10cm_codes");
  if (!has) {
    await knex.schema.createTable("icd10cm_codes", function (table) {
      // Dot-less CMS code, the natural key.
      table.string("code", 8).notNullable().primary();
      // Order file validity flag: true = billable/fully-specified, false = header.
      table.boolean("billable").notNullable();
      // Short (<=60 char) and full descriptions from the order file.
      table.string("short_desc", 80).notNullable();
      table.string("long_desc", 512).notNullable();
      // Lowercased long_desc for case-insensitive substring name search (LIKE),
      // mirroring rxnorm_drugs.search_name.
      table.string("search_desc", 512).notNullable();
      table.index(["search_desc"], "icd10cm_codes_search_desc_index");
      // Cheap "does this code exist / is it billable" — the PK already covers exact
      // code lookup; this composite helps the billable-only filter on name search.
      table.index(["billable"], "icd10cm_codes_billable_index");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("icd10cm_codes");
};
