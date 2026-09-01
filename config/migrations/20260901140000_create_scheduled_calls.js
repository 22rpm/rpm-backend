// migrations/20260901140000_create_scheduled_calls.js
//
// Call scheduling (#3). A scheduled_call is an INTENT — an appointment to call a patient.
// It is NOT the billing record. The documented, billable conversation is a `patient_calls`
// row (which feeds 99457's interactive-communication test). The two are LINKED, never
// duplicated: when a scheduled call happens, staff log it through the existing
// call-logging flow (creating a patient_calls row), and the schedule is marked
// `completed` with `completed_call_id` pointing at that row.
//
// A scheduled call is only "complete" when completed_call_id is set. If it is never
// logged it stays `scheduled` past its time = OVERDUE (surfaced on the patient list) —
// a patient nobody talked to, i.e. a missed monthly 99457. Scheduling never feeds 99457
// on its own; only the linked patient_calls does.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("scheduled_calls");
  if (exists) return;

  await knex.schema.createTable("scheduled_calls", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table.foreign("patient_id").references("id").inTable("users").onDelete("CASCADE");

    table.integer("organization_id").unsigned().notNullable();
    table.foreign("organization_id").references("id").inTable("organizations").onDelete("CASCADE");

    // Who scheduled it (org admin). SET NULL so removing a user doesn't drop the schedule.
    table.integer("scheduled_by").unsigned().nullable();
    table.foreign("scheduled_by").references("id").inTable("users").onDelete("SET NULL");

    table.datetime("scheduled_at").notNullable();
    table.string("reason", 255).nullable();

    table
      .enu("status", ["scheduled", "completed", "cancelled", "no_show"])
      .notNullable()
      .defaultTo("scheduled");

    // The documented call this schedule was completed by — the billing record. NULL
    // until logged. A schedule is only "complete" when this is set.
    table.bigInteger("completed_call_id").unsigned().nullable();
    table.foreign("completed_call_id").references("id").inTable("patient_calls").onDelete("SET NULL");

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    // Calendar (org + time window) and per-patient next/overdue lookups.
    table.index(["organization_id", "scheduled_at"], "scheduled_calls_org_time_index");
    table.index(["patient_id", "status", "scheduled_at"], "scheduled_calls_patient_status_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("scheduled_calls");
};
