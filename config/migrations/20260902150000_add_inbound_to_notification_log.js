// migrations/20260902150000_add_inbound_to_notification_log.js
//
// Inbound patient SMS replies. Until now the webhook received every reply,
// handled STOP/START/HELP, and DROPPED everything else — a patient texting back
// vanished. These columns let notification_log hold both directions so the
// Notifications tab is a two-way thread, and let a clinician acknowledge a reply
// (which clears the "reply waiting" signal on the patient list).
//
//   direction        'outbound' (our sends, the default) | 'inbound' (patient reply)
//   acknowledged_at  when a staff member marked the inbound reply seen (NULL = unread)
//   acknowledged_by  who acknowledged it

exports.up = async function (knex) {
  const hasDir = await knex.schema.hasColumn("notification_log", "direction");
  const hasAckAt = await knex.schema.hasColumn("notification_log", "acknowledged_at");
  const hasAckBy = await knex.schema.hasColumn("notification_log", "acknowledged_by");
  await knex.schema.alterTable("notification_log", function (table) {
    if (!hasDir) table.string("direction", 16).notNullable().defaultTo("outbound");
    if (!hasAckAt) table.timestamp("acknowledged_at").nullable();
    if (!hasAckBy) {
      table.integer("acknowledged_by").unsigned().nullable();
      table.foreign("acknowledged_by").references("id").inTable("users").onDelete("SET NULL");
    }
  });
  // Index the unread-inbound lookup that powers the patient-list badge.
  await knex.schema.alterTable("notification_log", function (table) {
    table.index(["patient_id", "direction", "acknowledged_at"], "notif_inbound_unread_idx");
  });
};

exports.down = async function (knex) {
  const hasIdx = true;
  await knex.schema.alterTable("notification_log", function (table) {
    try { table.dropIndex(["patient_id", "direction", "acknowledged_at"], "notif_inbound_unread_idx"); } catch (e) {}
  });
  const hasAckBy = await knex.schema.hasColumn("notification_log", "acknowledged_by");
  const hasAckAt = await knex.schema.hasColumn("notification_log", "acknowledged_at");
  const hasDir = await knex.schema.hasColumn("notification_log", "direction");
  await knex.schema.alterTable("notification_log", function (table) {
    if (hasAckBy) { table.dropForeign("acknowledged_by"); table.dropColumn("acknowledged_by"); }
    if (hasAckAt) table.dropColumn("acknowledged_at");
    if (hasDir) table.dropColumn("direction");
  });
};
