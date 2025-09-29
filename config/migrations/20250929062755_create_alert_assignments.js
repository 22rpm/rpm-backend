// migrations/YYYYMMDDHHMMSS_create_alert_assignments.js

exports.up = function (knex) {
  return knex.schema.createTable("alert_assignments", function (table) {
    table.increments("id").primary();
    table
      .integer("alert_id")
      .unsigned()
      .references("id")
      .inTable("alerts")
      .onDelete("CASCADE");
    table
      .integer("doctor_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE"); // Assuming 'users' table has doctor IDs
    table.timestamps(true, true); // created_at, updated_at
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("alert_assignments");
};
