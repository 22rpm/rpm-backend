exports.up = function (knex) {
  return knex.schema.table("users", function (table) {
    table.boolean("is_active").defaultTo(true); // true = active, false = inactive
    table.timestamp("last_login").nullable();  // track last login time
  });
};

exports.down = function (knex) {
  return knex.schema.table("users", function (table) {
    table.dropColumn("is_active");
    table.dropColumn("last_login");
  });
};
