exports.up = function (knex) {
  return knex.schema.createTable("user_devices", (table) => {
    table.increments("id").primary();
    table
      .integer("user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.string("device_fingerprint", 512).notNullable(); // hashed fingerprint
    table.string("ip_address", 100).notNullable();
    table.string("user_agent", 512).notNullable();

    table.string("refresh_token", 512).nullable(); // for JWT refresh
    table.timestamp("last_used_at").defaultTo(knex.fn.now());

    // MFA related
    table.boolean("mfa_enabled").defaultTo(false);
    table.string("mfa_secret").nullable();
    table.boolean("mfa_verified").defaultTo(false);

    table.timestamps(true, true); // created_at, updated_at
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("user_devices");
};
