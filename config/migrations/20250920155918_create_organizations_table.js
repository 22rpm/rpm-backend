exports.up = function (knex) {
  return knex.schema.createTable("organizations", (table) => {
    table.increments("id").primary();
    table.string("name").notNullable();
    table.string("org_code").unique().notNullable();
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("organizations");
};
