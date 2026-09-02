// migrations/20260901140200_create_patient_allergies.js
//
// Drug allergies + the crucial "no known drug allergies" (NKDA) attestation.
//
// The safety-critical distinction (design constraint): "no known allergies" and
// "none recorded" mean different things and only one is safe to rely on, so the
// green NKDA state must be a claim SOMEONE ACTIVELY MADE, never a default.
// That is why NKDA is an explicit flag with a reviewer + timestamp — it is set
// only when a clinician records it, and the default (nothing recorded) is a
// distinct third state. The derived status:
//   - rows in patient_allergies exist      -> HAS ALLERGIES (loud/red)
//   - else nkda = 1                         -> No known drug allergies (green; attested)
//   - else (nkda = 0, reviewed_at NULL)     -> Not recorded (amber; unknown)
//
// Substance only — no severity, no reaction grading: a free-text "mild" label on
// a banner invites someone to discount it, so the list is uniformly loud.

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("patient_allergies");
  if (!hasTable) {
    await knex.schema.createTable("patient_allergies", function (table) {
      table.bigIncrements("id").primary();
      table.integer("patient_id").unsigned().notNullable();
      table
        .foreign("patient_id")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.string("substance", 255).notNullable();
      table.integer("recorded_by").unsigned().nullable();
      table.foreign("recorded_by").references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.index(["patient_id"], "patient_allergies_patient_index");
    });
  }

  // NKDA attestation lives on the profile (one per patient), with who/when so the
  // banner can show "recorded by X on <date>". reviewed_at is set whenever a
  // clinician records allergy status (adds allergies OR checks NKDA) — its being
  // NULL is what distinguishes "not recorded" from an attested state.
  const hasNkda = await knex.schema.hasColumn("patient_profiles", "nkda");
  const hasRevAt = await knex.schema.hasColumn("patient_profiles", "allergies_reviewed_at");
  const hasRevBy = await knex.schema.hasColumn("patient_profiles", "allergies_reviewed_by");
  await knex.schema.alterTable("patient_profiles", function (table) {
    if (!hasNkda) table.boolean("nkda").notNullable().defaultTo(false);
    if (!hasRevAt) table.timestamp("allergies_reviewed_at").nullable();
    if (!hasRevBy) {
      table.integer("allergies_reviewed_by").unsigned().nullable();
      table
        .foreign("allergies_reviewed_by")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
    }
  });
};

exports.down = async function (knex) {
  const hasRevBy = await knex.schema.hasColumn("patient_profiles", "allergies_reviewed_by");
  const hasRevAt = await knex.schema.hasColumn("patient_profiles", "allergies_reviewed_at");
  const hasNkda = await knex.schema.hasColumn("patient_profiles", "nkda");
  await knex.schema.alterTable("patient_profiles", function (table) {
    if (hasRevBy) {
      table.dropForeign("allergies_reviewed_by");
      table.dropColumn("allergies_reviewed_by");
    }
    if (hasRevAt) table.dropColumn("allergies_reviewed_at");
    if (hasNkda) table.dropColumn("nkda");
  });
  await knex.schema.dropTableIfExists("patient_allergies");
};
