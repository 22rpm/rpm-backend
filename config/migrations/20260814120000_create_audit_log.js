// migrations/20260814120000_create_audit_log.js
//
// Append-only audit trail for clinical and administrative actions.
// Required by HIPAA 164.312(b) and by the Phase 1 roadmap requirement that
// every review, call, note, alert resolution, and time entry carry a
// user/date/time trail.
//
// Written to but never updated or deleted by application code.
// Retention: six years.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("audit_log");
  if (exists) return;

  await knex.schema.createTable("audit_log", function (table) {
    table.bigIncrements("id").primary();

    // Nullable so the row survives user deletion — losing the audit record
    // because the account was removed defeats the purpose.
    table.integer("actor_id").unsigned().nullable();
    table
      .foreign("actor_id")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    // Role captured at the time of the action. Roles change; the audit
    // record must reflect what the actor was when they acted.
    table.string("actor_role", 50).notNullable();

    // Dotted action name, e.g. 'patient.view', 'org.context_switch'
    table.string("action", 100).notNullable();

    table.string("entity_type", 50).notNullable();
    table.integer("entity_id").unsigned().nullable();

    // Denormalised for fast per-clinic queries.
    table.integer("organization_id").unsigned().nullable();

    table.string("ip_address", 100).nullable();
    table.string("user_agent", 512).nullable();

    // Action-specific detail. Never store PHI values here — reference by id.
    table.json("metadata").nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["entity_type", "entity_id"], "audit_log_entity_index");
    table.index(["actor_id", "created_at"], "audit_log_actor_index");
    table.index(["organization_id", "created_at"], "audit_log_org_index");
    table.index(["action", "created_at"], "audit_log_action_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("audit_log");
};