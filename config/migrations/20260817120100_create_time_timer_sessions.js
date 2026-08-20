// migrations/20260817120100_create_time_timer_sessions.js
//
// Mutable working state for an IN-PROGRESS timer. This is NOT a billing record:
// it is operational state that accrues active time via heartbeats and is
// finalized into `time_entries` (append-only) on stop, then deleted.
//
// The split exists because a running timer must mutate (accrue, then finalize),
// which is incompatible with the append-only ledger. Accrual is heartbeat-driven
// so no accrual happens while the tab is backgrounded/idle. Exact heartbeat and
// staleness rules are documented in CARE_ACTIVITY_NOTES.md and will be repeated
// at the top of the timer service when Part 3 is built.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("time_timer_sessions");
  if (exists) return;

  await knex.schema.createTable("time_timer_sessions", function (table) {
    table.bigIncrements("id").primary();

    // One active timer per staff member. Ephemeral state, so CASCADE on delete.
    table.integer("staff_user_id").unsigned().notNullable();
    table
      .foreign("staff_user_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.unique(["staff_user_id"], "timer_sessions_staff_unique");

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("CASCADE");

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

    // Active seconds accrued so far (excludes idle/background time). On stop this
    // becomes time_entries.duration_seconds.
    table.integer("accumulated_seconds").unsigned().notNullable().defaultTo(0);

    table.enu("status", ["running", "paused"]).notNullable().defaultTo("running");

    // Drives accrual bounding and orphan detection (see CARE_ACTIVITY_NOTES.md).
    table.datetime("last_heartbeat_at").notNullable();

    table.text("note").nullable(); // draft note while the timer runs

    // This table IS mutable (operational), so it keeps updated_at.
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["last_heartbeat_at"], "timer_sessions_heartbeat_index");
    table.index(["organization_id"], "timer_sessions_org_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("time_timer_sessions");
};
