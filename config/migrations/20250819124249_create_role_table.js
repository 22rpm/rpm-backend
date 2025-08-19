exports.up = function (knex) {
  return knex.schema.createTable("role", function (table) {
    table.increments("id").primary();
    table.string("username");
    table.string("user_id");
    table.string("role_type");
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("role");
};
