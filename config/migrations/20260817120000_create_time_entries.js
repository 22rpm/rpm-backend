// migrations/20260817120000_create_time_entries.js
//
// Append-only clinical-time ledger. Each row is a billing-relevant record of
// staff time spent on a patient's care (RPM_Platform_Feature_Development
// _Requirements §3.8, §4 Auditability).
//
// Rules (enforced by design, see care activity services + CARE_ACTIVITY_NOTES.md):
//   - Append-only: rows are INSERTed once and never UPDATEd or DELETEd.
//   - Corrections write a NEW row pointing back via `supersedes`. `superseded_by`
//     is NOT stored (storing it would require UPDATE-ing the original, which
//     append-only forbids); derive it with a LEFT JOIN on `supersedes`.
//   - `duration_seconds` is stored, never derived at read time.
//   - `activity_category` is the constrained §3.8 set.
//   - No billing/CPT logic lives here; this is the capture layer only.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("time_entries");
  if (exists) return;

  await knex.schema.createTable("time_entries", function (table) {
    table.bigIncrements("id").primary();

    // Patient and staff are both rows in `users`; org is denormalised for
    // per-clinic scoping/reporting. RESTRICT on delete: a billing record must
    // not be destroyed by removing a user/org (see CARE_ACTIVITY_NOTES.md).
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

    // Constrained set per §3.8.
    table
      .enu("activity_category", [
        "patient_call",
        "reading_review",
        "care_coordination",
        "provider_communication",
        "documentation",
        "device_assistance",
        "other",
      ])
      .notNullable();

    table.datetime("started_at").notNullable();
    table.datetime("ended_at").nullable(); // null while incomplete
    table.integer("duration_seconds").unsigned().nullable(); // stored, not derived; null while incomplete

    table.enu("entry_method", ["timer", "manual"]).notNullable();

    // `incomplete` = a timer session ended without an explicit stop; the row is
    // flagged for manual confirmation rather than silently trusting elapsed time.
    table
      .enu("status", ["complete", "incomplete"])
      .notNullable()
      .defaultTo("complete");

    table.text("note").nullable();

    // Correction chain (linked list). UNIQUE so each original is superseded by
    // at most one correction -> chains stay linear (no forks), fully walkable
    // for audit. Multiple NULLs are allowed by MySQL unique indexes.
    table.bigInteger("supersedes").unsigned().nullable();
    table
      .foreign("supersedes")
      .references("id")
      .inTable("time_entries")
      .onDelete("RESTRICT");
    table.unique(["supersedes"], "time_entries_supersedes_unique");

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    // No updated_at: this table is append-only.

    table.index(["patient_id", "started_at"], "time_entries_patient_started_index");
    table.index(["staff_user_id", "started_at"], "time_entries_staff_started_index");
    table.index(["organization_id", "started_at"], "time_entries_org_started_index");
    table.index(["status"], "time_entries_status_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("time_entries");
};
