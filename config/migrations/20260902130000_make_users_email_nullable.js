// migrations/20260902130000_make_users_email_nullable.js
//
// Make users.email NULLABLE so a patient can exist with a PHONE and no email —
// the deferred change in EMAIL_NULLABILITY_AUDIT.md. The rule this enables:
// email OR phone, at least one; a null-email patient logs in by phone (SMS OTP),
// the path that already works.
//
// Low-risk: the `users_email_unique` index already tolerates multiple NULLs in
// MySQL (only non-null values must be unique), so widening NOT NULL -> NULL keeps
// existing emails unique and simply allows NULL going forward. Raw MODIFY so the
// unique index is left untouched.

exports.up = async function (knex) {
  await knex.raw("ALTER TABLE users MODIFY email VARCHAR(255) NULL");
};

exports.down = async function (knex) {
  // Reverting requires no NULL emails to exist; will error if any phone-only
  // patients were created while this was in effect (that's the correct signal).
  await knex.raw("ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL");
};
