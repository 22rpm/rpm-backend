// migrations/20260822120000_create_rpm_notes.js
//
// Signed RPM monthly notes — a billing document that must be defensible: who
// signed, when, from what session, and proof it was not altered afterward.
// Append-only, same ledger pattern as time_entries / clinical_notes: no UPDATE,
// no DELETE. A correction is a NEW row that `supersedes` the prior one; the
// current note is the head of chain (LEFT JOIN self WHERE nothing supersedes it).
//
// `content` is a FROZEN snapshot of what was true at attestation (server-computed
// values + the provider's entered clinical fields + the billing-rule values that
// produced the codes), so recomputing later — e.g. after a time entry is
// corrected — never changes what was signed.
//
// `content_hash` is SHA-256 over the canonical signed record; it is also anchored
// into audit_log in the SAME transaction as the insert, so the hash cannot exist
// without its external record (or vice-versa).
//
// document_key / document_sha256 are nullable placeholders for the rendered PDF,
// filled once PHI-document storage exists (same pattern as patient_consents).

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("rpm_notes");
  if (exists) return;

  await knex.schema.createTable("rpm_notes", function (table) {
    table.bigIncrements("id").primary();

    // Billing record: survives user removal (RESTRICT), like clinical_notes.
    table.integer("patient_id").unsigned().notNullable();
    table.foreign("patient_id").references("id").inTable("users").onDelete("RESTRICT");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("RESTRICT");

    // Service period. Stored as first-of-month DATE.
    table.date("billing_month").notNullable();

    // Frozen snapshot: { computed, clinical, rules_fingerprint }.
    table.json("content").notNullable();

    // The exact attestation wording as signed (config text may change later).
    table.text("attestation_text").notNullable();

    // e-sign: what the provider typed; method supports a future uploaded
    // (Acrobat / wet-signed) artifact without a schema change.
    table.string("signature_name", 200).notNullable();
    table.enu("signature_method", ["e_sign", "uploaded_document"]).notNullable().defaultTo("e_sign");

    // Who / when / from what session.
    table.integer("signed_by").unsigned().notNullable();
    table.foreign("signed_by").references("id").inTable("users").onDelete("RESTRICT");
    table.string("signed_role", 50).notNullable(); // role captured at signing
    // GAP: users has no professional-credential field (MD/NP/RN) today. The
    // Quantix attestation ("personally performed or directly supervised")
    // implies the credential matters to an auditor, but we will not store
    // something more specific than we have. This stays NULL until users carries
    // a real credential; then signing populates it. Do not infer it from role.
    table.string("signed_credential", 100).nullable();
    table.timestamp("signed_at").notNullable().defaultTo(knex.fn.now());
    table.string("signed_ip", 45).nullable(); // IPv6-wide
    table.string("signed_user_agent", 500).nullable();

    // Tamper-evidence over the canonical signed record (also anchored in
    // audit_log within the same transaction).
    table.specificType("content_hash", "char(64)").notNullable();

    // Rendered PDF reference — filled when PHI-doc storage exists.
    table.string("document_key", 255).nullable();
    table.specificType("document_sha256", "char(64)").nullable();

    table.string("correction_reason", 500).nullable();

    // Linear correction chain: a row can be superseded at most once.
    table.bigInteger("supersedes").unsigned().nullable();
    table.foreign("supersedes").references("id").inTable("rpm_notes").onDelete("RESTRICT");
    table.unique(["supersedes"], "rpm_notes_supersedes_unique");

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    // No updated_at: append-only.

    table.index(["patient_id", "billing_month"], "rpm_notes_patient_month_index");
    table.index(["organization_id"], "rpm_notes_org_index");
    table.index(["signed_by"], "rpm_notes_signed_by_index");
  });

  // One ORIGINAL (root) note per patient+month, DB-enforced. head_key is the
  // (patient, month) key only for root rows (supersedes IS NULL); corrections
  // get NULL, and MySQL permits many NULLs in a unique index, so only the single
  // root per month is constrained. Combined with UNIQUE(supersedes) this yields
  // exactly one correction chain per patient+month; its tip is the current note.
  await knex.raw(
    "ALTER TABLE rpm_notes " +
      "ADD COLUMN head_key VARCHAR(40) GENERATED ALWAYS AS " +
      "(CASE WHEN supersedes IS NULL THEN CONCAT(patient_id, '-', billing_month) ELSE NULL END) STORED, " +
      "ADD UNIQUE KEY rpm_notes_head_key_unique (head_key)"
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("rpm_notes");
};
