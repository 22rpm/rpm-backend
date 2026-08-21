// services/bpClassifier.js
//
// THE single blood-pressure evaluator. Both display and alerting call this — it
// replaces the three overlapping mechanisms that existed before (a module-level
// calculateBPStatus, an inner calculateBPStatus, and determineTypeForClinician),
// and it does NOT read doctor_alert_settings (retired — it was inert).
//
// Two SEPARATE axes:
//   classification — AHA/ACC categories, for DISPLAY.
//   alert_level    — whether/how hard it pages, a SEPARATE threshold (Quantix §8).
//
// Confirmed thresholds (medical director + Quantix template, Aug 2026):
//   Classification (evaluate most-severe-first; the OR bands overlap):
//     Crisis   SBP > 180  OR DBP > 120        (strict >)
//     Stage 2  SBP >= 140 OR DBP >= 90         (inclusive >=)
//     Stage 1  SBP 130-139 OR DBP 80-89
//     Elevated SBP 120-129 AND DBP < 80
//     Normal   SBP < 120 AND DBP < 80
//     Low      SBP < 90 OR DBP < 60            (not an AHA hypertension class, but
//                                               a real reading state we surface)
//   Paging:
//     Crisis                    -> emergency (pages)
//     SBP > 160 OR DBP > 100     -> urgent    (pages)   [strict >, Quantix §8]
//     Stage 1 / Stage 2 below that -> abnormal_flag (shown, does NOT page)
//     Low                        -> urgent (pages) — PENDING: the medical
//                                   director has not set a low-BP paging
//                                   threshold; this PRESERVES today's behavior
//                                   (low BP currently pages) rather than silently
//                                   dropping it. Revisit when the low threshold
//                                   is confirmed.
//     Normal / Elevated / Error  -> none
//   Malformed reading -> Error (data-quality state; never clinical, never pages).
//
// Per-patient overrides (§3.5) may move the URGENT paging line only (never the
// AHA classification). Nobody configures them yet; the signature supports them.

const DEFAULT_THRESHOLDS = {
  crisis: { systolic: 180, diastolic: 120 }, // strict >
  urgent: { systolic: 160, diastolic: 100 }, // strict >
  stage2: { systolic: 140, diastolic: 90 }, // inclusive >=
  stage1: { systolic: 130, diastolic: 80 }, // inclusive >= (low end of band)
  elevatedSystolic: 120,
  low: { systolic: 90, diastolic: 60 }, // strict < is "Low"
};

function classifyBP(systolic, diastolic, overrides = {}) {
  const s = Number(systolic);
  const d = Number(diastolic);
  if (!Number.isFinite(s) || !Number.isFinite(d)) {
    return { classification: "Error", alert_level: "none", pages: false, error: true };
  }
  const t = DEFAULT_THRESHOLDS;
  const urgentSys = overrides.urgent_systolic ?? t.urgent.systolic;
  const urgentDia = overrides.urgent_diastolic ?? t.urgent.diastolic;

  // --- AHA classification (most severe first) ---
  let classification;
  if (s > t.crisis.systolic || d > t.crisis.diastolic) classification = "Crisis";
  else if (s >= t.stage2.systolic || d >= t.stage2.diastolic) classification = "Stage 2";
  else if ((s >= t.stage1.systolic && s <= 139) || (d >= t.stage1.diastolic && d <= 89))
    classification = "Stage 1";
  else if (s < t.low.systolic || d < t.low.diastolic) classification = "Low";
  else if (s >= t.elevatedSystolic && s <= 129 && d < t.stage1.diastolic)
    classification = "Elevated";
  else classification = "Normal";

  // --- Paging (separate threshold) ---
  let alert_level;
  if (classification === "Crisis") alert_level = "emergency";
  else if (s > urgentSys || d > urgentDia) alert_level = "urgent";
  else if (classification === "Low") alert_level = "urgent"; // pending MD low threshold
  else if (classification === "Stage 1" || classification === "Stage 2")
    alert_level = "abnormal_flag";
  else alert_level = "none";

  const pages = alert_level === "emergency" || alert_level === "urgent";
  return { classification, alert_level, pages, error: false };
}

module.exports = { classifyBP, DEFAULT_THRESHOLDS };
