# Timezone-consistency fix — design + timestamp inventory

Referenced by BILLING_FOLLOWUPS #11 (deploy gate) and #12 (root cause). **Design
only — no code here.** The inventory below is what decides scope: this is not one
change, it is several coordinated workstreams that must ship together.

## Confirmed constraints (evidence)
- **prod session = UTC, dev (`rpm_db_v1`) session = Pacific (PDT/PST).** Prod:
  `system_tz UTC`, `NOW()==UTC_TIMESTAMP()`. Dev: `NOW()` 7h behind `UTC_TIMESTAMP()`.
- **MySQL named-tz tables are NOT loaded on dev** (`CONVERT_TZ(NOW(),'UTC',
  'America/Los_Angeles')` → NULL; `mysql.time_zone_name` = 0 rows). Assume the same
  on prod. Numeric offsets work but are DST-blind (offset is 7h summer / 8h winter).
- **No clinic timezone is stored anywhere** — `organizations` has no tz column.
- `config/db.js` sets the mysql2 pool `timezone:'Z'` (client assumes UTC) but does
  NOT set the server session tz; the app inherits the server default (see #12).

## Chosen approach (approved)
**(a) Pin the connection session to UTC AND bucket by an explicit clinic tz with
`CONVERT_TZ`.** The deciding factor is the **driver mismatch**, not the
single-clinic limit: `new Date()` written into a TIMESTAMP column currently
serializes wrong, and that same mismatch is what makes the display correct *by
accident*. Fixing bucketing while leaving the mismatch leaves the accident
load-bearing. Pinning to UTC (i) makes dev and prod share one instant baseline,
(ii) makes go-forward JS-Date writes correct, and (iii) makes reads true instants
so display can convert honestly. `CONVERT_TZ('+00:00', clinic_tz)` then defines
"day" as the clinic's day on both envs.

**(b) Add `organizations.timezone`** (nullable, `NULL` → app-level `CLINIC_TZ`
default `America/Los_Angeles`), read per patient's org in the bucketing helper.
One clinic today, but org-scoping and the half-built super-admin multi-clinic flow
make a later retrofit into billing queries worse than a nullable column nobody
uses yet.

## Key realization: pinning is a NO-OP on prod
Prod's session is already UTC, so `SET time_zone='+00:00'` changes **nothing on
prod** — prod data and behavior are untouched. Pinning only moves **dev** (PDT→UTC)
onto prod's baseline so there is one code path. The billing fix *for prod* is the
`CONVERT_TZ` bucketing (prod currently buckets by UTC day; it must bucket by clinic
day). Consequence: prod stored data is safe; the data-migration questions below are
almost entirely about **dev test data**.

## TIMESTAMP vs DATETIME — they react differently

| column | type | on pin (dev PDT→UTC) |
|---|---|---|
| `dev_data.created_at` | TIMESTAMP | readback shifts PDT→UTC (stored instant is correct) |
| `clinical_notes.created_at` | TIMESTAMP | same |
| `alerts.created_at`, `alert_assignments.*`, `audit_log.created_at` | TIMESTAMP | same |
| `patient_consents.created_at`, `rpm_notes.created_at` | TIMESTAMP | same |
| **`rpm_notes.signed_at`** | TIMESTAMP | **shifts — breaks the frozen hash (see Ledger)** |
| `time_entries.started_at` / `ended_at` | **DATETIME** | session-immune; stored literal |
| `patient_calls.started_at` | **DATETIME** | session-immune; stored literal |

The note endpoint already **mixes frames**: transmission days come from
`dev_data.created_at` (TIMESTAMP → session tz) while time and calls come from
`time_entries.started_at` / `patient_calls.started_at` (DATETIME → literal UTC,
because the writer serializes `new Date()` to a UTC string via `timezone:'Z'`).
So today, on dev, transmission days bucket in **Pacific** and time/calls in **UTC**
— the note is internally inconsistent about "what day" before any fix.

Post-pin, TIMESTAMP columns read as true UTC and DATETIME columns already hold UTC,
so **all of them present UTC instants** → a single uniform `CONVERT_TZ('+00:00',
clinic_tz)` buckets everything by the clinic day. That uniformity is the payoff of
pinning.

## Timestamp inventory

### 1. Write side — `new Date()` / JS Date into a TIMESTAMP column
These serialize wrong under a non-UTC session (the write bug). Pinning makes them
correct **going forward**; existing dev rows keep the offset error (test data).
- `rpmNoteSign.service.js:149` — `signedAt = new Date()` → `rpm_notes.signed_at` **(hash-critical)**.
- `deviceData.service.js:2295` — `new Date()` → `alerts.created_at`.
- `otp.service.js:4-5` — `createdAt` / `expiresAt` → `otp_tokens.created_at/expires_at`.
- `mfa.service.js:15` — `expiresAt` → `user_devices.mfa_expires_at`.
- `org.service.js` (×several) — `created_at`/`updated_at` → `organizations`.
- `messageService.js:11-12` — `created_at`/`updated_at` → `messages`.
- DATETIME writers (`timeEntry.service` `startedAt`/`endedAt`, patient_calls) serialize
  to a UTC string and store it literally — already UTC, unaffected by pinning.
- String/DEFAULT writers (`dev_data.created_at` via `DEFAULT CURRENT_TIMESTAMP`)
  store the correct instant already.

### 2. Bucketing / month-window sites (must all share one helper)
- **Note** `rpmNote.service.js`: `monthWindow` + transmission days (`DISTINCT
  DATE_FORMAT(created_at)` :125/127), BP/HR count (:149), time_entries (:158/163),
  patient_calls (:197/201), clinical_notes (:211/216).
- **Worklist** `patientWorklist.service.js`: its OWN `monthWindow` (:15) + time_entries
  range (:104). ← duplicate helper.
- **Vitals filter** `doctor.service.js` `getPatientDeviceDataService`: `DATE(created_at)
  BETWEEN/=` (:412/424/439), and a JS-computed days window (`new Date()` +
  `toISOString().split('T')[0]` at :417) that mixes a UTC date bound with session-tz
  `DATE()` bucketing.
- **Frontend** `VitalSigns.jsx` `monthWindow`/`buildMonthOptions` build the from/to
  strings the vitals filter uses; the worklist has its own month selector.
- Design: **one server-side `windowFor(month, tz) → { startUtc, nextUtc, dayExpr }`**
  replacing both `monthWindow` copies and the vitals filter; the frontend stops
  computing windows and sends a month id.

### 3. Hash / tamper-detection — the signed-note ledger
`rpmNoteSign.verifyRow` rebuilds the hashed record from the stored row **including
`toSecondIso(row.signed_at)`** (:282), and `signed_at` is TIMESTAMP. The hash was
computed at sign time over `signedAtIso` (:151/194). Today verify passes because
write and read distort symmetrically under one session tz, so the round-trip
reproduces `signedAtIso`. **Pinning the session breaks that symmetry: a note signed
under the OLD session tz will re-read `signed_at` to a different ISO under UTC →
`sha256 !== content_hash` → verify FAILS → a tamper-detection false positive on a
signed billing document.**

Mitigating facts + plan:
- **rpm_notes does not exist on prod** (care-activity never deployed; BILLING #8), so
  there are ZERO prod signed notes. Only dev test notes are affected.
- Therefore: **ship the tz fix in the SAME deploy as the care-activity pair, before
  any prod note is signed.** Then every prod note is created under UTC from day one
  and always hash-verifies. Corollary — **once notes exist on prod the session tz is
  effectively frozen**; changing it later would invalidate every prior hash. This is
  itself a reason the tz fix is a hard pre-req of the care-activity deploy, not a
  later follow-up.
- Dev: truncate the test `rpm_notes` around the change (or accept the false
  positives on those rows). Document it so nobody reads a broken dev verify as tamper.
- **Hardening (recommend, same change):** store the exact `signedAtIso` string used
  in the hash as an immutable `TEXT`/`CHAR` column and hash over *that*, so the
  TIMESTAMP column's tz representation can never affect verification again. Makes the
  ledger tz-representation-independent for good.

### 4. Compare side — stored timestamp vs JS `new Date()`
- `mfa.service.js:37` — `record.mfa_expires_at < new Date()` (device trust 60-day +
  OTP). Pinning FIXES the go-forward comparison; rows written pre-change and checked
  post-change drift by the offset once (OTPs are 5-min → self-heal; a 60-day trusted
  device drifts ≤8h — cosmetic).
- `doctor.service.js:417` — days-window `new Date().toISOString()` vs `DATE(created_at)`
  (a UTC bound compared to session-tz bucketing). Pinning + the shared helper makes
  them agree.
- `careValidation.js:21`, `patientEdit.controller.js:22` — future-date checks on
  parsed INPUT (`date_of_birth` etc.), not DB reads — tz-insensitive, no action.

### 5. Display side — app-wide, not just vitals
Pinning makes the API serialize **true UTC** for every timestamp (currently it emits
Pacific-mislabeled-UTC on dev). So EVERY timestamp surface shifts by the offset and
must convert UTC→clinic tz through one shared formatter:
- Vitals table / chart / tiles (already `getUTC*` = Pacific-by-accident — must become
  real conversions), Alerts (`created_at`), Time Log (`started_at`), the RPM note UI
  and its read-only history, the Worklist (last reading, month time totals, dates),
  **PatientModal** (its own duplicate vitals view), audit displays, and the signed-note
  display (`signed_at`). This is the "one sentence carrying the highest-risk part":
  it is an app-wide display change, not a vitals tweak.

## One change or several?
**Several coordinated workstreams that must land atomically with the care-activity
first prod deploy:**
1. **Infra/data:** pin session UTC in the pool; add `organizations.timezone`; the
   shared `windowFor`/bucket helper; `CONVERT_TZ` in note + worklist + vitals; load
   the MySQL tz tables on prod.
2. **Ledger:** sequence before the first prod note; wipe/accept dev test notes;
   harden the hash to store the signed ISO string.
3. **Display:** app-wide UTC→clinic-tz formatter across every surface in #5.
4. **Writes/compares:** rely on pinning to fix go-forward; audit the pre-change dev
   rows that straddle (trust devices, OTPs) — mostly self-healing.
They interact (display needs true instants; the hash needs the tz frozen; billing
needs clinic bucketing), so they cannot be shipped piecemeal.

## Deploy prerequisites / runbook
- **Load tz tables on prod** and verify: `mysql_tzinfo_to_sql /usr/share/zoneinfo |
  mysql -u root mysql`, then `SELECT CONVERT_TZ(UTC_TIMESTAMP(),'UTC',
  'America/Los_Angeles')` is non-NULL. Hard gate — without it `CONVERT_TZ` returns
  NULL and buckets silently collapse.
- Ship items 1–4 together, in the care-activity pair's FIRST prod deploy, before any
  note is signed.
- Dev: reset test `rpm_notes` (their old-tz hashes will not verify post-pin).

## Re-verification after
- Re-confirm **patient 48 Aug 2026 = 5 → 99445** under clinic-tz bucketing (still 5,
  now verified under prod-equivalent logic, not dev's accident).
- **Boundary fixture that flips the count:** two readings on the same Pacific day
  with one after 5 PM Pacific — e.g. `09:00 PT` (16:00 UTC Aug 4) and `20:00 PT`
  (03:00 UTC Aug 5). UTC bucketing → 2 days (99445 qualifies); Pacific → 1 day (does
  not). Prove the note returns the Pacific answer after the fix, the UTC answer
  before — the threshold actually exercised.
- **Cross-consistency:** for one patient/month, note-count == vitals-table days ==
  worklist window.
- **Ledger:** sign a note post-change, confirm it hash-verifies; confirm a dev
  pre-change note is handled (wiped), not surfaced as tamper.
- **Prod pre-deploy:** the tz-tables check above.
