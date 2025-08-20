exports.up = function (knex) {
  return knex.schema.alterTable("user_devices", (table) => {
    table.string("mfa_otp", 6).nullable(); // 6-digit OTP
    table.timestamp("mfa_expires_at").nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("user_devices", (table) => {
    table.dropColumn("mfa_otp");
    table.dropColumn("mfa_expires_at");
  });
};
