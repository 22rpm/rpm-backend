exports.up = async function (knex) {
  await knex.schema.alterTable("user_devices", (table) => {
    table.timestamp("last_activity_at").nullable().defaultTo(knex.fn.now()).after("last_used_at");
    table.timestamp("absolute_expires_at").nullable().after("last_activity_at");
    table.boolean("revoked").defaultTo(0).after("absolute_expires_at");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("user_devices", (table) => {
    table.dropColumn("last_activity_at");
    table.dropColumn("absolute_expires_at");
    table.dropColumn("revoked");
  });
};
