exports.up = function (knex) {
  return knex.schema.alterTable("users", (table) => {
    table
      .integer("organization_id")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("organizations")
      .onDelete("CASCADE");
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("users", (table) => {
    table.dropColumn("organization_id");
  });
};
