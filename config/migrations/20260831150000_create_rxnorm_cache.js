// migrations/20260831150000_create_rxnorm_cache.js
//
// RxNorm autocomplete support (medications step 2). Two tables, NO PHI — this is a
// public reference dataset (NLM/NIH), not patient data.
//
// rxnorm_drugs — the CACHED SNAPSHOT. It is an AVAILABILITY FALLBACK, not the primary
// source. Drug search is live-first against RxNav (which returns an rxcui, so a match
// is a real match); the cache only serves when RxNav is slow/down. Seeded from
// RxNav displaynames (name-only → rxcui NULL) for breadth, and warmed opportunistically
// from live results (name + rxcui) for the drugs patients actually use. A cache hit
// with rxcui NULL means "we have the name but couldn't verify the concept" — the
// medication is recorded unmatched (rxcui null on patient_medications), exactly like
// free text, and the clinician sees the "not matched to a drug database" flag.
//
// rxnorm_refresh_log — append-only history of cache refreshes, so staleness is
// observable (last refreshed_at, count). The cache NEVER auto-expires: a stale cache
// still serves known drugs. If nobody refreshes for a year, a patient on a newly
// approved drug simply falls through to live lookup (if RxNav is up) or free text —
// designed behavior, not a failure. See MEDICATIONS_DESIGN.md §1.

exports.up = async function (knex) {
  const hasDrugs = await knex.schema.hasTable("rxnorm_drugs");
  if (!hasDrugs) {
    await knex.schema.createTable("rxnorm_drugs", function (table) {
      table.bigIncrements("id").primary();
      // The full RxNorm display name, e.g. "lisinopril 10 MG Oral Tablet".
      // Unique so warming (live upsert) can dedup by name.
      table.string("name", 255).notNullable().unique();
      // Lowercased name for case-insensitive prefix/substring LIKE search.
      table.string("search_name", 255).notNullable();
      // RxNorm concept id when known (from live results); NULL for name-only
      // (displaynames) rows.
      table.string("rxcui", 32).nullable();
      // Term type (SBD/SCD/BPCK/GPCK/...) when known — helps rank/label.
      table.string("tty", 20).nullable();
      table
        .enu("source", ["displaynames", "live"])
        .notNullable()
        .defaultTo("displaynames");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      table.index(["search_name"], "rxnorm_drugs_search_name_index");
    });
  }

  const hasLog = await knex.schema.hasTable("rxnorm_refresh_log");
  if (!hasLog) {
    await knex.schema.createTable("rxnorm_refresh_log", function (table) {
      table.bigIncrements("id").primary();
      table.timestamp("refreshed_at").notNullable().defaultTo(knex.fn.now());
      table.integer("name_count").notNullable().defaultTo(0);
      table.enu("status", ["success", "failed"]).notNullable();
      table.string("message", 500).nullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("rxnorm_refresh_log");
  await knex.schema.dropTableIfExists("rxnorm_drugs");
};
