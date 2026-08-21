// config/callOutcomes.js
//
// Constrained set for patient_calls.outcome (confirmed Aug 2026). Replaces the
// former free text. Anything beyond the category — "advised recheck in 3 days",
// who the caregiver was, etc. — goes in the call's `note` field, not here.
//
// QUALIFYING_OUTCOMES are the outcomes that count as a LIVE interactive
// communication for 99457 test (b). Reaching the patient or a caregiver counts;
// a missed call, voicemail, bad number, or decline does not.
const CALL_OUTCOMES = [
  "Reached patient",
  "Reached caregiver",
  "No answer",
  "Left voicemail",
  "Wrong or disconnected number",
  "Patient declined",
];

const QUALIFYING_OUTCOMES = ["Reached patient", "Reached caregiver"];

module.exports = { CALL_OUTCOMES, QUALIFYING_OUTCOMES };
