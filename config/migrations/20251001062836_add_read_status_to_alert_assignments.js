exports.up = function (knex) {
  return knex.schema.alterTable("alert_assignments", function (table) {
    table.boolean("read_status").defaultTo(false);
    table.timestamp("read_at").nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("alert_assignments", function (table) {
    table.dropColumn("read_status");
    table.dropColumn("read_at");
  });
};
