exports.up = function (knex) {
  return knex.schema.createTable("messages", function (table) {
    table.increments("id").primary();

    // match users.id (INT UNSIGNED)
    table.integer("sender_id").unsigned().notNullable();
    table.integer("receiver_id").unsigned().notNullable();

    table.text("message").notNullable();
    table.boolean("is_read").defaultTo(false);
    table.timestamps(true, true);

    table.foreign("sender_id").references("id").inTable("users").onDelete("CASCADE");
    table.foreign("receiver_id").references("id").inTable("users").onDelete("CASCADE");

    table.index(["sender_id", "receiver_id"]);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable("messages");
};


// // migrations/create_messages_table.js
// exports.up = function (knex) {
//   return knex.schema.createTable("messages", function (table) {
//     table.increments("id").primary();
//     table.integer("sender_id").notNullable();
//     table.integer("receiver_id").notNullable();
//     table.text("message").notNullable();
//     table.boolean("is_read").defaultTo(false);
//     table.timestamps(true, true);
    
//     table.foreign("sender_id").references("id").inTable("users");
//     table.foreign("receiver_id").references("id").inTable("users");
//     table.index(["sender_id", "receiver_id"]);
//   });
// };

// exports.down = function (knex) {
//   return knex.schema.dropTable("messages");
// };
