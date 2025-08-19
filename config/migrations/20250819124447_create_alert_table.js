exports.up = function (knex) {
  return knex.schema.createTable("alerts", function (table) {
    table.increments("id").primary();
    table.string("user_id").notNullable();
    table.string("desc").notNullable();
    table.string("type").unique().notNullable();
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("alerts");
};
