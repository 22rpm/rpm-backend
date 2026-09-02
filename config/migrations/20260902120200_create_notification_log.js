// migrations/20260902120200_create_notification_log.js
//
// One row per notification ATTEMPT — sends, skips, AND failures. This is the
// answer to "Twilio was silently down for months and I found it by accident":
// every outcome is recorded, and failures/undelivered are queryable, not buried.
//
// status lifecycle:
//   skipped   — never sent (see skip_reason). intended: opted_out|no_consent|
//               compliant|disabled. UNINTENDED: `error` (a fail-closed pref read
//               failure) — surfaced separately so a silently-skipped patient
//               doesn't look identical to an opted-out one.
//   queued -> sent           (Twilio accepted it)
//          -> failed          (send call failed; error_code/message set)
//   sent   -> delivered       (status callback)
//          -> undelivered     (status callback; carrier rejected)
//          -> failed          (status callback)

exports.up = async function (knex) {
  const has = await knex.schema.hasTable("notification_log");
  if (!has) {
    await knex.schema.createTable("notification_log", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table.foreign("patient_id").references("id").inTable("users").onDelete("CASCADE");
      table.integer("organization_id").unsigned().nullable();
      table.foreign("organization_id").references("id").inTable("organizations").onDelete("SET NULL");
      table.string("type", 32).notNullable();
      table.string("channel", 16).notNullable().defaultTo("sms");
      table.string("to_number", 32).nullable();
      table.text("body").nullable();
      table.string("twilio_sid", 64).nullable();
      table.string("status", 16).notNullable(); // skipped|queued|sent|delivered|undelivered|failed
      table.string("skip_reason", 32).nullable(); // opted_out|no_consent|compliant|disabled|error
      table.string("error_code", 32).nullable();
      table.string("error_message", 255).nullable();
      table.timestamp("scheduled_for").nullable();
      table.timestamp("sent_at").nullable();
      table.timestamp("delivered_at").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.index(["patient_id"], "notification_log_patient_index");
      table.index(["status"], "notification_log_status_index");
      table.index(["organization_id", "created_at"], "notification_log_org_created_index");
      // twilio_sid lookup for the status-callback webhook.
      table.index(["twilio_sid"], "notification_log_sid_index");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("notification_log");
};
