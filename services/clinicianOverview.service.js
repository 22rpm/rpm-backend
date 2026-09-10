// services/clinicianOverview.service.js
//
// Data layer for the clinician overview page (CLINICIAN_OVERVIEW_DESIGN.md, Part 1).
// Per patient on the clinician's panel: the period's BP stats (avg/high/low/median),
// their BASELINE over a trailing window, a within-period trend, and a headline STATUS
// that separates "stable but out of range" (known, not news — e.g. a chronically-low
// diastolic) from "changed from baseline" (news). This is the anti-cry-wolf design:
// a patient whose low is her normal must NOT read the same as a patient who just dropped.
//
// Bucketing is on created_at (server receipt) until measured_at PR 2/2 — surfaced to the
// caller in `period.bucketed_on` and `bucketing_note`, and required on the page.
//
// DEFAULTS below are starting values pending clinical sign-off (same owner as the AHA
// alert thresholds) — see CLINICIAN_OVERVIEW_DESIGN "clinical judgment".

const db = require("../config/db");

const MIN_STATS = 4; // below this: limited data, no derived confidence, no trend
const TREND_MIN_N = 6; // need >= this many, >=3 per half, to state a within-period trend
const STEADY_BAND_SYS = 5; // mmHg; within-period second-half vs first-half systolic
const BASELINE_BAND_SYS = 5; // mmHg; period-avg vs baseline-avg systolic
const BASELINE_BAND_DIA = 4; // mmHg; period-avg vs baseline-avg diastolic
const BASELINE_WINDOW_DAYS = 90;

// Population (AHA) in-range bands — SAME source as the alert gate.
const sysInRange = (v) => v >= 90 && v < 140;
const diaInRange = (v) => v >= 60 && v < 90;

const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// The LAST COMPLETE calendar week (Mon–Sun) or month — never a partial current period. A
// clinician reads this after the Monday email; a 20%-elapsed week gives meaningless stats
// that change on every reload. Complete periods are stable and comparable. `end` is the
// EXCLUSIVE upper bound (the start of the current period). TZ is server/UTC for v1
// (created_at is stored UTC); clinic-local alignment is a refinement (noted in the design).
function periodBounds(periodType, now = new Date()) {
  let start;
  let end;
  if (periodType === "week") {
    const d = new Date(now);
    const mondayOffset = (d.getDay() + 6) % 7; // 0 = Monday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - mondayOffset);
    end = d; // this week's Monday = exclusive end of the last complete week
    start = new Date(end);
    start.setDate(start.getDate() - 7); // last week's Monday
  } else {
    end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0); // 1st of this month
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0); // 1st of last month
  }
  return { start, end };
}

function summarizeVital(periodVals, baselineVals, { steadyBand, baselineBand, inRangeFn }) {
  const n = periodVals.length;
  if (!n) return { n: 0 };

  const avg = mean(periodVals);
  const med = median(periodVals);
  const summary = {
    n,
    avg,
    high: Math.max(...periodVals),
    low: Math.min(...periodVals),
    median: med,
    // Period-level in-range judgment is on the MEDIAN — on small n a single outlier
    // shouldn't flip the headline. in_range=false is what makes a vital "out of range".
    in_range: inRangeFn(med),
    baseline: null,
    period_trend: "insufficient", // up | steady | down | insufficient
    vs_baseline: "insufficient", // higher | lower | consistent | insufficient
  };

  if (baselineVals.length) {
    summary.baseline = {
      avg: mean(baselineVals),
      low: Math.min(...baselineVals),
      high: Math.max(...baselineVals),
      n: baselineVals.length,
      window_days: BASELINE_WINDOW_DAYS,
    };
  }

  // Within-period trend: first half vs second half (interpretable, stable on small n).
  if (n >= TREND_MIN_N) {
    const half = Math.floor(n / 2);
    const firstHalf = periodVals.slice(0, half);
    const secondHalf = periodVals.slice(n - half);
    if (firstHalf.length >= 3 && secondHalf.length >= 3) {
      const delta = mean(secondHalf) - mean(firstHalf);
      summary.period_trend = delta > steadyBand ? "up" : delta < -steadyBand ? "down" : "steady";
    }
  }

  // Period vs baseline: is this period different from THIS patient's norm? This is the
  // signal that separates "stable low" (consistent) from "just dropped" (lower).
  if (summary.baseline && summary.baseline.n >= MIN_STATS) {
    const d = avg - summary.baseline.avg;
    summary.vs_baseline = d > baselineBand ? "higher" : d < -baselineBand ? "lower" : "consistent";
  }

  return summary;
}

// Headline status — drives the UI's visual weight.
//   no_data           n = 0 (adherence gap)
//   limited_data      0 < n < MIN_STATS (foreground n; don't imply confidence)
//   changed           moved from baseline OR trending within period  -> HIGHLIGHT (news)
//   stable_out_of_range  out of range but consistent with baseline    -> CALM (known, not news)
//   in_range          within population bands and stable              -> neutral
function patientStatus(sys, dia) {
  const n = Math.max(sys.n || 0, dia.n || 0);
  if (n === 0) return "no_data";
  if (n < MIN_STATS) return "limited_data";

  const vitals = [sys, dia].filter((v) => v && v.n);
  const changed = vitals.some(
    (v) =>
      v.vs_baseline === "higher" ||
      v.vs_baseline === "lower" ||
      v.period_trend === "up" ||
      v.period_trend === "down"
  );
  if (changed) return "changed";

  if (vitals.some((v) => v.in_range === false)) return "stable_out_of_range";
  return "in_range";
}

function vitalFlags(sys, dia) {
  const flags = [];
  if (sys.n && sys.in_range === false) flags.push(sys.median >= 140 ? "systolic_above_range" : "systolic_below_range");
  if (dia.n && dia.in_range === false) flags.push(dia.median >= 90 ? "diastolic_above_range" : "diastolic_below_range");
  return flags;
}

// AHA descriptive BP staging (same clinical basis as the AHA-approved alert thresholds).
// sysBand returns the out-of-normal band NAME, or null when the reading is normal — so the
// sentence only adds a band qualifier when one is warranted, and never labels a normal
// reading "elevated". The band trails the movement ("...trending up, still in the elevated
// band") rather than leading as a warning ("now in an elevated range"), which fought a
// favorable trend.
function sysBand(v) {
  if (v < 90) return "low";
  if (v < 120) return null; // normal — no band qualifier
  if (v < 130) return "elevated";
  if (v < 140) return "stage-1 (high)";
  return "stage-2 (high)";
}
function diaRangeWord(v) {
  if (v < 60) return "a low";
  if (v < 80) return "a normal";
  if (v < 90) return "a stage-1 (high)";
  return "a stage-2 (high)";
}

// DESCRIPTIVE summary sentence — deterministic template over data we actually have. NO AI,
// no model, no PHI leaves the box, no clinical inference beyond restating the numbers. Leads
// with systolic (primary driver); states direction vs the patient's own baseline, the
// within-period trend, and the current range; adds diastolic and the transmission days.
//
// DELIBERATELY OMITTED (data not in the system — see the inventory):
//   TODO(EHR): "Last seen by primary care <date>" — no visits/encounters table exists; a
//              visit date is an EHR fact we never receive. Do NOT fabricate "unknown".
//   TODO(regulatory + scheduling): "Consider scheduling a telehealth/PT appointment" — that
//              is a CARE RECOMMENDATION (clinical decision support), driven by device data,
//              and there is no clinical-appointment object (scheduled_calls = our outreach
//              calls). Holds for a regulatory determination + a real appointment system.
function summaryText(p, periodDays) {
  if (p.status === "no_data") return "No readings transmitted this period.";
  if (p.status === "limited_data")
    return `Only ${p.reading_count} reading${p.reading_count === 1 ? "" : "s"} this period — not enough to assess a trend.`;

  const s = p.systolic;
  const d = p.diastolic;
  const dayClause = `Transmitted ${p.days_with_readings} of ${periodDays} days (${p.reading_count} reading${p.reading_count === 1 ? "" : "s"}).`;

  // Lead direction/trend/range from systolic.
  const bits = [];
  if (s && s.n) {
    let dir = "";
    if (s.baseline) {
      const delta = Math.abs(Math.round((s.baseline.avg || 0) - s.median));
      if (s.vs_baseline === "lower") dir = `down ${delta} from a ${s.baseline.avg} baseline`;
      else if (s.vs_baseline === "higher") dir = `up ${delta} from a ${s.baseline.avg} baseline`;
      else if (s.vs_baseline === "consistent") dir = `steady against a ${s.baseline.avg} baseline`;
    }
    const trend =
      s.period_trend === "up" ? "trending up within the month"
      : s.period_trend === "down" ? "trending down within the month"
      : s.period_trend === "steady" ? "holding steady within the month" : "";
    let lead = `Systolic ${s.median}`;
    if (dir) lead += `, ${dir}`;
    if (trend) lead += ` but ${trend}`;
    // Band trails the movement, and only when out of normal. "still in" when declining,
    // "now in" when rising, "in" when steady — so a favorable trend isn't overridden by a
    // warning-sounding range label.
    const band = sysBand(s.median);
    if (band) {
      const verb = s.vs_baseline === "lower" ? "still in" : s.vs_baseline === "higher" ? "now in" : "in";
      lead += `, ${verb} the ${band} band.`;
    } else {
      lead += ".";
    }
    bits.push(lead);
  }
  if (d && d.n) {
    let dd = `Diastolic ${d.median}`;
    if (d.baseline && d.vs_baseline === "lower") dd += `, down ${Math.abs(Math.round(d.baseline.avg - d.median))} from ${d.baseline.avg}`;
    else if (d.baseline && d.vs_baseline === "higher") dd += `, up ${Math.abs(Math.round(d.median - d.baseline.avg))} from ${d.baseline.avg}`;
    else if (d.baseline && d.vs_baseline === "consistent" && d.in_range === false) dd += `, below range but consistent with a ${d.baseline.avg} baseline`;
    dd += ` (${diaRangeWord(d.median)} range).`;
    bits.push(dd);
  }
  bits.push(dayClause);
  return bits.join(" ");
}

async function getClinicianOverviewService({ userId, orgWide = false, orgScope = null, periodType = "month" }) {
  const type = periodType === "week" ? "week" : "month";
  const { start, end } = periodBounds(type);
  const baselineStart = new Date(start);
  baselineStart.setDate(baselineStart.getDate() - BASELINE_WINDOW_DAYS);

  // Calendar date labels from the boundary Date objects' OWN components (not toISOString()).
  // toISOString() renders the boundary in UTC, and a Pacific client then shifts midnight to
  // the prior day (Aug 1 00:00 UTC -> "Jul 31" locally) — the off-by-one. start_date/end_date
  // are plain YYYY-MM-DD the client formats WITHOUT a timezone conversion.
  const ymd = (d) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const endInclusive = new Date(end.getTime() - 1); // last instant of the completed period
  const periodMeta = {
    type,
    start: start.toISOString(),
    end: endInclusive.toISOString(),
    start_date: ymd(start), // e.g. "2026-08-01" — for display, no TZ shift
    end_date: ymd(endInclusive), // e.g. "2026-08-31"
    baseline_window_days: BASELINE_WINDOW_DAYS,
    period_days: Math.round((end.getTime() - start.getTime()) / 86400000),
    bucketed_on: "created_at",
  };
  const bucketing_note =
    "Readings are grouped by the date they reached us (created_at), not the measurement " +
    "time, until measured_at ships. A reading taken earlier but synced later appears in " +
    "the later period.";

  // Panel: assigned patients (clinician) or all active org patients (org-wide roles).
  // ENROLLMENT is surfaced, NOT silently filtered. A real patient has a patient_profiles
  // row (written by the enrollment flow); role='patient' users without one (device serials
  // as names — artifacts — but ALSO a real patient whose profile hasn't been filled in yet)
  // are marked `enrolled: false` and shown in their own "not enrolled" section, so a missing
  // profile reads as a TO-DO, not a disappearance. Discharged patients are excluded (off the
  // panel). enrolled = has an active/pending profile.
  let patients;
  if (orgWide) {
    [patients] = await db.query(
      `SELECT u.id, u.name, (pp.program_status IS NOT NULL) AS enrolled
         FROM users u
         JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
         LEFT JOIN patient_profiles pp ON pp.user_id = u.id
        WHERE u.organization_id = ? AND u.is_active = 1
          AND (pp.program_status IS NULL OR pp.program_status IN ('active', 'pending'))`,
      [orgScope]
    );
  } else {
    [patients] = await db.query(
      `SELECT u.id, u.name, (pp.program_status IS NOT NULL) AS enrolled
         FROM users u
         JOIN patient_doctor_assignments pda ON pda.patient_id = u.id AND pda.doctor_id = ?
         JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
         LEFT JOIN patient_profiles pp ON pp.user_id = u.id
        WHERE u.is_active = 1
          AND (pp.program_status IS NULL OR pp.program_status IN ('active', 'pending'))`,
      [userId]
    );
  }

  if (!patients.length) {
    return { ok: true, period: periodMeta, bucketing_note, patient_count: 0, patients: [] };
  }

  const ids = patients.map((p) => p.id);
  // [baselineStart, end): the completed period plus its 90d baseline. The `< end` cap
  // excludes the current partial period so stats never shift on reload mid-period.
  const [rows] = await db.query(
    `SELECT user_id, data, created_at FROM dev_data
      WHERE user_id IN (?) AND dev_type = 'bp' AND created_at >= ? AND created_at < ?
      ORDER BY user_id, created_at ASC`,
    [ids, baselineStart, end]
  );

  // Group readings per patient, split into baseline (< period start) and period ([start, end)).
  const byPatient = new Map(ids.map((id) => [id, { period: [], baseline: [], series: [] }]));
  for (const row of rows) {
    let d;
    try {
      d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    } catch {
      continue;
    }
    const sys = Number(d.systolic);
    const dia = Number(d.diastolic);
    if (!Number.isFinite(sys) || !Number.isFinite(dia)) continue;
    const bucket = byPatient.get(row.user_id);
    if (!bucket) continue;
    const inPeriod = new Date(row.created_at) >= start;
    (inPeriod ? bucket.period : bucket.baseline).push({ sys, dia, t: row.created_at });
    if (inPeriod) bucket.series.push({ t: row.created_at, sys, dia });
  }

  const out = patients.map((p) => {
    // Not enrolled: no active/pending profile yet. Surface as a to-do, not a stat card.
    if (!p.enrolled) {
      return {
        patient_id: p.id,
        name: p.name,
        enrolled: false,
        reading_count: 0,
        data_quality: "none",
        status: "not_enrolled",
        flags: [],
      };
    }

    const b = byPatient.get(p.id);
    const sysPeriod = b.period.map((r) => r.sys);
    const diaPeriod = b.period.map((r) => r.dia);
    const sysBase = b.baseline.map((r) => r.sys);
    const diaBase = b.baseline.map((r) => r.dia);

    const systolic = summarizeVital(sysPeriod, sysBase, {
      steadyBand: STEADY_BAND_SYS,
      baselineBand: BASELINE_BAND_SYS,
      inRangeFn: sysInRange,
    });
    const diastolic = summarizeVital(diaPeriod, diaBase, {
      steadyBand: STEADY_BAND_SYS,
      baselineBand: BASELINE_BAND_DIA,
      inRangeFn: diaInRange,
    });

    const reading_count = b.period.length;
    // Distinct calendar days transmitted (adherence) — more meaningful than raw reading
    // count, and the unit the summary sentence uses ("10 of 31 days").
    const days_with_readings = new Set(
      b.period.map((r) => new Date(r.t).toISOString().slice(0, 10))
    ).size;
    const data_quality = reading_count === 0 ? "none" : reading_count < MIN_STATS ? "limited" : "ok";
    const status = patientStatus(systolic, diastolic);

    const record = {
      patient_id: p.id,
      name: p.name,
      enrolled: true,
      reading_count,
      days_with_readings,
      data_quality,
      status,
      flags: vitalFlags(systolic, diastolic),
      systolic,
      diastolic,
      trend_series: b.series, // period readings for the sparkline
    };
    record.summary_text = summaryText(record, periodMeta.period_days);
    return record;
  });

  // Actionable first; silent (no_data) then not_enrolled sink to the end so the page can
  // lift each into its own compact section instead of a wall of empty cards.
  const rank = {
    changed: 0, stable_out_of_range: 1, limited_data: 2, in_range: 3, no_data: 4, not_enrolled: 5,
  };
  out.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

  // Summary for the page header (and the future email). transmitting/not_transmitting are
  // among ENROLLED patients; not_enrolled is the profile-to-do count (shown, never hidden).
  const summary = {
    total: out.length, enrolled: 0, not_enrolled: 0,
    transmitting: 0, not_transmitting: 0, by_status: {},
  };
  for (const p of out) {
    summary.by_status[p.status] = (summary.by_status[p.status] || 0) + 1;
    if (p.enrolled === false) {
      summary.not_enrolled += 1;
    } else {
      summary.enrolled += 1;
      if (p.reading_count > 0) summary.transmitting += 1;
      else summary.not_transmitting += 1;
    }
  }

  return { ok: true, period: periodMeta, bucketing_note, summary, patient_count: out.length, patients: out };
}

module.exports = { getClinicianOverviewService };
