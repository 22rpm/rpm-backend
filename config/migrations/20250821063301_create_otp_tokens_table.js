// migrations/20250820120000_create_otp_tokens.js

exports.up = async function (knex) {
  await knex.schema.createTable("otp_tokens", (table) => {
    table.increments("id").primary();
    table
      .integer("user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.string("otp_code", 10).notNullable();

    table
      .enu("otp_type", ["login", "mfa", "password_reset"], {
        useNative: true,
        enumName: "otp_type_enum",
      })
      .notNullable()
      .defaultTo("login");

    table.dateTime("expires_at").notNullable();
    table.boolean("consumed").defaultTo(false);
    table.timestamp("created_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("otp_tokens");
  if (knex.client.config.client === "pg") {
    await knex.raw("DROP TYPE IF EXISTS otp_type_enum");
  }
};
