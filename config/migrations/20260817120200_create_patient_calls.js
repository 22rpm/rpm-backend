// migrations/20260817120200_create_patient_calls.js
//
// Patient call DOCUMENTATION (§3.7 "Patient call documentation"). This records
// that a call happened and its clinical detail; it is NOT messaging/telephony
// and sends nothing. Append-only, same correction model as time_entries.
//
// The call's clinical time (if any) lives in `time_entries` (category
// 'patient_call'), referenced by `time_entry_id`, so minutes are never
// double-counted here. A call with no billable time (e.g. no answer) simply has
// a NULL time_entry_id.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_calls");
  if (exists) return;

  await knex.schema.createTable("patient_calls", function (table) {
    table.bigIncrements("id").primary();

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

    // The clinical time captured for this call (if any). Lives in the ledger.
    table.bigInteger("time_entry_id").unsigned().nullable();
    table
      .foreign("time_entry_id")
      .references("id")
      .inTable("time_entries")
      .onDelete("RESTRICT");

    // Documentation of call direction — not an outbound send.
    table
      .enu("direction", ["outbound", "inbound"])
      .notNullable()
      .defaultTo("outbound");

    table.string("reason", 255).nullable();

    // TODO(care-activity): `outcome` is VARCHAR for now. It must become a
    // constrained set before production use so the billing workflow can report
    // on it (e.g. "how many calls actually reached the patient"). The real
    // category list needs to be sourced from the lead nurse. See
    // CARE_ACTIVITY_NOTES.md.
    table.string("outcome", 255).nullable();

    table.text("note").nullable();

    table.datetime("started_at").notNullable(); // for timeline ordering

    // Correction chain, linear (see time_entries migration for rationale).
    table.bigInteger("supersedes").unsigned().nullable();
    table
      .foreign("supersedes")
      .references("id")
      .inTable("patient_calls")
      .onDelete("RESTRICT");
    table.unique(["supersedes"], "patient_calls_supersedes_unique");

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    // No updated_at: append-only.

    table.index(["patient_id", "started_at"], "patient_calls_patient_started_index");
    table.index(["organization_id"], "patient_calls_org_index");
    table.index(["staff_user_id"], "patient_calls_staff_index");
    table.index(["time_entry_id"], "patient_calls_time_entry_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_calls");
};
