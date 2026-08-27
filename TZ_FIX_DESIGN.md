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

## Sequenced build plan

### Two framings that shape the plan
1. **Pinning is a no-op on prod — nothing currently in production changes.** Prod's
   session is already UTC, so `SET time_zone='+00:00'` does nothing there. The only
   environment that moves is **dev** (PDT→UTC), and that is test data. Read by
   default, "pin the session tz" sounds like "every prod timestamp shifts 7h" — it
   is NOT that. Prod's real change is narrower: `CONVERT_TZ` bucketing (UTC-day →
   clinic-day) and the display conversion, both riding the not-yet-deployed
   care-activity/org-context pair. Already-deployed prod surfaces (login/OTP,
   current alerts) are untouched.
2. **The ledger is a one-way door with a hard deadline.** Signing the first prod
   `rpm_note` computes its `content_hash` under whatever session tz is live at that
   moment, and signing freezes it — any later tz change invalidates every prior hash
   (a permanent tamper false-positive on a billing document). **GATE: the tz fix
   MUST be live before the first prod note is signed. No exceptions.** The hash
   hardening (PR 1) is what makes this un-repeatable: after it, the column's tz
   representation can never affect verification again.

### Build / PR order (all on the care-activity + org-context pair; verified on dev)
Care-activity has never deployed, so there is no incremental prod patching — every
workstream is pre-deploy work that rides ONE atomic first release. Order is for
reviewability and dev verification.

- **PR 1 — Ledger hardening (no tz behavior change).** Store the exact signed ISO
  string used in the hash as an immutable column; sign AND verify over that string,
  not `toSecondIso(signed_at)`. Removes the ledger's dependence on the session tz
  entirely, so nothing about tz timing can break verification afterward. Touches:
  `rpmNoteSign.service` (sign + verify), a migration (add the column),
  `rpmNote.controller`. Verify on dev: a note verifies under BOTH a PDT and a
  force-UTC session. **Land first** so the ledger is safe regardless of the rest.
- **PR 2 — Session pin to UTC.** `SET time_zone='+00:00'` on connect in the mysql2
  pool. Dev-only effect (aligns dev to prod's UTC baseline); no-op on prod. Verify
  on dev: the app connection shows `NOW()==UTC_TIMESTAMP()`, and a JS `Date` from a
  TIMESTAMP column now equals the true instant (#12 mislabel gone). Touches:
  `config/db.js`.
- **PR 3 — Clinic-tz bucketing.** `organizations.timezone` migration (nullable,
  `NULL`→`CLINIC_TZ`); one shared `windowFor(month, tz)` + `CONVERT_TZ('+00:00',
  clinic_tz)` day expression; replace both duplicate `monthWindow`s and the vitals
  `DATE(created_at)` filter; the frontend sends a month id, not date bounds. Depends
  on PR 2 (created_at must read true UTC before CONVERT_TZ is correct). Verify on
  dev: patient 48 = 5; the boundary fixture flips 1↔2; note-count == vitals days ==
  worklist window. Touches: `rpmNote.service`, `patientWorklist.service`,
  `doctor.service`, the new helper, a migration, the vitals/worklist frontend.
- **PR 4 — App-wide display conversion.** One shared UTC→clinic formatter across
  every surface in Inventory §5. Depends on PR 2. Verify on dev: vitals
  table/chart/tiles, alerts, time log, note UI + history, worklist, PatientModal,
  signed-note all show clinic time and agree. Touches the frontend broadly (feature
  branches, not the deployed dashboard).
- **PR 5 — Writes/compares audit.** Confirm the `new Date()`→TIMESTAMP writes and
  `mfa_expires_at < new Date()` are correct post-pin; document the self-healing
  cases (OTP 5-min; 60-day trust drifts ≤8h once). Mostly verification.

### Migrations
- `organizations.timezone` (nullable).
- `rpm_notes` immutable signed-ISO column (PR 1).
- **No prod data migration.** Prod has none of these tables yet — the care-activity
  migrations create them fresh, already correct. The only data to handle is **dev
  test data**: truncate dev `rpm_notes` (old-scheme hashes) around PR 1.

### Runbook — the single atomic prod deploy
1. **HARD GATE — load the MySQL tz tables on prod and verify:**
   `mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql`, then
   `SELECT CONVERT_TZ(UTC_TIMESTAMP(),'UTC','America/Los_Angeles');` must return
   **NON-NULL**. If NULL, STOP — `CONVERT_TZ` collapses every bucket silently.
2. `mysqldump` prod (no backups exist), then run the care-activity migrations (they
   create the tables + the two new columns).
3. Deploy the tz-fixed care-activity + org-context code (PRs 1–5).
4. **ORDERING GATE — steps 1–3 must complete before any clinician signs the first
   prod note.** Violating it freezes a hash under the wrong tz and makes every later
   verify a false tamper positive.

### Verifiable BEFORE prod vs only AFTER
- **Before (all on dev — after PR 2, dev IS a faithful UTC rehearsal of prod):**
  ledger hardening (verify under both sessions), pin behavior, clinic bucketing
  (patient 48 + boundary fixture), display conversion, cross-consistency. The
  `scratch` replay env rehearses the migrations.
- **Only after (prod):** the tz tables are actually loaded on prod (step 1 query);
  the first real signed note verifies on prod; prod's note/vitals now render clinic
  time. (Prod session = UTC is already confirmed, so the pin needs no prod check.)

### Where the care-activity deploy sits
It **is** the deploy — every workstream rides the care-activity/org-context pair's
first prod release. Nothing tz-related ships separately, because prod has no
care-activity tables to patch. The release is gated by the tz-tables load (runbook
step 1) and bounded by the ledger deadline (must precede the first signed note).

## Mobile (iOS) display + capture-vs-delivery — audited 2026-08-24 (mobile never audited before)

The app is a SEPARATE display surface from the dashboard (#5), with its own defect,
made structural by the durable outbox.

**Symptom:** a 2:13 PM Pacific reading (backend received `data.timestamp =
2026-08-24T21:13:57Z`, correct) displays in the app as **7:13 AM**.

**BP — `BloodPressure.js:545-554` — DEFECTIVE.** `loadHistoricalData` maps date/time
AND the sort key from `item.createdAt`, ignoring `item.data.timestamp`:
```js
date/time: new Date(item.createdAt).toLocaleTimeString()
timestamp: item.createdAt          // also the sort key (557-560)
```
Two stacked errors:
1. **Wrong field** — `createdAt` is the DB insert instant; `data.timestamp` is the
   true captured UTC. `new Date(data.timestamp).toLocaleTimeString()` = **2:13 PM**.
2. **Double conversion** — `createdAt` arrives as Pacific-wall-clock-mislabeled-UTC
   (the #12 driver mislabel), and `toLocaleTimeString()` applies the device's −7h
   AGAIN → **7:13 AM**. The dashboard renders the naive digits without a toLocale
   round-trip (Pacific by accident); the app converts, so the mislabel surfaces —
   this is why the app differs from the dashboard.

**ECG — `ECG.js` — no server-backed reading list; nothing to fix now.** No
createdAt/timestamp display path exists (consistent with "no pipeline; data stops
at the phone"). When a pipeline is added, bind display + sort to the captured
instant from day one.

**Oxygen — `Oxygen.js:170,340-373` — OK, good pattern.** Displays and sorts from
`startTs` (a capture-time field), NOT `createdAt` — so it does not exhibit the BP
bug. Confirm `startTs` is the measurement time and, if Oxygen ever reads history
from the backend, that it keys on `data.timestamp`/`startTs`, never `created_at`.

**The outbox makes this structural, not cosmetic.** With the durable outbox
(rpm-ios-app `fix/bp-auto-reconnect`), `created_at` is the DB **delivery** instant —
an offline reading is POSTed on the next foreground drain, possibly a different
DAY. So `created_at` is not merely tz-mislabeled; it is the wrong instant.
`data.timestamp` is the only field that reflects when the reading was taken. Same
reason the billing count must move off `created_at` — see BILLING_FOLLOWUPS #13.

**Fix (mobile), independent of the backend pin:** map/sort BP from
`item.data?.timestamp` (fallback `createdAt` for legacy rows). Even a perfectly
pinned backend (#11/#12) still serves the wrong INSTANT if the app reads
`created_at`, so this is a distinct, app-side change.

### Server-side coupling (created_at audit + deploy gate)
The mobile display fix (use `data.timestamp`) has server-side siblings — every
place that windows/buckets READINGS by `created_at` inherits the outbox's
delivery-time problem: the transmission-day count (`rpmNote.service.js:125`), the
note's BP summary + count (`rpmNote.service.js:149`), and the last-N-days readings
window (`deviceData.service.js:2040`). Worklist and the note/time/call queries are
NOT affected (they use `started_at` / note-creation time). See BILLING_FOLLOWUPS #13.

**DEPLOY COUPLING:** the iOS outbox (`fix/bp-auto-reconnect`) INTRODUCED the
divergence — before it, `created_at` was within seconds of the reading. So the
outbox cannot ship before the backend moves these reading windows to
`data.timestamp`, or every offline reading mis-buckets its transmission day. The
outbox and the `data.timestamp` change are ONE release; gate the app release on
the backend change being live.

## Addendum — PatientHome "Synced N hours ago" (createdAt as served display time) — confirmed 2026-08-27

PatientHome / Readings / the reading reminder read the Synced time from
`res.data.data.createdAt` (the `dev_data.created_at` TIMESTAMP = outbox DELIVERY time),
not the reading's baked `data.timestamp`. Two problems, both captured against a real
row (id 353):

- **Served value is tz-mislabeled on dev.** `/devices/data/latest` goes through
  `config/db.js` (mysql2 `timezone:'Z'`) on a **SYSTEM (Pacific) session**. MySQL
  converts the `created_at` TIMESTAMP to Pacific wall-clock on SELECT; mysql2 then
  re-labels that as UTC. Captured: `created_at` served as `"2026-08-27T15:03:38.000Z"`
  while the true instant is `"2026-08-27T22:03:38.014Z"` (`data.timestamp`; `data.time`
  = "3:03:38 PM" Pacific). `Date.parse` reads 15:03Z → 7h early → "Synced 7 hours ago".
  (Via `config/knex`, which sets no `timezone`, the same row reads back correct — so
  the bug is the `config/db.js` path + the unpinned session. This is what fix (a),
  pinning the session to UTC, resolves.)
- **Wrong field even when the tz is right — this is a prod bug, not a dev artifact.**
  `created_at` is the delivery time, not the reading time. On prod (UTC session) the
  7h is invisible for an *immediately*-delivered reading — which is exactly why nobody
  caught it — but a reading taken offline and delivered later shows the **delivery
  time** on prod today.

**iOS fix (rpm-ios-app `fix/bp-auto-reconnect` `4316125`):** `bpReading.js` reads
`v.timestamp` (native `iso8601Now` — a UTC "…Z" string stored as JSON, immune to the
TIMESTAMP tz mislabel), falling back to `createdAt` only for a legacy row. Backend
still owes fix (a) (pin session to UTC) so any code using `created_at` as a display
time is correct; until then, display must key off `data.timestamp`.
