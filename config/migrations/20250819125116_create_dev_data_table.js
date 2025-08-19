exports.up = function (knex) {
  return knex.schema.createTable("dev_data", function (table) {
    table.increments("id").primary();
    table.string("dev_id");
    table.json("data");
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("dev_data");
};
