exports.up = function (knex) {
  return knex.schema.alterTable("devices", function (table) {
    // Add new columns
    table.string("dev_id").notNullable();
    table.integer("user_id").unsigned().notNullable();

    // Add foreign key constraint
    table.foreign("user_id").references("id").inTable("users");

    // Remove old columns
    table.dropColumn("username");
    table.dropColumn("name");

    // Add unique constraint to prevent duplicate devices per user
    table.unique(["dev_id", "user_id"]);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("devices", function (table) {
    // Remove new columns and constraints
    table.dropUnique(["dev_id", "user_id"]);
    table.dropForeign("user_id");
    table.dropColumn("user_id");
    table.dropColumn("dev_id");

    // Add back old columns
    table.string("username").notNullable();
    table.string("name").notNullable();
  });
};
