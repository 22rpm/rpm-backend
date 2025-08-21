export async function up(knex) {
  // Change column from DATETIME to TIMESTAMP
  await knex.schema.alterTable("otp_tokens", (table) => {
    table.timestamp("expires_at").notNullable().alter();
  });
}

export async function down(knex) {
  // Revert back to DATETIME if needed
  await knex.schema.alterTable("otp_tokens", (table) => {
    table.dateTime("expires_at").notNullable().alter();
  });
}