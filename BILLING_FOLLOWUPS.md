# RPM billing / claim follow-ups

Tracked, not all built. The RPM note computes CPT eligibility and dates of
service, but a submittable claim needs more than this system currently models.

## 1. ICD-10 diagnosis code — REQUIRED on every claim, NOT modelled — OPEN
`patient_conditions` stores free-text names ("Hypertension"), not codes (I10).
Deferred by Ricky (he'll add it later). Until then **the note is NOT a
submittable claim on its own** — the biller adds the diagnosis code. The note now
says so explicitly (`compliance_checks`); do not let any UI imply otherwise.

**Schema to build (approved shape — code alongside name + lookup):**
- `patient_conditions`: add `icd10_code VARCHAR(10) NULL`. Keep `name` for
  display; `icd10_code` is the claim value and source of truth. One code per
  condition row (add rows for multiple diagnoses).
- Reference table `icd10_codes (code VARCHAR(10) PK, description VARCHAR(255),
  is_common_rpm TINYINT(1) DEFAULT 0)`, seeded with common RPM diagnoses (I10
  essential hypertension, E11.9 T2DM, I50.x heart failure, N18.x CKD, …). Powers
  a typeahead so staff pick a validated code instead of free-typing.
- Enrollment/edit form: condition entry becomes {name, code-from-lookup}.
- Note/claim: surface the code(s); once present, drop the "not a submittable
  claim" line from `compliance_checks`.

## 2. No-conflicting-codes check — OUTSIDE this system — OPEN (manual)
2026 claim guidance requires confirming no overlapping RTM or Home Health codes
were billed for the same period. We have no visibility into that. The note flags
it as a manual check (`compliance_checks`) rather than implying verification.

## 3. Place of Service — REQUIRED on claims, NOT modelled — OPEN
11 (Office) vs 02/10 (Telehealth).

**Schema to build (approved shape — org default + per-patient override, resolved
and frozen at signing):**
- `organizations.default_place_of_service VARCHAR(2) NULL` (the practice model,
  usually `"11"`).
- `patient_profiles.place_of_service VARCHAR(2) NULL` — per-patient override
  (e.g. a telehealth patient `"02"`/`"10"`).
- Constrained set `{11, 02, 10}` (Office / Telehealth-other / Telehealth-home).
- The RPM note resolves `patient override ?? org default` and **freezes the
  resolved value in the signed `rpm_notes` snapshot** (so the claim reflects what
  was true at signing). Effective value is per-claim; staff don't re-pick monthly.

## 4. Provider NPI — REQUIRED on claims, NOT stored anywhere — OPEN
Not on `users`. Must live somewhere and appear on the note.

**Schema to build (approved shape — individual profile + group NPI):**
- `user_provider_profiles (user_id INT PK/FK→users ON DELETE RESTRICT,
  npi VARCHAR(10), credential VARCHAR(20) NULL, taxonomy VARCHAR(20) NULL,
  license_number VARCHAR(50) NULL)` — the individual (type-1) NPI per clinician.
- `organizations.billing_npi VARCHAR(10) NULL` — the group (type-2) NPI when
  billed under the group.
- The note shows the billing provider's NPI (biller confirms individual vs
  group) and freezes it in the signed snapshot.
- **Also resolves the `rpm_notes.signed_credential` GAP:** `credential` here
  (MD/NP/RN) is the missing professional credential the signed note wants — once
  this table exists, signing populates `rpm_notes.signed_credential` from it
  instead of leaving it NULL.

## 5. 99470 interactive-communication requirement — PENDING biller
99457 confirmed requires a live interactive communication (test b). Whether 99470
does too is unconfirmed. Configured to REQUIRE it by default (conservative) in
`config/rpmBillingRules.js` (`interactiveRequirement.appliesTo` includes 99470).
Drop 99470 from that list if the biller says it's time-only.

## 6. Date of service on the note itself — PENDING biller (Rosemary)
The system computes a PER-CODE date of service ("date the threshold was met").
The note shows a single primary date; the biller confirms which code's date
should appear on the note. All per-code dates are in the endpoint's `billing`.
- **Concrete instance:** for patient 48, Aug 2026, the note renders 99445 at DOS
  `2026-08-02` (the date the 2nd transmission day was reached). If any prior guidance
  or the biller expects a month-end DOS instead, these disagree — resolve which the
  note should show before it goes to a provider/claim.

## 7. Reimbursement display — deliberately OFF
National-average amounts are in config (`reimbursement`, `display:false`). §3.9
keeps revenue separate from eligibility — nothing surfaces estimated revenue yet.
Vary by locality; confirm local values before ever displaying.

## 9. patient_calls.outcome — server-side NULL gap — OPEN (scoped out of the form fix)
The call-logging FORM now requires an outcome (a `<select required>`), but the
SERVER still accepts NULL: `controllers/callDoc.controller.js` validates
`outcomeVal !== null && !CALL_OUTCOMES.includes(outcomeVal)` (NULL passes), the
CHECK constraint permits NULL, and the column is `DEFAULT NULL`. So "must pick
one" holds only in the browser — any other client (or a future mobile app) can
still write NULL, and a NULL outcome means 99457 test (b) reads "not determined"
and does not bill.

**What closing it involves:**
- **Decide the rule:** is `outcome` required for every call, or only when the
  call carries billable time / is outbound? A pure `NOT NULL` is simplest but
  also forces an outcome on rows where it may not apply.
- **Existing NULL rows:** production has NONE today (patient_calls doesn't exist
  on prod yet — see §8). On `rpm_db_v1` the test rows are NULL by design (the
  migration nulled the ambiguous "reached" values and preserved the originals in
  `note`). A `NOT NULL` migration would need those backfilled or superseded first
  — they cannot be invented (that's exactly why they were nulled). Because this
  is test data and prod is empty, a `NOT NULL` (or a CHECK requiring non-NULL for
  new rows) could ship cleanly IF done before real prod call data accrues.
- **Also add server validation** (`callDoc.controller.js`) rejecting NULL for the
  chosen rule, so the API enforces what the form does. DB constraint over app
  validation where possible (as elsewhere).
- Until closed, the note's "NOT DETERMINED — outcome not recorded" wording is the
  safeguard: a NULL is surfaced as missing evidence, never asserted as a failure.

## 10. Quantix note billing-reference table + rate card — for Rosemary (not code)
- The "Billing Codes Reference" table printed on the note (faithful to the Quantix
  template) lists **99454** for device supply and **omits 99445 and 99470** — so
  the note can show a computed 99445 above a table that doesn't contain it. The
  template predates the 2026 codes. Ask whether Quantix has an updated version
  before the note goes to a provider who reads the table as authoritative.
- The CPT rate card lists 99454 as "16 days" where the rule is 16 **or more**, and
  shows 99445 and 99454 at the same $52.11. Confirm.

## 8. Outcome migration (20260823120000) runs against an EMPTY table on prod — no dry-run needed
Checked on prod (2026-08-20): `patient_calls` does NOT exist there (ERROR 1146)
and prod is on 32 migrations — the entire care-activity set has never been
deployed. So when the care-activity migrations run on prod, `patient_calls` is
created fresh and the outcome-constraint migration runs against an EMPTY table:
there is no legacy free text to map, and the keyword mapping / NULL-preserve path
is never exercised on real data. (It WAS exercised on `rpm_db_v1`, which has test
rows — see the commit for that migration.) Nobody should worry about a prod
free-text backfill: there isn't one. Real outcomes on prod will be constrained
from day one because the CHECK constraint ships with the table.

## 11. Transmission-day count is bucketed in the SERVER SESSION timezone — DEPLOY GATE on the care-activity pair — CONFIRMED prod = UTC, dev = Pacific

**DEPLOY GATE — do NOT ship the RPM note billing (the care-activity pair) to prod
until the fix below lands.** CONFIRMED (2026-08-22, run on the prod box):

```
session_tz SYSTEM | global_tz SYSTEM | system_tz UTC
now_local 2026-08-22 22:46:20 | now_utc 2026-08-22 22:46:20   (identical -> UTC)
```

Prod's session is **UTC**; dev (`rpm_db_v1`) is **Pacific (PDT/PST)**. So prod
buckets transmission days by **UTC calendar day** while dev buckets by **Pacific
day** — the two environments disagree. **Every transmission-day count verified
locally was verified under different bucketing than prod will use**, so the
99445-vs-99454 device-supply determination is NOT verified for prod. Any reading
after 5 PM Pacific counts on the next calendar day on prod, which can cross the
99445 (>=2) / 99454 (>=16) threshold and shift month membership at the boundary.
This is the confirmed bad case, not a latent risk.

**Design + full timestamp inventory: [TZ_FIX_DESIGN.md](TZ_FIX_DESIGN.md).** The
fix is several coordinated workstreams (session pin + `CONVERT_TZ` bucketing +
`organizations.timezone` + app-wide display conversion + signed-note ledger
handling) that must ship ATOMICALLY with the care-activity first prod deploy —
notably because signing the first prod `rpm_note` freezes the session tz (changing
it afterward invalidates the frozen `content_hash`). Not a later follow-up.

The confirming command (read-only; the app inherits the server default session tz
— `config/db.js` sets only the client-side `timezone:'Z'`, not the session tz):

```
mysql -u root -proot -h 127.0.0.1 -e "SELECT @@session.time_zone AS session_tz, @@global.time_zone AS global_tz, @@system_time_zone AS system_tz, NOW() AS now_local, UTC_TIMESTAMP() AS now_utc;"
```

Interpreting the result:
- **`NOW()` is 7–8h behind `UTC_TIMESTAMP()` (system_tz America/Los_Angeles / PDT /
  PST)** → prod buckets by Pacific day like local; the counts we tested hold; #11
  stays latent (still a portability risk, not currently biting).
- **`NOW()` == `UTC_TIMESTAMP()` (session effectively UTC)** → prod buckets by UTC
  day; any reading after 5 PM Pacific rolls to the next day, so the counts we
  verified do NOT hold on prod and the fix below must land before shipping.
- **Any OTHER offset (e.g. EST/EDT)** → neither Pacific nor UTC; still mis-buckets
  vs the clinic's day. Only "server tz == the clinic's intended tz" is safe by
  accident; the robust fix removes the dependence entirely.

The device-supply codes 99445 (≥2 distinct transmission days) and 99454 (≥16)
are driven by the transmission-day count in `rpmNote.service.getRpmNote`:

```sql
SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d') AS d
  FROM dev_data
 WHERE user_id = ? AND created_at >= ? AND created_at < ?   -- start / next of month
```

Both the window bounds and `DATE_FORMAT(created_at)` are evaluated **server-side in
the MySQL session timezone**. On `rpm_db_v1` that session is `SYSTEM = PDT`
(evidence: `NOW()=15:28` vs `UTC_TIMESTAMP()=22:28`), so the query buckets by
**Pacific calendar day**. Filter and bucket use the same tz, so the count is
internally consistent, and it matches the vitals display (which shows the same
Pacific wall-clock — see the tz work item in #12). Within this environment the
count is correct, not accidental.

**The defect:** the bucketing tz is the *deployment's* session tz, which is
**unverified on prod** (SESSION_HANDOFF: prod tz not checked). `dev_data.created_at`
stores a true UTC instant; on a **UTC-session prod** the same query buckets by
**UTC calendar day**, so any reading taken **after 5 PM Pacific** (≥ 00:00 UTC)
rolls to the next calendar day. That can:
- change the DISTINCT-day count and cross a billing threshold (the 2nd day for
  99445, the 16th for 99454), and
- move a boundary reading into/out of the month window (`created_at >= start`).

**Evidence against the documented fixture (patient 48, Aug 2026):** count = **5**
in BOTH framings — distinct PDT days = 5, distinct true-UTC days = 5, with **0**
readings in the danger window (reading hours present: 07, 08, 13, 14 PDT). So
patient 48's `5 → 99445` is correct AND robust; it does NOT exercise the bug only
because none of its readings sit after 5 PM Pacific. A patient who transmits in
the evening (Pacific) would count differently on a UTC-session prod than on this
PDT box.

**Resolution:** the count must bucket by a FIXED, intended clinic timezone
regardless of the server session — i.e. normalize `created_at` to that tz in the
query (`CONVERT_TZ`), or fix the connection tz handling globally (#12) and derive
days from true instants in a known tz. Do NOT ship the note billing to prod
before the prod session tz is confirmed and this is pinned; on a UTC prod it is a
silent off-by-one on device-supply codes.

**Empirical (2026-08-27, real prod data on `rpm_db_scratch`, restored from the
26th backup — 210 readings, 13 real patients): the defect is real but has NEVER
FIRED in production.** Zero prod readings straddle the Pacific/UTC day boundary —
`COUNT(*) WHERE DATE_FORMAT(created_at) <> DATE_FORMAT(CONVERT_TZ(created_at,
'+00:00','America/Los_Angeles'))` returned **0**. Every real patient measures in
the morning (Pacific), well clear of the ≥17:00 PT window where UTC bucketing
rolls a reading to the next day. So UTC and Pacific bucketing currently produce
the SAME distinct-day count for every prod patient, and no transmission day has
ever been miscounted. This is **latent, not benign**: a single patient taking a
reading after ~5 PM Pacific (e.g. a before-bed check) trips it, and near the 16th
day it flips 99445↔99454. It's a reason the fix still matters — the exposure is
one patient's habit away — NOT a reason to relax the deploy gate. (The
patient-48 fixture that exercises the boundary lives only in local `rpm_db_v1`,
not prod; to prove a code flip pre-deploy, seed a straddling reading — see
TZ_FIX_DESIGN.md rehearsal TODO.)

**Concrete wrong-number example — the fix (PR3) is itself pin-dependent (2026-08-27).**
The clinic-tz bucketing `CONVERT_TZ(created_at,'+00:00',tz)` reads the TIMESTAMP
column in the SESSION tz *before* converting, so it is correct ONLY on a UTC
session. Running the exact device-supply day-count for patient 48 (Aug 2026):
**UTC session → 9 distinct days (the truth); Pacific session → 10** — a phantom
extra day from the double-shift. On prod (session already UTC) this is right; but
if the `config/db.js` pin ever fails or a query runs on an unpinned connection,
the determination silently returns 10 where the truth is 9 — a wrong billed
count nobody would notice. This is exactly the class of failure the guard now
prevents: `billingTz.assertClinicTz` asserts BOTH the named-tz tables are loaded
AND `TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) == 0`, throwing
`DB_SESSION_NOT_UTC` (500) rather than billing. Exercised through `getRpmNote`:
with the pin forced to `-07:00`, the determination throws instead of returning a
count. Corollary: PR3 must never ship without PR2's pin, and the note's
period start/end are safe (pure JS calendar labels) but DOS and call-log dates
are pin-dependent.

## 12. Connection timezone mismatch (`timezone:'Z'` vs server session PDT) — tz-consistency work item — OPEN
Root cause behind #11 and the vitals graph/table timestamp behavior. `config/db.js`
sets the mysql2 pool `timezone:'Z'` (driver assumes UTC), while the MySQL server
session is `SYSTEM = PDT`. `dev_data.created_at` (TIMESTAMP) stores the correct UTC
instant, but on readback the server returns the Pacific wall-clock string and the
driver tags it UTC — so the app's JS `Date` is the **Pacific wall-clock mislabeled
as UTC**, 7h off the true instant. Proven with an insert-read-delete probe on a
`DEFAULT CURRENT_TIMESTAMP` row: real UTC `22:28`, app-received Date `15:28Z`
(−7.00h). Real ingest ([deviceData.service.js:819](services/deviceData.service.js:819))
writes no `created_at`, so it relies on that DEFAULT and lands the same way as the
seeded rows — they agree.

Consequences:
- The vitals table/chart display the right Pacific wall-clock **by accident** —
  two errors cancel (correct stored instant + driver mislabel, then displayed
  without conversion via `getUTC*`). Converting UTC→Pacific would DOUBLE-shift and
  be wrong (that trap was avoided; display left as `getUTC*` digits).
- **The accidental correctness depends on the local server session being PDT and
  will NOT port if prod's session is UTC** — there the same `getUTC*` display shows
  UTC, and the #11 day-count buckets by UTC. The offset is **7h in summer (PDT),
  8h in winter (PST)**, so date math near midnight can also flip by season.

Proper fix (data layer, not display): make the driver and server session tz
consistent (e.g. force `time_zone='+00:00'` on connect AND keep `timezone:'Z'`) so
JS `Date` equals the true instant, then convert UTC→intended-clinic-tz at display.
High blast radius — moves every timestamp consumer by the offset — so it requires
its own change, a **prod tz audit**, and a check of what prod's existing rows
actually store before touching anything. This is SESSION_HANDOFF's "establish what
each env stores before fixing." Do not fold it into a feature branch.

## 13. The note buckets transmission days in Pacific but time/calls in UTC — same document — OPEN (pre-existing, NOT introduced by the tz fix)
Independent finding surfaced by the tz inventory (TZ_FIX_DESIGN.md). On the RPM note
TODAY, two sections bucket "day" in DIFFERENT timezones on the same document:
- **Transmission days** come from `dev_data.created_at` — a **TIMESTAMP** column, so
  `DATE_FORMAT(created_at)` buckets in the server SESSION tz (Pacific on dev).
- **Time entries and calls** come from `time_entries.started_at` /
  `patient_calls.started_at` — **DATETIME** columns, session-immune, holding a
  literal UTC wall-clock (the writer serializes `new Date()` to a UTC string via the
  pool's `timezone:'Z'`). So `DATE_FORMAT(started_at)` buckets in UTC.

So the device-supply "days" (99445/99454) and the management "days" (time /
communication) on one note can refer to different calendar days for the same
events. **If anyone has been reconciling note figures by hand against raw data,
this mixed-frame bucketing explains discrepancies they may have seen** — it is not
a data-entry error. This is a pre-existing inconsistency, present before any tz
work; the tz fix RESOLVES it (post-pin every column reads a UTC instant, so one
`CONVERT_TZ('+00:00', clinic_tz)` buckets the whole note in one clinic-day frame).
Recorded on its own so the discrepancy is attributable and closed by the same fix.

## 13. Transmission-day count keys on `created_at` = DELIVERY time (iOS outbox) — OPEN
#11 assumes `created_at` ≈ the reading instant and only worries about which calendar
day it buckets to (tz). The iOS durable outbox (rpm-ios-app `fix/bp-auto-reconnect`)
breaks that assumption: a reading is written to disk at capture but POSTed on the
next foreground drain, so `created_at` is the **delivery** instant. An offline
reading delivered the next day lands a transmission day on the WRONG day and can
cross the 99445 (≥2) / 99454 (≥16) threshold, or move across the month-window
boundary.

**Not fixed by #11's resolution:** normalizing `created_at` to the clinic tz still
buckets by delivery day. The count must key on `data.timestamp` (the captured UTC
instant the client sends and the backend stores verbatim inside `data`), converted
to the clinic tz:
```sql
SELECT DISTINCT DATE_FORMAT(
  CONVERT_TZ(JSON_UNQUOTE(JSON_EXTRACT(data,'$.timestamp')), '+00:00', @clinic_tz),
  '%Y-%m-%d') AS d
  FROM dev_data
 WHERE user_id = ? AND <window on data.timestamp, same clinic frame>
```
The window bounds (`>= start`, `< next`) must move to `data.timestamp` too. Legacy
rows without `data.timestamp` fall back to `created_at`.

This is a stronger argument for `data.timestamp` everywhere than the display bug:
it is billing accuracy + compliance (a day billed is a day the reading was actually
taken), not cosmetics. Supersedes the `created_at` approach in #11's resolution.

### #13 — audit: the other reading-time-meant `created_at` sites (server-side)
The "created_at is really delivery time" defect applies wherever a query
windows/buckets READINGS by `created_at`:
- `rpmNote.service.js:125` — transmission-day DISTINCT count. **Affected** (above).
- `rpmNote.service.js:149` — the note's **BP summary** (MIN/MAX/AVG of sys/dia/bpm
  AND the reading COUNT `n`) is `WHERE created_at >= ? AND < ?`. **Affected**: the
  numbers on the signed note, and the count, shift with delivery timing — an
  offline reading delivered next month drops out of this month's summary (or lands
  in the wrong month).
- `deviceData.service.js:2040/2049` — the "last N days" readings window feeding the
  vitals month filter and the mobile history list. **Affected** (window by
  delivery date).
- Worklist (`patientWorklist.service.js`) — does NOT window readings by
  `created_at` (uses `started_at` / note-creation time). **Not affected.**
- Clinical notes / time_entries / patient_calls — use `started_at` or the note's
  own `created_at`; those genuinely mean creation time. **Not affected.**
All affected sites take the same fix: bucket/window on `data.timestamp`.

### #13 — the outbox INTRODUCED this; it is NOT pre-existing
Before the iOS durable outbox, the client POSTed the reading immediately, so
`created_at` was within SECONDS of the measurement — keying billing on it was
approximately right, and #11 correctly treated the only risk as tz bucketing near
midnight. The outbox (a fix for LOST readings) made delivery time arbitrary: a
reading captured offline is delivered hours or a day later, so `created_at` can be
a full day off the measurement. Do NOT read #13 as a latent pre-existing issue and
deprioritize it — a fix for lost readings created a billing-accuracy bug.

### #13 — deploy coupling: outbox + day-count are ONE release
Because the outbox is what makes `created_at` diverge from reading time, the outbox
CANNOT ship to patients before the day-count (and BP-summary, and readings-window)
move to `data.timestamp`. Shipping the outbox first would silently mis-bill
transmission days for every offline reading. One deploy, not two:
- iOS: `fix/bp-auto-reconnect` (outbox).
- backend: the `data.timestamp` bucketing/windowing change (this item + #11).
Gate the outbox app release on the backend change being live. (Mirrored in
TZ_FIX_DESIGN.md.)

### #14 — note's Billing Codes Reference table now DIFFERS from the Quantix template (Rosemary)
The RPM note's "Billing Codes Reference" table was copied verbatim from the Quantix
template we were given, which lists only 99453 / 99454 / 99457 / 99458 — it predates
the 2026 codes. But the determination (`rpmNote.service`) computes 99445 (device
supply, 2–15 transmission days) and 99470 (management, 10–19 min clinical-staff
time) as well, so a biller could see a code on the note that wasn't in the
reference table beside it.

Fixed on the note (dashboard `RpmNote.jsx`), so the table stops being wrong while
we wait:
- Added **99445** — Device Supply & Transmission, 2–15 days in a 30-day period.
- Added **99470** — Management, 10–19 minutes of clinical staff time.
- Corrected **99454** — was "Per 30-day period" (no threshold); now "16 or more
  days in a 30-day period", which is what distinguishes it from 99445.
- Also reordered the billing section so the computed determination ("Codes
  supported this month") leads and the reference table is secondary below it.

**Open for Rosemary:** confirm whether Quantix has an updated template that
includes the 2026 codes (99445/99470) and the corrected 99454 wording. If so, align
to theirs; until then the note's table is intentionally ahead of the Quantix copy.
This is the same Quantix-template thread as the attestation wording
(ATTESTATION_REVIEW_FOR_ROSEMARY.md) — the template we hold is stale.

## 14. Manifestation ICD-10 codes must never be first-listed — guard belongs at the (not-yet-built) problem-list → claim wiring
Some diagnoses can only ever be *secondary* on a claim — "manifestation" codes that
carry a "code first the underlying condition" rule and are invalid as the primary/
first-listed diagnosis. Two are in play for the conditions shortlist
(`config/icd10Conditions.js`), both HELD pending Cleo:
- **I32** — Uremic pericarditis (pericarditis in diseases classified elsewhere);
  code first the CKD/uremia.
- **F02.80** — Dementia in other diseases classified elsewhere; code first the
  underlying physiological condition. (Not the same as F03.90 "unspecified dementia,"
  which IS first-listable and is on the list.)
Also held with them: **L29.8** (uremic/CKD-associated pruritus — needs the N18.x CKD
stage alongside). None of I32 / L29.8 / F02.80 are added yet.

**There is no primary-diagnosis selection anywhere today, so nothing can mis-first-list
these right now.** Verified across note generation and the billing determination:
- `services/rpmNote.service.js:529` — the note explicitly carries NO ICD-10: a hard-
  coded compliance check says a diagnosis "is required on the claim — the biller must
  add it. This note is NOT a submittable claim on its own." `getRpmNote` never reads
  `patient_conditions` / `icd10_code`.
- `services/rpmNote.service.js:437` — the note's "PRIMARY" (`primaryDos`) is the
  primary billable **CPT** code's date of service, not a diagnosis.
- `services/billingSummary.service.js` — the roster/determination loops `getRpmNote`
  per patient, so it inherits the same CPT-only, no-diagnosis behavior.
- dashboard `src/components/rpmNote/RpmNote.jsx:471` — the only "primary" is the
  `rn-computed-primary` CSS class on the CPT determination box; no diagnosis picker.

**Where the guard goes (future).** The shortlist header (`config/icd10Conditions.js`)
anticipates wiring `patient_conditions.icd10_code` into the note/claim "when the
billers confirm the wiring." Whoever builds that is who must exclude manifestation
codes from primary selection. Make the constraint live in the data, not in the
selector's head:
- Add a **`firstListable: false`** flag to the manifestation entries (I32, F02.80,
  and any future manifestation code). NOT built now — there is no consumer today, so
  it would be dead infrastructure; add it together with the wiring.
- The future primary-picker filters on `firstListable !== false` when choosing the
  first-listed diagnosis; manifestation codes remain pickable as *secondary* problem-
  list entries. Design the manifestation exclusion and the primary-selection rule in
  the same change — not bolted on after.

## 15. Test/non-patient devices write into `dev_data` and can inflate billing day-counts — DESIGN NOTE, don't build yet
The 99454/99445 transmission-day count is `SELECT DISTINCT <clinic-tz day of created_at>
FROM dev_data WHERE user_id = ? AND <month window>` (`services/rpmNote.service.js:139-146`,
surfaced via `getRpmNote` → `billingSummary.service.js:102`). It counts **any device
type**, and **test devices land in the same `dev_data` table as real readings** — e.g.
`review_cuff_001` put 6 days into August; `bp_device_001` (iOS fallback) and `'unknown'`
(Android fallback) are shared sentinel `dev_id`s used across accounts.

**Today it's harmless because there is one real patient** (device `7C46598B`) and the
noise is obvious by eye. **At twenty patients it won't be** — a test session or a shared
fallback `dev_id` attributed to a real patient's `user_id` would silently add billable
transmission days, and nobody would catch it in a roster.

**We need a way to exclude non-patient devices from billing day-counts before the roster
grows.** Options (pick at build time, not now):
1. **A device registry flag.** Give `devices` (or `patient_devices`) an `is_billable` /
   `is_test` boolean; the day-count joins it and counts only real, patient-registered
   devices. Cleanest; needs devices to be reliably registered per patient.
2. **Count only registered patient devices.** Restrict the count to `dev_id`s linked to
   that patient in a devices table, so unlinked/test/sentinel ids never count.
3. **Exclude a sentinel denylist** (`review_cuff_001`, `bp_device_001`, `'unknown'`, …).
   Brittle stopgap — every new test id must be remembered; use only as a short-term guard.
Recommended direction: (1) or (2) — attribute billing to *registered patient devices*,
not to raw `dev_data` rows. **Design note only — do not build until the roster is about to
grow.**

## 16. 99454 day-count buckets on `created_at` (server receipt), not measurement time — UNDERCOUNTS (conservative). Pending Cleo.
**Bug.** The transmission-day count for 99454/99445 buckets on `dev_data.created_at`
(`services/rpmNote.service.js:140`), which is stamped by the DB at insert
(`services/devData.service.js:7`; migration `20250819125116…:6` `timestamps(true,true)`) —
i.e. **when the server received the row, not when the reading was taken.** The iOS payload
carries a phone-capture time (`data.timestamp`, `BloodPressure.js:494`) and `data.date`/
`data.time`, but the count ignores them; the device's own `measuring_timestamp` (parsed at
`ios/VTMDeviceManager/ViatomDeviceManager.m:584`) is never even sent. A batch delivered late
(durable-outbox flush, reconnect) lands on ONE `created_at` instant — the Aug 23 `00:04:05`
identical-timestamp cluster is that fingerprint.

**Direction of error: it UNDERCOUNTS.** Collapsing several days onto one receipt instant can
only REDUCE the distinct-day total, never inflate it. So any effect on past claims is
**underbilling — conservative, not overstated.** There is **no overbilling / compliance
exposure** here; the worst case is a month that should have qualified didn't, or a month
billed fewer days than it earned.

**Magnitude (recount before deciding anything).** For the one real patient, June and July both
cleared the 16-day threshold on `created_at` (17 and 24). Recount using the embedded phone
timestamp (`data->>'$.timestamp'`) instead of `created_at` (SQL in the session / DEVICE_HISTORY_DESIGN
finding A). Since a truer count can only be **equal or higher**, if June/July stay ≥16 nothing
about those claims changes and the fix is **forward-only** for them. (August = 9 is separately
confounded by the cert outage — see INCIDENT_2026-09-03; not a clean data point.)
RECOUNT RESULT: _pending — June ___ , July ___ (days by embedded ts)._

**Fix (claims-affecting — Cleo decides, do NOT change silently).** Carry the measurement time
end to end: send the device `measuring_timestamp` in the payload (for live, use the value at
m:584 instead of the phone clock; for history backfill it's the record's own timestamp), and
bucket the count on that, keeping `created_at` as the receipt/audit trail. Whether past months
are recomputed is Cleo's call. **No billing code changed for this entry.** The device-history
feature (DEVICE_HISTORY_DESIGN) must post backfilled readings against the measurement time, not
`created_at`, or it repeats this bug.

### Draft flag for Cleo (billing)
> We found a dating bug in the remote-monitoring day-count. Readings are currently counted on
> the day our **server received** them, not the day the patient **took** them. When a phone
> syncs a batch of readings at once (e.g. after being offline), they all land on one day, so
> the monthly transmission-day count can come out **lower** than it truly was. Important: this
> only ever **undercounts** — it can't overstate a month — so any past effect is us
> **underbilling**, never overbilling. No compliance concern.
> We rechecked June and July for [patient]: both cleared the 16-day threshold on the old method
> (17 and 24), and the corrected count is [ ___ / ___ ] — [so those claims are unchanged / so …].
> We're fixing it going forward so the count uses the reading's real measurement time.
> **One question:** do you want past months recomputed on the corrected time, or is
> forward-only fine given the error was in the conservative direction?
