// migrations/20260921120000_messages_sms_bridge.js
//
// Phase 1 of two-way clinician<->patient SMS + in-app Messages (CLINICIAN_SMS_DESIGN.md,
// "Phase 1 — CONCRETE BUILD SPEC" 2026-09-21). Bridges SMS into the in-app `messages`
// model and makes read-state CARE-TEAM-SHARED.
//
// `messages` becomes a PATIENT-KEYED conversation, not just a 1:1 DM:
//   - patient_id        = the patient party of the conversation (set at insert; backfilled here).
//                         The "conversation" is all rows for a patient_id, not a sender/receiver pair.
//   - channel           = in_app | sms (the transport the row came in / went out on).
//   - is_read on an INBOUND row (sender = the patient) now means "the CARE TEAM has read it" —
//     cleared for EVERYONE when any staff member opens the thread (keyed to patient_id, not the
//     viewer). read_at/read_by audit who cleared it. On OUTBOUND rows is_read keeps its old meaning
//     ("the patient has read it", for the mobile app) — no conflict.
//   - notification_log_id links an SMS row to its Twilio wire/delivery row.
//
// The mobile app's existing 1:1 send/thread endpoints keep working: every new column is
// nullable or defaulted.
//
// PROD HAS NO BACKUPS — mysqldump before running this migration on prod.

exports.up = async function (knex) {
  // --- messages: patient_id ---
  if (!(await knex.schema.hasColumn("messages", "patient_id"))) {
    await knex.schema.alterTable("messages", (table) => {
      table.integer("patient_id").unsigned().nullable(); // match users.id
      table
        .foreign("patient_id")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.index(["patient_id"], "messages_patient_index");
    });
  }

  // --- messages: channel ---
  if (!(await knex.schema.hasColumn("messages", "channel"))) {
    await knex.schema.alterTable("messages", (table) => {
      table.enu("channel", ["in_app", "sms"]).notNullable().defaultTo("in_app");
    });
  }

  // --- messages: notification_log_id (link an SMS row to its wire/delivery row) ---
  if (!(await knex.schema.hasColumn("messages", "notification_log_id"))) {
    await knex.schema.alterTable("messages", (table) => {
      table.bigInteger("notification_log_id").unsigned().nullable();
      table
        .foreign("notification_log_id")
        .references("id")
        .inTable("notification_log")
        .onDelete("SET NULL");
    });
  }

  // --- messages: shared-read audit (read_at / read_by) ---
  if (!(await knex.schema.hasColumn("messages", "read_at"))) {
    await knex.schema.alterTable("messages", (table) => {
      table.timestamp("read_at").nullable();
      table.integer("read_by").unsigned().nullable();
      table
        .foreign("read_by")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    });
  }

  // Backfill patient_id = whichever of sender/receiver has role 'patient'. Roles live in
  // the `role` table (role.user_id, role.role_type). A message is patient<->staff, so
  // exactly one side is a patient. Two passes (sender side, then receiver side).
  await knex.raw(
    `UPDATE messages m
       JOIN role rs ON rs.user_id = m.sender_id AND rs.role_type = 'patient'
        SET m.patient_id = m.sender_id
      WHERE m.patient_id IS NULL`
  );
  await knex.raw(
    `UPDATE messages m
       JOIN role rr ON rr.user_id = m.receiver_id AND rr.role_type = 'patient'
        SET m.patient_id = m.receiver_id
      WHERE m.patient_id IS NULL`
  );

  // --- notification_log: message_id back-reference to the human `messages` row ---
  if (!(await knex.schema.hasColumn("notification_log", "message_id"))) {
    await knex.schema.alterTable("notification_log", (table) => {
      table.bigInteger("message_id").unsigned().nullable();
      table
        .foreign("message_id")
        .references("id")
        .inTable("messages")
        .onDelete("SET NULL");
      table.index(["message_id"], "notification_log_message_index");
    });
  }

  // --- patient_comm_prefs: sms_clinical_consent (Phase 2 gate; added now so it's one change) ---
  if (!(await knex.schema.hasColumn("patient_comm_prefs", "sms_clinical_consent"))) {
    await knex.schema.alterTable("patient_comm_prefs", (table) => {
      // Separate from sms_consent (reminders). Free-text clinical SMS gates on THIS + !opted_out.
      table.boolean("sms_clinical_consent").notNullable().defaultTo(false);
      table.timestamp("sms_clinical_consent_at").nullable();
      table.integer("sms_clinical_consent_by").unsigned().nullable();
      table
        .foreign("sms_clinical_consent_by")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
      // The approved consent-wording version the patient agreed to (CLINICIAN_SMS_DESIGN.md).
      table.string("sms_clinical_consent_version", 32).nullable();
    });
  }

  // --- message_notify_log: the daily-cadence dedupe key ---
  // One no-PHI email fanout per patient per Pacific day. UNIQUE(patient_id, notified_on):
  // the inbound handler INSERTs and only sends when the row is newly created.
  if (!(await knex.schema.hasTable("message_notify_log"))) {
    await knex.schema.createTable("message_notify_log", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table
        .foreign("patient_id")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.date("notified_on").notNullable(); // Pacific calendar day
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.unique(["patient_id", "notified_on"], "message_notify_patient_day_unique");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("message_notify_log");

  if (await knex.schema.hasColumn("patient_comm_prefs", "sms_clinical_consent")) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.dropForeign("sms_clinical_consent_by");
    });
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.dropColumn("sms_clinical_consent");
      t.dropColumn("sms_clinical_consent_at");
      t.dropColumn("sms_clinical_consent_by");
      t.dropColumn("sms_clinical_consent_version");
    });
  }

  if (await knex.schema.hasColumn("notification_log", "message_id")) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.dropForeign("message_id");
    });
    await knex.schema.alterTable("notification_log", (t) => {
      t.dropColumn("message_id");
    });
  }

  // messages: drop FKs first, then columns.
  for (const col of ["notification_log_id", "read_by", "patient_id"]) {
    if (await knex.schema.hasColumn("messages", col)) {
      await knex.schema.alterTable("messages", (t) => {
        t.dropForeign(col);
      });
    }
  }
  await knex.schema.alterTable("messages", (t) => {
    if (t) {
      t.dropColumn("channel");
      t.dropColumn("notification_log_id");
      t.dropColumn("read_at");
      t.dropColumn("read_by");
      t.dropColumn("patient_id");
    }
  });
};
