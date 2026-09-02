// migrations/20260902140000_create_biller_organizations.js
//
// The multi-org join for the read-only biller role. Every existing role is scoped
// to one org (users.organization_id) or spans all (super-admin); a biller works
// across SOME clinics but not necessarily all. A biller's users.organization_id is
// NULL (like super-admin); the orgs they may bill for are the rows here.
//
// FAIL-CLOSED: no rows = no access. resolveOrgScope checks membership on every
// request, so an unassigned biller (or a biller requesting an org they're not in)
// resolves no scope and is refused — an empty set means zero access, not full.

exports.up = async function (knex) {
  const has = await knex.schema.hasTable("biller_organizations");
  if (!has) {
    await knex.schema.createTable("biller_organizations", function (table) {
      table.bigIncrements("id").primary();
      table.integer("biller_user_id").unsigned().notNullable();
      table.foreign("biller_user_id").references("id").inTable("users").onDelete("CASCADE");
      table.integer("organization_id").unsigned().notNullable();
      table.foreign("organization_id").references("id").inTable("organizations").onDelete("CASCADE");
      table.integer("assigned_by").unsigned().nullable();
      table.foreign("assigned_by").references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.unique(["biller_user_id", "organization_id"], "biller_org_unique");
      table.index(["biller_user_id"], "biller_org_biller_index");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("biller_organizations");
};
