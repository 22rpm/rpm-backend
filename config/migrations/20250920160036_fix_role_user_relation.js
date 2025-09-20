exports.up = function (knex) {
  return knex.schema.alterTable("role", (table) => {
    table.integer("user_id").unsigned().alter();
    table
      .foreign("user_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("role", (table) => {
    table.dropForeign("user_id");
    table.string("user_id").alter(); // revert
  });
};
