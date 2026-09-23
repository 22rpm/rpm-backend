// migrations/20260922120000_clinical_sms_hard_disable_and_method.js
//
// Phase 2 increment 2 (CLINICIAN_SMS_DESIGN.md): the SUD / 42 CFR Part 2 per-patient
// HARD-DISABLE of free-text clinical SMS, plus the coded consent_method.
//
// PRIVACY: the hard-disable is a NEUTRAL BOOLEAN — it records THAT free-text clinical
// SMS is disabled for this patient, never WHY. No diagnosis, no reason text, is stored
// anywhere (storing "SUD" would itself be Part 2-protected data). `consent_method` is a
// CODED ENUM (verbal_phone | in_person), never free text, so no one can type a diagnosis
// into it.
//
// Idempotent, applying the P1-failure lessons: hasColumn guard on every column, and an
// information_schema check before adding the foreign key. Runs cleanly on a fresh DB and
// on a re-run.
//
// TYPE: sms_clinical_hard_disabled_by is INT UNSIGNED to match users.id. VERIFIED, not
// assumed — config/migrations/20250819123759_create_users_table.js creates users.id with
// table.increments() (INT UNSIGNED in MySQL), and every FK to users in this repo uses
// integer().unsigned(). A bigint here would fail the FK add exactly like the P1 mismatch.
//
// PROD HAS NO BACKUPS — mysqldump before running on prod. Deploy this migration BEFORE
// the code that writes consent_method / the hard-disable columns.

async function hasForeignKey(knex, table, constraintName) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = ?
        AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [table, constraintName]
  );
  return rows.length > 0;
}

const FK_NAME = "patient_comm_prefs_sms_clinical_hard_disabled_by_foreign";

exports.up = async function (knex) {
  // Neutral boolean: free-text clinical SMS disabled for this patient (reason NOT stored).
  if (!(await knex.schema.hasColumn("patient_comm_prefs", "sms_clinical_hard_disabled"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.boolean("sms_clinical_hard_disabled").notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn("patient_comm_prefs", "sms_clinical_hard_disabled_at"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.timestamp("sms_clinical_hard_disabled_at").nullable();
    });
  }
  if (!(await knex.schema.hasColumn("patient_comm_prefs", "sms_clinical_hard_disabled_by"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.integer("sms_clinical_hard_disabled_by").unsigned().nullable(); // match users.id (INT UNSIGNED)
    });
  }
  if (!(await hasForeignKey(knex, "patient_comm_prefs", FK_NAME))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.foreign("sms_clinical_hard_disabled_by", FK_NAME)
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    });
  }

  // Coded consent method — enum only, never free text.
  if (!(await knex.schema.hasColumn("patient_comm_prefs", "consent_method"))) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.enu("consent_method", ["verbal_phone", "in_person"]).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (await hasForeignKey(knex, "patient_comm_prefs", FK_NAME)) {
    await knex.schema.alterTable("patient_comm_prefs", (t) => {
      t.dropForeign("sms_clinical_hard_disabled_by", FK_NAME);
    });
  }
  for (const col of [
    "sms_clinical_hard_disabled",
    "sms_clinical_hard_disabled_at",
    "sms_clinical_hard_disabled_by",
    "consent_method",
  ]) {
    if (await knex.schema.hasColumn("patient_comm_prefs", col)) {
      await knex.schema.alterTable("patient_comm_prefs", (t) => t.dropColumn(col));
    }
  }
};
