// migrations/20260911120000_create_digest_tables.js
//
// Clinician overview digest (CLINICIAN_OVERVIEW_DESIGN.md Part 1). Three tables:
//   digest_sent                   — idempotency: one row per (clinician, period_type,
//                                    period_start); UNIQUE => cannot double-send.
//   digest_run_log                — one row per invocation that did work; the "did Monday's
//                                    run happen and what did it do?" record + deadman source.
//   clinician_notification_settings — per-clinician opt-out (type 'overview_digest'),
//                                    default ON (a row with enabled=0 opts out).
// No FKs to users on the send/log tables: these are historical records that must survive a
// later account change, mirroring how alerts.user_id is kept unconstrained.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("digest_sent"))) {
    await knex.schema.createTable("digest_sent", (t) => {
      t.bigIncrements("id").primary();
      t.integer("clinician_id").unsigned().notNullable();
      t.enu("period_type", ["week", "month"]).notNullable();
      t.date("period_start").notNullable(); // clinic-local start of the period
      t.timestamp("sent_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["clinician_id", "period_type", "period_start"], "digest_sent_unique");
    });
  }

  if (!(await knex.schema.hasTable("digest_run_log"))) {
    await knex.schema.createTable("digest_run_log", (t) => {
      t.bigIncrements("id").primary();
      t.enu("period_type", ["week", "month"]).notNullable();
      t.date("period_start").notNullable();
      t.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("finished_at").nullable();
      t.integer("clinicians_emailed").notNullable().defaultTo(0);
      t.integer("skipped").notNullable().defaultTo(0);
      t.integer("errors").notNullable().defaultTo(0);
      t.string("note", 500).nullable();
      t.index(["period_type", "period_start"], "digest_run_log_period_index");
    });
  }

  if (!(await knex.schema.hasTable("clinician_notification_settings"))) {
    await knex.schema.createTable("clinician_notification_settings", (t) => {
      t.bigIncrements("id").primary();
      t.integer("clinician_id").unsigned().notNullable();
      t.string("type", 40).notNullable(); // 'overview_digest'
      t.boolean("enabled").notNullable().defaultTo(true);
      t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      t.unique(["clinician_id", "type"], "clinician_notif_settings_unique");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("clinician_notification_settings");
  await knex.schema.dropTableIfExists("digest_run_log");
  await knex.schema.dropTableIfExists("digest_sent");
};
