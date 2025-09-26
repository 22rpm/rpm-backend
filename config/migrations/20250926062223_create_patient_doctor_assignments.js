exports.up = function (knex) {
  return knex.schema.createTable("patient_doctor_assignments", (table) => {
    table.increments("id").primary();
    table
      .integer("patient_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table
      .integer("doctor_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    // must allow NULL if you want SET NULL
    table
      .integer("assigned_by")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table.timestamp("created_at").defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("patient_doctor_assignments");
};
