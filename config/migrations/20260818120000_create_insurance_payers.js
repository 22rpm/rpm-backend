// migrations/20260818120000_create_insurance_payers.js
//
// Payer lookup (name only — no member IDs / policy numbers, ever). Lookup table
// rather than an ENUM so payers can be added/renamed/deactivated without a
// migration, and so the billing worklist can GROUP BY payer. RPM bills under
// Medicare Part B (not Part A); "Medicare Part B" and "Medicare Advantage" are
// distinct payers.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("insurance_payers");
  if (exists) return;

  await knex.schema.createTable("insurance_payers", function (table) {
    table.increments("id").primary();
    table.string("name", 100).notNullable().unique();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex("insurance_payers").insert([
    { name: "Medicare Part B", sort_order: 1 },
    { name: "Medicare Advantage", sort_order: 2 },
    { name: "Medi-Cal", sort_order: 3 },
    { name: "Commercial", sort_order: 4 },
    { name: "Self-pay", sort_order: 5 },
    { name: "Other", sort_order: 6 },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("insurance_payers");
};
