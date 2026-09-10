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

// Period = current calendar week (Mon 00:00 -> now) or month (1st -> now). Boundaries are
// returned so the page/email agree. TZ is server/UTC for v1 (created_at is stored UTC);
// clinic-local alignment is a refinement (noted in the design).
function periodBounds(periodType, now = new Date()) {
  const end = now;
  let start;
  if (periodType === "week") {
    const d = new Date(now);
    const mondayOffset = (d.getDay() + 6) % 7; // 0 = Monday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - mondayOffset);
    start = d;
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  return { start, end };
}

function summarizeVital(periodVals, baselineVals, { steadyBand, baselineBand, inRangeFn }) {
  const n = periodVals.length;
  if (!n) return { n: 0 };

  const avg = mean(periodVals);
  const summary = {
    n,
    avg,
    high: Math.max(...periodVals),
    low: Math.min(...periodVals),
    median: median(periodVals),
    // Period-level in-range judgment is on the AVERAGE (a single stray reading shouldn't
    // flip the headline). in_range=false is what makes a vital "out of range".
    in_range: inRangeFn(avg),
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
  if (sys.n && sys.in_range === false) flags.push(sys.avg >= 140 ? "systolic_above_range" : "systolic_below_range");
  if (dia.n && dia.in_range === false) flags.push(dia.avg >= 90 ? "diastolic_above_range" : "diastolic_below_range");
  return flags;
}

async function getClinicianOverviewService({ userId, orgWide = false, orgScope = null, periodType = "month" }) {
  const type = periodType === "week" ? "week" : "month";
  const { start, end } = periodBounds(type);
  const baselineStart = new Date(start);
  baselineStart.setDate(baselineStart.getDate() - BASELINE_WINDOW_DAYS);

  const periodMeta = {
    type,
    start: start.toISOString(),
    end: end.toISOString(),
    baseline_window_days: BASELINE_WINDOW_DAYS,
    bucketed_on: "created_at",
  };
  const bucketing_note =
    "Readings are grouped by the date they reached us (created_at), not the measurement " +
    "time, until measured_at ships. A reading taken earlier but synced later appears in " +
    "the later period.";

  // Panel: assigned patients (clinician) or all active org patients (org-wide roles).
  let patients;
  if (orgWide) {
    [patients] = await db.query(
      `SELECT u.id, u.name FROM users u
         JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
        WHERE u.organization_id = ? AND u.is_active = 1`,
      [orgScope]
    );
  } else {
    [patients] = await db.query(
      `SELECT u.id, u.name FROM users u
         JOIN patient_doctor_assignments pda ON pda.patient_id = u.id AND pda.doctor_id = ?
         JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
        WHERE u.is_active = 1`,
      [userId]
    );
  }

  if (!patients.length) {
    return { ok: true, period: periodMeta, bucketing_note, patient_count: 0, patients: [] };
  }

  const ids = patients.map((p) => p.id);
  const [rows] = await db.query(
    `SELECT user_id, data, created_at FROM dev_data
      WHERE user_id IN (?) AND dev_type = 'bp' AND created_at >= ?
      ORDER BY user_id, created_at ASC`,
    [ids, baselineStart]
  );

  // Group readings per patient, split into baseline (< period start) and period (>=).
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
    const data_quality = reading_count === 0 ? "none" : reading_count < MIN_STATS ? "limited" : "ok";
    const status = patientStatus(systolic, diastolic);

    return {
      patient_id: p.id,
      name: p.name,
      reading_count,
      data_quality,
      status,
      flags: vitalFlags(systolic, diastolic),
      systolic,
      diastolic,
      trend_series: b.series, // period readings for the sparkline
    };
  });

  // Surface the actionable rows first: changed, then out-of-range, then no-data, then rest.
  const rank = { changed: 0, stable_out_of_range: 1, no_data: 2, limited_data: 3, in_range: 4 };
  out.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));

  return { ok: true, period: periodMeta, bucketing_note, patient_count: out.length, patients: out };
}

module.exports = { getClinicianOverviewService };
