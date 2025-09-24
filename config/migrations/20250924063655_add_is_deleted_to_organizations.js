exports.up = function (knex) {
  return knex.schema.table('organizations', function (table) {
    table.boolean('is_deleted').notNullable().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.table('organizations', function (table) {
    table.dropColumn('is_deleted');
  });
};