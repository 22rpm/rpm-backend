// migrations/YYYYMMDDHHMMSS_add_doctor_alert_settings.js

exports.up = function (knex) {
  return knex.schema.createTable("doctor_alert_settings", function (table) {
    table.increments("id").primary();

    // Doctor reference
    table.integer("doctor_id").unsigned().notNullable();
    table.foreign("doctor_id").references("id").inTable("users");

    // BP Alert Thresholds
    table.integer("systolic_high").defaultTo(140);
    table.integer("systolic_low").defaultTo(90);
    table.integer("diastolic_high").defaultTo(90);
    table.integer("diastolic_low").defaultTo(60);

    // Timestamps
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    // Ensure one settings record per doctor
    table.unique(["doctor_id"]);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("doctor_alert_settings");
};
