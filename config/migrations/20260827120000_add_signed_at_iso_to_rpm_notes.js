// migrations/20260827120000_add_signed_at_iso_to_rpm_notes.js
//
// Ledger hardening (TZ_FIX_DESIGN.md PR 1). The signature hash covers the
// signed_at value as a UTC ISO string (signedRecord.signed_at = signedAtIso).
// At verification time we previously RE-DERIVED that string from the signed_at
// TIMESTAMP column (`toSecondIso(row.signed_at)`), which reads back in the MySQL
// SESSION timezone. That round-trip only reproduces the signed-time string while
// the session tz is unchanged; pinning the session to UTC (PR 2) would shift the
// re-read ISO and make every prior note fail hash-verification — a permanent
// tamper false-positive on a signed billing document.
//
// Fix: persist the EXACT ISO string that was hashed, in an immutable column, and
// verify against THAT string instead of re-deriving it from the TIMESTAMP. After
// this, the column's tz representation can never affect verification again, so
// the session pin (and any later tz change) is safe for the ledger.
//
// Nullable: pre-existing rows (dev test notes only — rpm_notes has never been
// deployed to prod) have no stored string; verify falls back to the old
// re-derivation for them. Every note signed after this runs stores the string
// and verifies tz-independently.

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("rpm_notes");
  if (!hasTable) return; // fresh deploy: create_rpm_notes runs first, then this
  const hasColumn = await knex.schema.hasColumn("rpm_notes", "signed_at_iso");
  if (hasColumn) return;

  await knex.schema.alterTable("rpm_notes", function (table) {
    // The exact UTC ISO-8601 string (whole-second, "…Z") that the content_hash
    // was computed over. Immutable by the table's append-only contract.
    table.string("signed_at_iso", 30).nullable().after("signed_at");
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("rpm_notes");
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn("rpm_notes", "signed_at_iso");
  if (!hasColumn) return;
  await knex.schema.alterTable("rpm_notes", function (table) {
    table.dropColumn("signed_at_iso");
  });
};
