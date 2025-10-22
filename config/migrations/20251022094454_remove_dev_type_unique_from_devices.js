exports.up = function (knex) {
  return knex.schema.alterTable("devices", function (table) {
    table.dropUnique(["dev_type"], "devices_dev_type_unique");
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("devices", function (table) {
    table.unique(["dev_type"], "devices_dev_type_unique");
  });
};
