// migrations/20260902120000_create_patient_comm_prefs.js
//
// Communications consent + the opt-out kill switch for automated patient SMS.
//
// DELIBERATELY SEPARATE FROM RPM CONSENT (patient_consents). Consenting to remote
// monitoring is NOT consenting to automated text messages — conflating the two is
// the failure mode. This table is the ONLY authority for "may we send this patient
// an automated SMS", and the send pipeline gates on it before every send.
//
// opted_out is the kill switch. It is set from THREE independent sources so a
// single failure can't leave a STOPped patient opted-in (opted_out_source records
// which): `stop_keyword` (our inbound webhook), `twilio_21610` (a send that failed
// because Twilio's own carrier-level STOP blocked it — self-healing a missed
// webhook), and `staff`/`patient` (a manual toggle).

exports.up = async function (knex) {
  const has = await knex.schema.hasTable("patient_comm_prefs");
  if (!has) {
    await knex.schema.createTable("patient_comm_prefs", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable().unique();
      table.foreign("patient_id").references("id").inTable("users").onDelete("CASCADE");
      // Consent to receive automated SMS (opt-in). Not the same as RPM consent.
      table.boolean("sms_consent").notNullable().defaultTo(false);
      table.timestamp("sms_consent_at").nullable();
      table.integer("sms_consent_by").unsigned().nullable();
      table.foreign("sms_consent_by").references("id").inTable("users").onDelete("SET NULL");
      // Opt-out kill switch — checked before every send.
      table.boolean("opted_out").notNullable().defaultTo(false);
      table.timestamp("opted_out_at").nullable();
      table.string("opted_out_source", 32).nullable(); // stop_keyword | twilio_21610 | staff | patient
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_comm_prefs");
};
