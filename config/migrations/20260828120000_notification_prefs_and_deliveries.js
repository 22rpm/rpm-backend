// Notification routing for Messages:
//   notification_preferences — per-physician channel opt-out (defaults ON for both).
//   notification_deliveries  — every send attempt + outcome, so a failure is NEVER
//                              silent (Twilio + Gmail were both silently down for
//                              months). Drives the dashboard failure indicator, the
//                              30-min debounce, and async status updates from Twilio.

exports.up = async function (knex) {
  await knex.schema.createTable("notification_preferences", (t) => {
    t.increments("id").primary();
    t.integer("user_id").unsigned().notNullable().unique()
      .references("id").inTable("users").onDelete("CASCADE");
    t.boolean("message_email").notNullable().defaultTo(true); // default ON
    t.boolean("message_sms").notNullable().defaultTo(true);   // default ON
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("notification_deliveries", (t) => {
    t.increments("id").primary();
    t.string("type", 32).notNullable();             // 'message'
    t.integer("recipient_user_id").unsigned().nullable();
    t.integer("patient_id").unsigned().nullable();  // for the per-thread debounce
    t.string("channel", 16).notNullable();          // 'sms' | 'email'
    t.string("status", 24).notNullable();           // sent | accepted | delivered | failed | undelivered | unroutable | skipped
    t.string("provider_ref", 128).nullable();       // twilio message SID (for status callback lookup)
    t.string("provider_status", 64).nullable();
    t.text("error").nullable();
    t.integer("attempts").notNullable().defaultTo(1);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
    t.index(["status", "created_at"]);              // dashboard "recent failures"
    t.index(["patient_id", "recipient_user_id", "created_at"]); // debounce lookup
    t.index(["provider_ref"]);                      // status-callback update
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("notification_deliveries");
  await knex.schema.dropTableIfExists("notification_preferences");
};
