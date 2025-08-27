exports.up = function (knex) {
     return knex.schema.alterTable("users", function (table) {
       table.string("phoneNumber", 20).nullable();
     });
   };

   exports.down = function (knex) {
     return knex.schema.alterTable("users", function (table) {
       table.dropColumn("phoneNumber");
     });
   };