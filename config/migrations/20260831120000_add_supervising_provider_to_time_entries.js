/**
 * time_entries.supervising_provider_id — record the supervision link at the
 * moment the work is logged, rather than inferring it when the note is rendered.
 *
 * Why: `staff_user_id` already records WHO did the work, and that is correct.
 * What was missing is under WHOSE supervision non-provider time was performed.
 * Without it the note can only infer supervision from today's
 * patient_doctor_assignments — which is the assignment as it stands when the
 * note is generated, not as it stood when the minutes were logged. For a
 * billing record that is read months later by someone reconstructing what
 * happened, an inference that silently changes when a patient is reassigned is
 * not good enough.
 *
 * NULLABLE on purpose:
 *   - Existing rows predate the column; there is no honest value to backfill.
 *     Leaving them NULL means "not recorded", which is true. Backfilling from
 *     the current assignment would manufacture a supervision claim that nobody
 *     made — exactly the kind of thing this column exists to prevent.
 *   - Provider-performed time has no supervisor: the provider performed it
 *     personally. NULL is correct there too, and `staff_user_id`'s role
 *     distinguishes the two NULL meanings.
 *
 * RESTRICT on delete, matching the other FKs on this table: a billing record
 * must not lose its supervision link because a user row was removed.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("time_entries", (table) => {
    table.integer("supervising_provider_id").unsigned().nullable();
    table
      .foreign("supervising_provider_id")
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("time_entries", (table) => {
    table.dropForeign("supervising_provider_id");
    table.dropColumn("supervising_provider_id");
  });
};
