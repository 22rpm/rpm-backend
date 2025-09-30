export async function up(knex) {
  await knex.schema.alterTable("alerts", (table) => {
    table.dropUnique(["type"], "alerts_type_unique"); // remove unique constraint
  });
}

export async function down(knex) {
  await knex.schema.alterTable("alerts", (table) => {
    table.unique(["type"], "alerts_type_unique"); // rollback re-adds it
  });
}
