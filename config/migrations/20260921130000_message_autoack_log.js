// migrations/20260921130000_message_autoack_log.js
//
// Dedupe lock for the inbound-SMS auto-acknowledgement (CLINICIAN_SMS_DESIGN.md
// Phase 1, P1-7 / gate item 5). When a patient texts the clinic, we reply ONCE with
// a no-PHI expectation-setting message ("a team member will reply within one
// business day; not for emergencies, call 911"). UNIQUE(patient_id, acked_on) keeps
// it to at most once per patient per Pacific day, even for a burst of texts.
//
// Separate from message_notify_log (the staff-EMAIL lock): the two fire on the same
// first-inbound-of-the-day but are different messages to different people, so they
// get independent locks.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("message_autoack_log"))) {
    await knex.schema.createTable("message_autoack_log", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table
        .foreign("patient_id")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.date("acked_on").notNullable(); // Pacific calendar day
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.unique(["patient_id", "acked_on"], "message_autoack_patient_day_unique");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("message_autoack_log");
};
