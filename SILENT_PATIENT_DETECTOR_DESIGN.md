# Silent-patient detector — design (SCOPE, not built)

**Status:** DESIGN. Nothing built, no migration. Scopes a detector that flags an enrolled
patient whose device has gone silent — the product's core failure mode: *a patient believes
they transmitted and nobody server-side knows they didn't.*
**Date:** 2026-10-01. **Author:** scoped with Ricky.

**Why now:** patients 32 & 33 took BP readings on iOS build 54 that appeared in the app but
never reached the server; `dev_data`'s newest row predates them and `user_devices.last_activity_at`
is stuck days back. A separate investigation covers *why* the post failed (iOS); **this doc covers
only DETECTION** — making a silent patient visible to staff. The two are independent: ship the
detector regardless of the iOS fix, because "nobody knows" is the dangerous part.

---

## ⚠️ PREMISE CORRECTION — read first (it changes the basis)

**`measured_at` PR 2/2 never landed. The 99454 day-count still buckets on `created_at` (receipt
time) today, and the migration comment that says otherwise is WRONG.** This was an explicit open
item in the handoff ("verify the day-count buckets on COALESCE") — **the answer is NO.** Verified
in the live code 2026-10-01:

- **Billing count buckets on `created_at`:** `services/rpmNote.service.js:146,148` —
  `tzq.dayBucketSql("created_at")` / `tzq.monthWhereSql("created_at")`. Not `measured_at`, not
  COALESCE.
- **Overview buckets on `created_at`:** `services/clinicianOverview.service.js:261`
  (`bucketed_on: "created_at"`), reads filter `created_at` (`:307-309`), and bucket in **UTC**
  (`:327-328`).
- **The migration comment is misleading:** `config/migrations/20260904120000_add_measured_at_to_dev_data.js`
  says "the 99454 day-count reads `COALESCE(measured_at, created_at)`." That describes **intended**
  PR 2/2 behavior. PR 1/2 added the *column*; nothing buckets on it. The comment asserts a state the
  code never reached.

**Consequence (billing-accuracy, flag to Cleo):** every 99454 transmission-day count in production
today is computed on **server-receipt time**, not measurement time. A reading taken one day but
received the next (or a batched outbox flush) is credited to the receipt day — the exact
undercount `DEVICE_HISTORY_DESIGN.md` finding A warned about. This predates and is independent of
the detector; recorded here because the detector's correct basis exposes it.

**What this means for the detector:** build it on `COALESCE(measured_at, created_at)` + clinic-tz as
specified — which makes it **more correct than billing is today**. "The same basis billing uses" is
the *intended* basis, not the current one. See Open Decision 2.

---

## 1. The signal

Per patient:
- `last_reading_at = MAX(COALESCE(measured_at, created_at))` from `dev_data WHERE dev_type='bp'`.
- `days_since_last_reading = clinicTzDate(now) − clinicTzDate(last_reading_at)`, using the existing
  shared clinic-tz primitive `tzq` (`config/billingTz`, `dayBucketSql`) over the COALESCE
  expression — **never bare `created_at`.** (A receipt-time detector is fooled by a late batch,
  which is this failure mode.)
- `measured_at` is NULL on older rows and any pre-change app version; COALESCE falls back to
  `created_at` (conservative — a NULL-measured_at reading is dated by receipt, which can only make
  it look *more* recent, never falsely stale).

## 2. Placement — the worklist

`services/patientWorklist.service.js` is the home. It is the staff daily driver, already one row
per org patient (NOT period-bounded), and already assembled from batched `WHERE user_id IN (?)`
queries stitched in JS — so a `MAX(COALESCE(measured_at,created_at)) … GROUP BY user_id` batch
drops into the existing pattern with no new query shape. The worklist has **no reading-recency
field today**; this is net-new.

A row field alone does not satisfy "staff see it without opening the right screen at the right
time," so also:
- **Sort/filter silent patients to the top** of the worklist.
- **Roster-level count** — "N patients silent ≥ X days" — on the worklist header, and mirrored in
  the clinician-overview `summary` block. (Both must respect the worklist's existing
  assignment boundary — a clinician sees only their silent patients, not the org's.)

New per-row fields: `last_reading_at`, `days_since_last_reading`, `reading_status` (see §4),
`billing_jeopardy` (see §5).

## 3. Absolute threshold, not period-bounded

A config `SILENCE_THRESHOLD_DAYS`, evaluated against **now**, independent of any calendar period —
so a patient silent since Sep 29 flags on Oct 1 at `days_since = 2`, not when the month closes. This
is deliberately decoupled from the overview's period-bounded `no_data` (which only means "zero in
the last *complete* bucket"). Default should track the patient's **expected cadence** — reuse the
per-patient cadence already used by `notificationScheduler.runReadingReminders` — with a global
fallback when none is set. (Threshold ownership = Open Decision 1.)

## 4. Flag only patients we believe are active — and split "stopped" from "never started"

Cohort filter: `program_status IN ('active','pending')` (exclude `discharged`; enum is
`active|pending|discharged` on `patient_profiles`), **AND** an active device registration
(`patient_devices` with `returned_at IS NULL` / status active). Then classify into THREE states,
because "stopped" and "never started" are different problems:

- **`went_silent`** — has prior readings but `days_since_last_reading ≥ threshold`. (A device/
  patient that stopped — this failure mode.)
- **`never_transmitted`** — enrolled + device assigned + **zero readings ever**. An onboarding/
  setup failure, not a stoppage. Surface distinctly; do not lump into silence.
- **`ok`** — otherwise.

A discharged patient, or one with no active device, is none of these and is not flagged.

## 5. Reconcile with the 99454 16-day threshold — mid-month silence is a billing risk NOW

The detector carries a **billing-jeopardy** flag beside the care flag. Using
`days_with_readings_this_month` (same COALESCE + clinic-tz basis; threshold `DAYS_THRESHOLD = 16`,
`services/billingSummary.service.js:21`) and `days_left_in_month`:

> **`billing_jeopardy` = (days_with_readings + days_left_in_month < 16)** → the patient *cannot*
> still reach 99454 this period.

That turns "silent 5 days mid-month" into an actionable signal on the day the threshold becomes
unreachable, not at month close. Each flagged patient thus shows *care staleness* (days since last)
and, when applicable, *billing jeopardy*.

## 6. Making the overview and billing agree (separate issue, same root)

They disagree on TWO axes and the clean fix unifies all three consumers (billing, overview,
detector):
- **Column:** move both to `COALESCE(measured_at, created_at)`. For billing that is **landing PR
  2/2** (`rpmNote.service.js:146,148` off `created_at`); for the overview, the reads at
  `clinicianOverview.service.js:307-309,327-328`.
- **Timezone:** move the overview from UTC day boundaries to **clinic-local** via the same
  `tzq`/`billingTz` helper billing uses.
- **Anti-drift:** extract ONE shared "reading-day" expression —
  `tzq.dayBucketSql("COALESCE(measured_at, created_at)")` — called by billing, the overview, AND
  this detector, so they can't diverge again (same pattern as the shared org-scope module).
- **Caveats:** (a) switching the overview basis is a *visible* change — late-synced readings move
  from receipt-day to measurement-day, shifting historical period numbers; keep the existing
  `bucketing_note` until stable. (b) COALESCE (not bare `measured_at`) is mandatory or NULL rows
  vanish. (c) the `/bp/data` path (§Defect) pollutes any measurement-time basis.

---

## OPEN DECISIONS

### 1. Silence threshold — per-patient cadence vs a global default → **Dr. Aamir (clinical)**
Whether the flag fires on each patient's expected cadence (daily patient → flag after N missed
days) or a single global number is a **clinical** decision, not an engineering default. **Needs Dr.
Aamir Jamal, not Ricky.** The mechanism supports either; only the policy is open.

### 2. Ship the detector on COALESCE before billing moves to it? → **Ricky**
The detector's correct basis is `COALESCE(measured_at, created_at)`. Billing still buckets on
`created_at` (Premise Correction). So if we ship the detector now, **the detector and billing will
briefly disagree** — the detector dates a late-synced reading to its measurement day while billing
dates it to receipt. Options:
- **Ship now on COALESCE** (recommended): the detector is correct immediately; accept that it leads
  billing until PR 2/2 lands. The only visible effect is the detector occasionally judging a patient
  *less* silent than billing's receipt-based view would — the safer direction.
- **Wait for PR 2/2** so detector and billing share the basis from day one — but that delays
  detection behind a billing change of unknown timing.
Ricky's call.

---

## DEFECT (own investigation) — `/api/bp/data` sets neither `measured_at` NOR `user_id`

Confirmed in live code 2026-10-01. There are TWO BP ingest paths:
- **Main path — correct:** `createDeviceDataService` inserts
  `(dev_id, user_id, dev_type, data, measured_at)` with `measured_at` from the client device
  timestamp (`services/deviceData.service.js:856-859`). This is what the iOS app posts to
  (`/api/dev-data/devices/data`).
- **Secondary path — BROKEN:** `POST /api/bp/data` (`routes/deviceData.routes.js:25` →
  `createBPDataController` `controllers/devicedata.controller.js:104` → `createBPDataService`,
  active and exported at `services/deviceData.service.js:1871,2546`) runs
  **`INSERT INTO dev_data (dev_id, data)`** (`:1892-1894`) — **no `user_id`, no `measured_at`**, and
  it keys the device by `username`/`dev_type='BP'` rather than `dev_id`+`user_id`.

**Why this is worse than the measured_at gap:** a reading inserted via `/bp/data` has **NULL
`user_id`**. Every per-patient query filters `WHERE user_id = ?`, so such a row is **orphaned** —
invisible to the worklist, the overview, billing, alerts, AND this detector. It also has no
`measured_at`, so it buckets on receipt time. A reading through this path is effectively lost to the
whole platform while still "succeeding" (201) to the client.

**Needs its own investigation (NOT in scope here):**
- What, if anything, still posts to `/api/bp/data`? The current iOS app posts to `/devices/data`;
  `/bp/data` may be legacy/unused — but it is live and authenticated, so confirm no client (old app
  version, Android, a test harness) still uses it.
- If unused → remove the route + service. If used → fix it to set `user_id` and `measured_at` like
  the main path, or route it through `createDeviceDataService`.
- Audit prod for orphaned `dev_data` rows (`user_id IS NULL`) as evidence of this path's use.

Recorded so it isn't lost; it undercuts any measurement-time basis and is a silent data-loss path in
its own right.

---

## Notes / scope boundaries
- **Detection only.** This does not fix delivery (the iOS cookie-auth / disabled-history-sync
  issues under separate investigation). It makes silence *visible*; acting on a flag is a care/
  billing workflow.
- **No new scheduler required.** The signal is computed inline in the worklist request (and
  overview summary); it does not need a cron. A pushed alert (email/SMS to staff on a newly-silent
  patient) is a possible later addition but is out of scope — start with the pull surfaces staff
  already use, made impossible to miss via sort + roster count.
