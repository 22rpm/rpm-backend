# Analytics follow-ups (Phase 2 — not built)

## 1. Statistical anomaly detection: readings before vs. after a new medication

**Idea (deferred, Phase 2):** flag when a patient's vital-sign readings shift in a
statistically meaningful way after a new medication is introduced — e.g. BP that
doesn't fall after a new antihypertensive, or a drop that overshoots. The goal is
to surface "this med change isn't doing what was expected" without a human having
to eyeball every trend line.

**Status:** scoped as an idea only. Do NOT build yet. Recorded 2026-09-01 at the
user's request alongside the ICD-10 / insurance / allergy work.

### What data it would need

Most of the raw material exists; the missing piece is a reliable **medication-change
timeline** to split "before" from "after".

1. **A dated medication-change event stream.** The anomaly test is a before/after
   comparison, so it needs an unambiguous "the med changed on date D" signal:
   - which medication, and whether it was **started / stopped / dose-changed**
     (a dose change is as important as a start);
   - the **effective date** of the change (not just when it was entered).
   The medications feature captures patient-reported meds and clinician
   confirmation, but confirm it records a *dated change history* (start date, and
   an append row on dose change), not just the current state. If it only stores
   current state, a `medication_events` history is the prerequisite.

2. **The vitals time series** (already present): BP, SpO2, HR, weight, etc., with
   timestamps, per patient. This is what deviceData already stores.

3. **A stable per-metric baseline.** Need enough pre-change readings to establish
   a baseline distribution (mean + variance, or a robust equivalent). Define a
   minimum window (e.g. ≥N readings across ≥M days before the change) below which
   no anomaly is computed — an underpowered comparison is worse than none.

4. **A washout / onset lag per drug class.** Most drugs don't act instantly;
   comparing the day-after to the day-before will produce false signals. Either a
   fixed lag (ignore the first K days after the change) or a per-class onset
   parameter is needed. This is the part most likely to need clinical input.

5. **Confounders to at least record, if not adjust for:** other med changes in the
   same window, a dialysis schedule (already flagged on the patient), and
   device/measurement changes (a new cuff can shift BP). Overlapping med changes in
   the same window should suppress attribution to any single drug.

### Design cautions (carry these forward)

- **Statistical, labelled as such — never diagnostic.** Same principle as the
  billing overview and the reorder estimate: a wrong "this med isn't working"
  signal is worse than none. Present as "readings changed after this change —
  review", not a conclusion.
- **Multiple-comparisons risk.** Testing every metric × every med change will throw
  false positives; needs a correction or a conservative threshold.
- **Needs a real n.** With one org and few patients today, there isn't enough data
  to validate thresholds. This is genuinely Phase 2 — after the med-change history
  exists and there's a reading corpus to tune against.

### Smallest first step when it is picked up

Ship the **dated medication-change history** (`medication_events` or equivalent)
as part of the medications feature regardless — it's cheap now, it's the hard
prerequisite, and without it this analysis can never be built retroactively (you
can't reconstruct when a dose changed after the fact).
