// config/billingTz.js
//
// One place that defines "what day is this reading on, in the clinic's timezone"
// and "what UTC instants bound a clinic-local calendar month". Every billing /
// worklist / vitals query that windows or buckets by a timestamp MUST use these,
// so the note, the worklist, and the vitals view can never disagree about a day
// boundary (TZ_FIX_DESIGN.md PR 3).
//
// Storage is UTC (the mysql2 session is pinned to '+00:00' in config/db.js), so
// timestamps read back as true instants. These helpers convert those instants to
// the CLINIC tz for bucketing/windowing via MySQL CONVERT_TZ with a NAMED zone
// (DST-correct; an offset is not). CONVERT_TZ with a named zone requires the
// MySQL named-tz tables to be loaded — a hard deploy gate (see the runbook); if
// they are missing CONVERT_TZ returns NULL and buckets collapse, so that check
// is part of deploy, not something these helpers can paper over.

const CLINIC_TZ_DEFAULT = "America/Los_Angeles";

// NULL / blank org timezone -> the app default. IANA name expected.
function resolveClinicTz(orgTimezone) {
  return (orgTimezone && String(orgTimezone).trim()) || CLINIC_TZ_DEFAULT;
}

// "YYYY-MM" (defaulting to the current UTC month) -> the clinic-local calendar
// month as plain date-time LABELS. These are wall-clock strings in the clinic's
// zone, NOT instants — so UTC arithmetic on the calendar numbers is correct
// here; the conversion to instants happens in SQL via monthWhere() below.
function monthLabels(month) {
  let y, m;
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    y = Number(month.slice(0, 4));
    m = Number(month.slice(5, 7));
  }
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date();
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    label: `${y}-${pad(m)}`,
    startLocal: `${y}-${pad(m)}-01 00:00:00`, // first of month, clinic-local
    nextLocal: `${ny}-${pad(nm)}-01 00:00:00`, // first of next month, clinic-local
  };
}

// SQL fragment: bucket a timestamp column into its clinic-local calendar day.
// `col` is a FIXED internal identifier (e.g. "created_at"), never user input.
// Bind one param: the clinic tz. Use for DISTINCT day counts and GROUP BY day.
function dayBucketSql(col) {
  return `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', ?), '%Y-%m-%d')`;
}

// SQL fragment: restrict a timestamp column to a clinic-local calendar month,
// half-open [start, next). Converts the clinic-local month bounds to UTC instants
// so the comparison is against the stored UTC values. `col` is a fixed internal
// identifier. Bind, in order: (startLocal, tz, nextLocal, tz) — see monthParams.
function monthWhereSql(col) {
  return `${col} >= CONVERT_TZ(?, ?, '+00:00') AND ${col} < CONVERT_TZ(?, ?, '+00:00')`;
}

// Ordered bind params for monthWhereSql(), given monthLabels() output + tz.
function monthParams(labels, tz) {
  return [labels.startLocal, tz, labels.nextLocal, tz];
}

module.exports = {
  CLINIC_TZ_DEFAULT,
  resolveClinicTz,
  monthLabels,
  dayBucketSql,
  monthWhereSql,
  monthParams,
};
