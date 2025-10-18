exports.up = function (knex) {
  return knex.schema.table("dev_data", function (table) {
    // Add dev_type column - make it nullable initially
    table.string("dev_type").nullable();

    // Optional: Add index for better performance
    table.index("dev_type");
  });
};

exports.down = function (knex) {
  return knex.schema.table("dev_data", function (table) {
    // Remove the column if rolling back
    table.dropColumn("dev_type");
    table.dropIndex("dev_type");
  });
};
