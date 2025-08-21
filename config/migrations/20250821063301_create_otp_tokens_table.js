// migrations/20250820120000_create_otp_tokens.js

export async function up(knex) {
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

    // emulate ENUM using check constraint
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
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("otp_tokens");
  // drop enum separately if using PostgreSQL
  if (knex.client.config.client === "pg") {
    await knex.raw("DROP TYPE IF EXISTS otp_type_enum");
  }
}
