/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.table("dev_data", (table) => {
    table.integer("user_id").unsigned().after("dev_id"); // add user_id column after dev_id
    // Optional: if you have a users table
    // table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.table("dev_data", (table) => {
    table.dropColumn("user_id");
  });
};
