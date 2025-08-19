exports.up = function (knex) {
  return knex.schema.createTable("devices_logs", function (table) {
    table.increments("id").primary();
    table.string("dev_id").notNullable();
    table.string("desc").notNullable();
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("devices_logs");
};
