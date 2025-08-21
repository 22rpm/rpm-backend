exports.up = async function (knex) {
  // Change column from DATETIME to TIMESTAMP
  await knex.schema.alterTable("otp_tokens", (table) => {
    table.timestamp("expires_at").notNullable().alter();
  });
};

exports.down = async function (knex) {
  // Revert back to DATETIME if needed
  await knex.schema.alterTable("otp_tokens", (table) => {
    table.dateTime("expires_at").notNullable().alter();
  });
};
