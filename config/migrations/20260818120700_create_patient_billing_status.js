// migrations/20260818120700_create_patient_billing_status.js
//
// Billing disposition per patient PER CALENDAR MONTH. The same patient can be
// 'submitted' for August and 'not_ready' for September — different rows.
// UNIQUE(patient_id, billing_month) enforces one row per patient per month.
//
// This table holds the operational DISPOSITION only. It deliberately does NOT
// store the eligibility math — the billing engine computes readiness live from
// source tables (three independent tests: >=20 min from time_entries; >=1 live
// interactive communication from patient_calls; distinct transmission days from
// dev_data) and sets status to 'ready'; a human advances submitted/paid/etc.
// (See CARE_ACTIVITY_NOTES.md — the interactive-communication test depends on the
// constrained patient_calls.outcome set, which now blocks the billing engine.)

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_billing_status");
  if (exists) return;

  await knex.schema.createTable("patient_billing_status", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT"); // preserve closed-month history

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("RESTRICT");

    table.date("billing_month").notNullable(); // first day of the month, e.g. 2026-08-01

    table
      .enu("status", [
        "not_ready",
        "in_progress",
        "ready",
        "submitted",
        "paid",
        "hold",
        "denied",
        "corrected",
      ])
      .notNullable()
      .defaultTo("not_ready");

    table.date("submitted_at").nullable();
    table.integer("updated_by").unsigned().nullable();
    table
      .foreign("updated_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.string("notes", 500).nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["patient_id", "billing_month"], "patient_billing_status_patient_month_unique");
    table.index(["organization_id", "billing_month"], "patient_billing_status_org_month_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_billing_status");
};
