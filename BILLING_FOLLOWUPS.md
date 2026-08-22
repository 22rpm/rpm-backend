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

## 11. Transmission-day count is bucketed in the SERVER SESSION timezone — DEPLOY GATE on the care-activity pair (latent off-by-one on a UTC-session prod)

**DEPLOY GATE — do NOT ship the RPM note billing (the care-activity pair) to prod
until prod's session tz is confirmed.** Until it's known, the transmission-day
count is NOT verified for prod, which means the 99445-vs-99454 device-supply
determination is not verified for prod either. This is a gate, not a follow-up.

Confirm it read-only on the box (the app inherits the server's default session tz
— `config/db.js` sets only the client-side `timezone:'Z'`, not the session tz — so
the CLI's `@@session.time_zone` equals what the Node app uses):

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
