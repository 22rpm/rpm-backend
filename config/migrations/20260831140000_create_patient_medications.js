// migrations/20260831140000_create_patient_medications.js
//
// Patient-REPORTED medications. This is NOT a prescribing system: a patient reports
// what they take, a clinician confirms it. Nobody prescribes here.
//
// State model — the single most important property of this table:
//   Everything a patient enters is `unconfirmed`, whether AI read it off a bottle
//   label or the patient typed it. Same state, same review. AI reading the label is
//   a convenience, not a shortcut past review. Only a clinician moves an entry to
//   `confirmed` (or `rejected`). A patient can never confirm their own entry.
//   `source` (typed|photo) is recorded as PROVENANCE ONLY and grants zero trust.
//
// An unconfirmed medication must never look confirmed anywhere: it is badged on the
// patient list, badged in the clinician review queue, excluded from confirmed counts,
// and never rendered on the signed note. Enforce that in the API (label/group by
// status) so a frontend cannot accidentally drop the flag.
//
// Mutable, not append-only (unlike patient_consents / rpm_notes). A med list is a
// living record — corrected over time. Integrity rule enforced in the service layer,
// not the schema: editing a `confirmed` entry resets it to `unconfirmed` so a
// confirmed record cannot silently drift after review.
//
// document_key / document_sha256 are nullable placeholders for the label PHOTO, which
// is PHI. Storing it hits the same missing secure object-storage (S3) dependency that
// already blocks consent scans and the rendered note PDF — this is the third dependent
// on that one gate (Husnain). No file upload/storage is built here; these stay null
// until PHI storage lands, exactly as patient_consents.document_key does. On-device
// OCR means the photo path's READ is not blocked, only retaining the source image is.
//
// Deliberately NOT modeled yet (followups, avoid speculative columns):
//   - Pharmacist confirmation as a second state: one confirmed state, clinician-only,
//     for now. Adding a pharmacist role with no pharmacist using it is speculative.
//     The pharmacy_name/pharmacy_phone FIELDS below are just reorder data, not a state.
//   - Active/discontinued lifecycle (patient stops a med): `rejected` covers clinician
//     removal today; patient-initiated discontinuation is a followup.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_medications");
  if (exists) return;

  await knex.schema.createTable("patient_medications", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("CASCADE");

    // Who reported it — the patient. Kept for audit; patient-reported, always.
    table.integer("reported_by").unsigned().nullable();
    table
      .foreign("reported_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    // --- What the patient reported ---
    table.string("drug_name", 255).notNullable();
    // RxNorm concept id, when the entry matched RxNorm autocomplete. Nullable BY
    // DESIGN: if RxNav is down/slow or there is no match, the patient submits free
    // text with rxcui = null. Submission NEVER depends on an RxNorm call. A null just
    // means "unmatched" — fine, because every entry goes through human review anyway.
    table.string("rxcui", 32).nullable();
    table.string("dose", 120).nullable();
    table.string("route", 120).nullable();
    table.string("frequency", 255).nullable();
    table.string("admin_instructions", 500).nullable();

    // Pharmacy for reorder — patient-facing reference data (NOT a confirmation state).
    table.string("pharmacy_name", 255).nullable();
    table.string("pharmacy_phone", 40).nullable();
    // Clinic-to-pharmacy note. Clinician-only — the API must NEVER return this to the
    // patient app.
    table.string("note_to_pharmacy", 500).nullable();

    // Provenance only — grants no trust. Both paths enter as `unconfirmed`.
    table.enu("source", ["typed", "photo"]).notNullable().defaultTo("typed");

    // --- Confirmation state (clinician-only) ---
    table
      .enu("status", ["unconfirmed", "confirmed", "rejected"])
      .notNullable()
      .defaultTo("unconfirmed");
    table.integer("confirmed_by").unsigned().nullable();
    table
      .foreign("confirmed_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamp("confirmed_at").nullable();
    table.string("reject_reason", 500).nullable();

    // --- Label photo reference (PHI; S3-blocked; stays null until storage lands) ---
    table.string("document_key", 255).nullable();
    table.specificType("document_sha256", "char(64)").nullable();

    // Mutable record.
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    // Patient's own list, and per-patient review queue.
    table.index(["patient_id", "status"], "patient_medications_patient_status_index");
    // Org-wide pending-review queue for clinical staff.
    table.index(["organization_id", "status"], "patient_medications_org_status_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_medications");
};
