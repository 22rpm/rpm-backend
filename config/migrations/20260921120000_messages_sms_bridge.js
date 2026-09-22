// migrations/20260921120000_messages_sms_bridge.js
//
// Phase 1 of two-way clinician<->patient SMS + in-app Messages (CLINICIAN_SMS_DESIGN.md,
// "Phase 1 — CONCRETE BUILD SPEC" 2026-09-21). Bridges SMS into the in-app `messages`
// model and makes read-state CARE-TEAM-SHARED.
//
// `messages` becomes a PATIENT-KEYED conversation, not just a 1:1 DM:
//   - patient_id        = the patient party of the conversation (set at insert; backfilled here).
//   - channel           = in_app | sms.
//   - is_read on an INBOUND row (sender = the patient) means "the CARE TEAM has read it".
//   - notification_log_id links an SMS row to its Twilio wire/delivery row.
//
// FULLY IDEMPOTENT / RESUMABLE. A first attempt failed on prod partway through (MySQL
// has no DDL rollback) with the migration NOT recorded in knex_migrations, leaving a
// half-applied schema: the `messages` columns + their FKs already existed, and
// `notification_log.message_id` had been created as `bigint unsigned` (the wrong type)
// with NO foreign key, because messages.id is `int unsigned` and the FK add failed on
// the type mismatch. So every step here is guarded — hasColumn / hasTable, plus
// information_schema checks before adding any index or foreign key, and message_id is
// ALTERed to the right type (not dropped). This runs cleanly on that half-applied
// state AND on a fresh DB.
//
// PROD HAS NO BACKUPS — mysqldump before running this migration on prod.

// ---- guarded-DDL helpers (information_schema against the current DATABASE()) ----

async function hasColumn(knex, table, column) {
  return knex.schema.hasColumn(table, column);
}

async function hasIndex(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function hasForeignKey(knex, table, constraintName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = ?
        AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [table, constraintName]
  );
  return rows.length > 0;
}

// The COLUMN_TYPE string, lowercased (e.g. "int unsigned", "bigint unsigned"), or null.
async function columnType(knex, table, column) {
  const [rows] = await knex.raw(
    `SELECT COLUMN_TYPE AS t FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows[0] ? String(rows[0].t).toLowerCase() : null;
}

function isIntUnsigned(colType) {
  // matches "int unsigned" and "int(10) unsigned"; NOT "bigint unsigned".
  return !!colType && colType.startsWith("int") && colType.includes("unsigned");
}

exports.up = async function (knex) {
  // ========================= messages =========================
  // patient_id (column, index, FK) — each guarded independently.
  if (!(await hasColumn(knex, "messages", "patient_id"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.integer("patient_id").unsigned().nullable(); // match users.id (int unsigned)
    });
  }
  if (!(await hasIndex(knex, "messages", "messages_patient_index"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.index(["patient_id"], "messages_patient_index");
    });
  }
  if (!(await hasForeignKey(knex, "messages", "messages_patient_id_foreign"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.foreign("patient_id", "messages_patient_id_foreign")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
    });
  }

  // channel
  if (!(await hasColumn(knex, "messages", "channel"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.enu("channel", ["in_app", "sms"]).notNullable().defaultTo("in_app");
    });
  }

  // notification_log_id (bigint unsigned — matches notification_log.id, a bigIncrements) + FK
  if (!(await hasColumn(knex, "messages", "notification_log_id"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.bigInteger("notification_log_id").unsigned().nullable();
    });
  }
  if (
    !(await hasForeignKey(knex, "messages", "messages_notification_log_id_foreign"))
  ) {
    await knex.schema.alterTable("messages", (t) => {
      t.foreign("notification_log_id", "messages_notification_log_id_foreign")
        .references("id")
        .inTable("notification_log")
        .onDelete("SET NULL");
    });
  }

  // read_at / read_by (+ FK on read_by)
  if (!(await hasColumn(knex, "messages", "read_at"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.timestamp("read_at").nullable();
    });
  }
  if (!(await hasColumn(knex, "messages", "read_by"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.integer("read_by").unsigned().nullable();
    });
  }
  if (!(await hasForeignKey(knex, "messages", "messages_read_by_foreign"))) {
    await knex.schema.alterTable("messages", (t) => {
      t.foreign("read_by", "messages_read_by_foreign")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    });
  }

  // Backfill patient_id = whichever of sender/receiver has role 'patient'. Idempotent
  // (only touches rows still NULL). Two passes (sender side, then receiver side).
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

  // ===================== notification_log.message_id =====================
  // MUST be int unsigned to match messages.id (int unsigned). On the half-applied prod
  // state this column exists as bigint unsigned with no FK — ALTER it (don't drop),
  // then add the index + FK.
  if (!(await hasColumn(knex, "notification_log", "message_id"))) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.integer("message_id").unsigned().nullable();
    });
  } else if (!isIntUnsigned(await columnType(knex, "notification_log", "message_id"))) {
    // e.g. bigint unsigned -> int unsigned. Column is empty (all NULL) and has no FK yet.
    await knex.raw(
      "ALTER TABLE notification_log MODIFY COLUMN message_id INT UNSIGNED NULL"
    );
  }
  if (!(await hasIndex(knex, "notification_log", "notification_log_message_index"))) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.index(["message_id"], "notification_log_message_index");
    });
  }
  if (
    !(await hasForeignKey(
      knex,
      "notification_log",
      "notification_log_message_id_foreign"
    ))
  ) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.foreign("message_id", "notification_log_message_id_foreign")
        .references("id")
        .inTable("messages")
        .onDelete("SET NULL");
    });
  }

  // ===================== patient_comm_prefs (Phase 2 gate) =====================
  if (!(await hasColumn(knex, "patient_comm_prefs", "sms_clinical_consent"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.boolean("sms_clinical_consent").notNullable().defaultTo(false);
    });
  }
  if (!(await hasColumn(knex, "patient_comm_prefs", "sms_clinical_consent_at"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.timestamp("sms_clinical_consent_at").nullable();
    });
  }
  if (!(await hasColumn(knex, "patient_comm_prefs", "sms_clinical_consent_by"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.integer("sms_clinical_consent_by").unsigned().nullable();
    });
  }
  if (
    !(await hasForeignKey(
      knex,
      "patient_comm_prefs",
      "patient_comm_prefs_sms_clinical_consent_by_foreign"
    ))
  ) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.foreign(
        "sms_clinical_consent_by",
        "patient_comm_prefs_sms_clinical_consent_by_foreign"
      )
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    });
  }
  if (
    !(await hasColumn(knex, "patient_comm_prefs", "sms_clinical_consent_version"))
  ) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.string("sms_clinical_consent_version", 32).nullable();
    });
  }

  // ===================== message_notify_log (daily email lock) =====================
  if (!(await knex.schema.hasTable("message_notify_log"))) {
    await knex.schema.createTable("message_notify_log", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table
        .foreign("patient_id", "message_notify_log_patient_id_foreign")
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

  // patient_comm_prefs
  if (
    await hasForeignKey(
      knex,
      "patient_comm_prefs",
      "patient_comm_prefs_sms_clinical_consent_by_foreign"
    )
  ) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.dropForeign(
        "sms_clinical_consent_by",
        "patient_comm_prefs_sms_clinical_consent_by_foreign"
      );
    });
  }
  for (const col of [
    "sms_clinical_consent",
    "sms_clinical_consent_at",
    "sms_clinical_consent_by",
    "sms_clinical_consent_version",
  ]) {
    if (await hasColumn(knex, "patient_comm_prefs", col)) {
      await knex.schema.alterTable("patient_comm_prefs", (t) => t.dropColumn(col));
    }
  }

  // notification_log.message_id
  if (
    await hasForeignKey(
      knex,
      "notification_log",
      "notification_log_message_id_foreign"
    )
  ) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.dropForeign("message_id", "notification_log_message_id_foreign");
    });
  }
  if (await hasIndex(knex, "notification_log", "notification_log_message_index")) {
    await knex.schema.alterTable("notification_log", (t) => {
      t.dropIndex(["message_id"], "notification_log_message_index");
    });
  }
  if (await hasColumn(knex, "notification_log", "message_id")) {
    await knex.schema.alterTable("notification_log", (t) => t.dropColumn("message_id"));
  }

  // messages — drop FKs, then index, then columns (each guarded).
  const messagesFks = [
    ["patient_id", "messages_patient_id_foreign"],
    ["notification_log_id", "messages_notification_log_id_foreign"],
    ["read_by", "messages_read_by_foreign"],
  ];
  for (const [col, name] of messagesFks) {
    if (await hasForeignKey(knex, "messages", name)) {
      await knex.schema.alterTable("messages", (t) => t.dropForeign(col, name));
    }
  }
  if (await hasIndex(knex, "messages", "messages_patient_index")) {
    await knex.schema.alterTable("messages", (t) =>
      t.dropIndex(["patient_id"], "messages_patient_index")
    );
  }
  for (const col of [
    "channel",
    "notification_log_id",
    "read_at",
    "read_by",
    "patient_id",
  ]) {
    if (await hasColumn(knex, "messages", col)) {
      await knex.schema.alterTable("messages", (t) => t.dropColumn(col));
    }
  }
};
