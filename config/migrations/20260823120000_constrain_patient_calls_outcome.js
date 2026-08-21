// migrations/20260823120000_constrain_patient_calls_outcome.js
//
// Normalise patient_calls.outcome from free text to the confirmed constrained
// set (config/callOutcomes.js) and enforce it with a CHECK constraint.
//
// APPEND-ONLY NOTE: patient_calls is an append-only ledger (corrections are new
// rows via `supersedes`). This migration UPDATEs existing rows in place, which
// is deliberate and is NOT a business correction — it is a one-time FORMAT
// normalisation. The meaning is preserved: a value that maps keeps its meaning;
// a value that doesn't map is set to NULL with the ORIGINAL text appended to the
// call's `note` so nothing is lost and a human can reclassify. We never guess a
// specific outcome the source text doesn't support (e.g. bare "reached" does not
// say who was reached, and 99457 distinguishes patient from caregiver, so it maps
// to NULL, not "Reached patient").

const { CALL_OUTCOMES } = require("../callOutcomes");

// Keyword mapping. Only asserts an outcome the text actually supports.
function mapOutcome(raw) {
  const s = String(raw).toLowerCase();
  if (/caregiver|family|spouse|daughter|son|wife|husband/.test(s)) return "Reached caregiver";
  if (/patient/.test(s) && /reach|spoke|talk|answered|connected/.test(s)) return "Reached patient";
  if (/no[\s-]?answer|unanswered|didn'?t answer|did not answer/.test(s)) return "No answer";
  if (/voicemail|left (a )?message|left msg|\bvm\b/.test(s)) return "Left voicemail";
  if (/wrong number|disconnected|bad number|not in service|out of service/.test(s))
    return "Wrong or disconnected number";
  if (/declined|refused|not interested/.test(s)) return "Patient declined";
  return null; // unmapped -> NULL + preserve original in note (never guessed)
}

exports.up = async function (knex) {
  // Fetch every non-null outcome and filter CASE-SENSITIVELY in JS. MySQL's
  // default collation is case-insensitive, so a DB-side `whereNotIn` would treat
  // "no answer" as already equal to "No answer" and skip it — but the app's
  // 99457 detection is case-sensitive, so stored values must be EXACT. Skip only
  // rows that are already exactly canonical.
  const rows = await knex("patient_calls").select("id", "outcome", "note").whereNotNull("outcome");

  for (const r of rows) {
    if (CALL_OUTCOMES.includes(r.outcome)) continue; // exact canonical already
    const mapped = mapOutcome(r.outcome);
    if (mapped) {
      await knex("patient_calls").where({ id: r.id }).update({ outcome: mapped });
    } else {
      const preserved = `[unmapped outcome: "${r.outcome}"]`;
      const newNote = r.note ? `${r.note} ${preserved}` : preserved;
      await knex("patient_calls").where({ id: r.id }).update({ outcome: null, note: newNote });
    }
  }

  // A3: DB-level enforcement going forward, CASE-SENSITIVE (COLLATE utf8mb4_bin)
  // so it matches the app's exact-match validation and the 99457 detection.
  const list = CALL_OUTCOMES.map((o) => knex.raw("?", [o]).toString()).join(", ");
  await knex.raw(
    `ALTER TABLE patient_calls
       ADD CONSTRAINT patient_calls_outcome_chk
       CHECK (outcome IS NULL OR outcome COLLATE utf8mb4_bin IN (${list}))`
  );
};

exports.down = async function (knex) {
  await knex.raw("ALTER TABLE patient_calls DROP CONSTRAINT patient_calls_outcome_chk");
  // The one-time data normalisation is not reversed; original free text is
  // preserved in `note` for unmapped rows.
};
