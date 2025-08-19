exports.up = function (knex) {
  return knex.schema.createTable("devices", function (table) {
    table.increments("id").primary();
    table.string("username").notNullable();
    table.string("name").notNullable();
    table.string("dev_type").unique().notNullable();
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("devices");
};
