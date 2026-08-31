/**
 * alert_reads — per-reader read state, decoupled from paging.
 *
 * Why a table and not a column: read state lived on `alert_assignments`
 * (`read_status`, `read_at`), which is also the paging target list. An org-wide
 * reader (care_manager / admin) has no assignment row, so they could not mark
 * anything read — and the only way to give them one would be to INSERT into
 * alert_assignments, which would enrol them as an SMS/paging recipient. That is
 * precisely the conflation ALERT_FOLLOWUPS #1 exists to prevent: visibility and
 * responsibility are different axes.
 *
 * This table records "user X has read alert Y" for ANY user who can see the
 * alert, and carries no routing meaning whatsoever. Nothing may ever read it to
 * decide who to notify.
 *
 * UNIQUE(alert_id, user_id) makes marking-read idempotent — re-reading is a
 * no-op via INSERT ... ON DUPLICATE KEY UPDATE, and there is exactly one read
 * record per person per alert.
 *
 * Deliberately NOT backfilled from alert_assignments.read_status. Those rows
 * record that the *assigned clinician* read it; copying them here would invent
 * read events for people who never read anything. The two coexist: the existing
 * clinician flow keeps using alert_assignments (unchanged), and this table is
 * additive.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("alert_reads", (table) => {
    table.bigIncrements("id").unsigned().primary();

    table.integer("alert_id").unsigned().notNullable();
    table.foreign("alert_id").references("id").inTable("alerts").onDelete("CASCADE");

    table.integer("user_id").unsigned().notNullable();
    table.foreign("user_id").references("id").inTable("users").onDelete("CASCADE");

    table.timestamp("read_at").notNullable().defaultTo(knex.fn.now());

    // One read record per person per alert; makes the write idempotent.
    table.unique(["alert_id", "user_id"], { indexName: "alert_reads_alert_user_unique" });
    // Supports "which of these alerts has this user read" for a list render.
    table.index(["user_id", "alert_id"], "alert_reads_user_alert_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("alert_reads");
};
