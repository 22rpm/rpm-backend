// services/careValidation.js
//
// Shared server-side validation for clinical-time inputs, used by both manual
// time entries (Part 2) and call documentation (Part 4) so the billing-time
// rules have a single source of truth.

// A single manual/call time component may not exceed 8 hours. Typical monthly
// RPM billable time is ~20-40 min, so this is a generous ceiling whose real job
// is catching fat-finger errors, not encoding billing policy.
const MAX_DURATION_MINUTES = 480;

// Returns { date } on success or { error } on failure.
function validateStartedAt(value) {
  if (value === undefined || value === null || value === "") {
    return { error: "started_at is required" };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: "started_at is not a valid date" };
  }
  if (date.getTime() > Date.now()) {
    return { error: "started_at cannot be in the future" };
  }
  return { date };
}

// Returns { minutes, seconds } on success or { error } on failure.
function validateDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { error: "duration_minutes must be a positive integer" };
  }
  if (minutes > MAX_DURATION_MINUTES) {
    return {
      error: `duration_minutes must not exceed ${MAX_DURATION_MINUTES} (8 hours)`,
    };
  }
  return { minutes, seconds: minutes * 60 };
}

module.exports = {
  MAX_DURATION_MINUTES,
  validateStartedAt,
  validateDurationMinutes,
};
