// migrations/20260925120000_create_lab_results.js
//
// Lab results (LAB_RESULTS_DESIGN.md, increment 1). One row per resulted analyte,
// append-only with a correction chain (`supersedes`) exactly like `time_entries`.
// Source-neutral: `source` (api|file|manual) tags how a row arrived, so API/file
// adapters slot in later with no schema change. Increment 1 writes source='manual' only.
//
// Idempotent + resumable (the lesson from this week's migrations): hasTable guard for the
// table (CREATE is atomic — columns + indexes come with it), then an information_schema
// check before EACH foreign key (added separately so a partially-applied run recovers,
// and because the self-FK on `supersedes` can't be declared inside createTable).
//
// TYPES verified, not assumed: users.id and organizations.id are both `table.increments()`
// = INT UNSIGNED, so patient_id / organization_id / entered_by are INT UNSIGNED. `supersedes`
// is BIGINT UNSIGNED to match lab_results.id (bigIncrements). A mismatch is what broke the
// messages FK this week.
//
// PROD HAS NO BACKUPS — mysqldump before running on prod.

async function hasForeignKey(knex, table, constraintName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = ?
        AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [table, constraintName]
  );
  return rows.length > 0;
}

const FK = {
  patient: "lab_results_patient_id_foreign",
  org: "lab_results_organization_id_foreign",
  enteredBy: "lab_results_entered_by_foreign",
  supersedes: "lab_results_supersedes_foreign",
};

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("lab_results"))) {
    await knex.schema.createTable("lab_results", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable(); // match users.id (INT UNSIGNED)
      table.integer("organization_id").unsigned().notNullable(); // match organizations.id
      table.string("test_name", 120).notNullable();
      table.string("loinc_code", 20).nullable(); // coding optional now (no LOINC table yet)
      table.string("value_text", 255).notNullable(); // result AS REPORTED
      table.decimal("value_num", 14, 4).nullable(); // parsed numeric when available
      table.string("unit", 40).nullable();
      table.string("reference_range", 120).nullable(); // text — ranges vary by lab/age/sex
      table
        .enu("abnormal_flag", [
          "normal",
          "low",
          "high",
          "critical_low",
          "critical_high",
          "abnormal",
        ])
        .nullable(); // as the lab reports it — never computed here
      table.timestamp("collected_at").nullable(); // specimen collection (clinically meaningful)
      table.timestamp("resulted_at").nullable();
      table.string("resulting_lab", 120).nullable(); // Quest / LabCorp / dialysis provider
      table.enu("source", ["api", "file", "manual"]).notNullable(); // swappable-ingestion key
      table.string("source_ref", 191).nullable(); // external id; null for manual
      table.integer("entered_by").unsigned().nullable(); // who keyed THIS version
      table.string("panel_ref", 120).nullable(); // optional grouping (one draw / DiagnosticReport)
      table.bigInteger("supersedes").unsigned().nullable(); // correction chain -> lab_results.id
      table.timestamps(true, true);

      table.index(["patient_id", "organization_id"], "lab_results_patient_org_index");
      table.index(["collected_at"], "lab_results_collected_index");
      // Idempotent re-import for api/file; MySQL allows many NULLs so manual rows don't collide.
      table.unique(["source", "source_ref"], "lab_results_source_ref_unique");
      // One correction per row (head-of-chain guarantee), same as time_entries.
      table.unique(["supersedes"], "lab_results_supersedes_unique");
    });
  }

  // Foreign keys — each guarded via information_schema so a re-run (or a partially-applied
  // run) adds only what's missing. The supersedes self-FK MUST be added after the table exists.
  if (!(await hasForeignKey(knex, "lab_results", FK.patient))) {
    await knex.schema.alterTable("lab_results", (t) => {
      t.foreign("patient_id", FK.patient).references("id").inTable("users").onDelete("CASCADE");
    });
  }
  if (!(await hasForeignKey(knex, "lab_results", FK.org))) {
    await knex.schema.alterTable("lab_results", (t) => {
      t.foreign("organization_id", FK.org).references("id").inTable("organizations");
    });
  }
  if (!(await hasForeignKey(knex, "lab_results", FK.enteredBy))) {
    await knex.schema.alterTable("lab_results", (t) => {
      t.foreign("entered_by", FK.enteredBy).references("id").inTable("users").onDelete("SET NULL");
    });
  }
  if (!(await hasForeignKey(knex, "lab_results", FK.supersedes))) {
    await knex.schema.alterTable("lab_results", (t) => {
      t.foreign("supersedes", FK.supersedes)
        .references("id")
        .inTable("lab_results")
        .onDelete("SET NULL");
    });
  }
};

exports.down = async function (knex) {
  // dropTableIfExists is itself guarded and drops the table's own FKs (incl. the self-FK).
  await knex.schema.dropTableIfExists("lab_results");
};
