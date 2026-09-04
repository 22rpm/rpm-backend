# Plan: bucket the RPM day-count on measurement time (`measured_at`), not receipt time

**Status:** PLAN — no code yet. Backend first (deploy + verify), then iOS.
**Why:** the 99454 transmission-day count buckets on `dev_data.created_at` (server *receipt*
time), so batched/late deliveries collapse onto one day and undercount. See BILLING_FOLLOWUPS
#16. **This is a bug fix, not a billing decision** — the measurement day is the fact; when the
row reached the server is incidental. The June/July recount was identical either way, so there
is nothing to resubmit; Cleo gets an FYI, not a gate.

## The one thing that must not break: existing rows
Every row currently in `dev_data` has **no** `measured_at`, and so will any reading from an app
version that predates the iOS change. **The count must be unchanged for those rows.** That is
the entire reason the count reads `COALESCE(measured_at, created_at)` — new rows use the true
measurement time; every existing/old-client row transparently falls back to `created_at`,
exactly today's behavior. No backfill of the column, no data migration of values — the fallback
does it.

## Change set (one piece of work, in order)

### 1. Backend — schema
New migration: add a **nullable** column.
```
dev_data.measured_at  DATETIME  NULL
```
- Nullable is load-bearing: existing rows stay NULL → fall back to `created_at`.
- **Stored in UTC.** The bucketing does `CONVERT_TZ(col, '+00:00', clinicTz)` (`config/billingTz.js`
  `dayBucketSql`), i.e. it treats the column as UTC. `DATETIME` is returned as-stored (no session-tz
  coercion), so the ingest must write a **UTC** datetime. (Prod session is UTC — BILLING_FOLLOWUPS
  #11 — so `created_at` and a UTC `measured_at` bucket identically.)
- Optional index `(user_id, measured_at)`; the per-patient month scan is small today, so not required.

### 2. Backend — ingest accepts + persists it
- The client sends the device measurement time as **`data.measured_at` = epoch seconds** (the
  device `measuring_timestamp`). Absent (old clients) → column stays NULL.
- Convert epoch → UTC datetime in Node and insert it. `services/devData.service.js` `insertDevData`
  currently runs `INSERT INTO dev_data (dev_id, data)`; extend to
  `INSERT INTO dev_data (dev_id, data, measured_at)` with the third value =
  `new Date(measured_at_epoch * 1000)` (a UTC instant; insert as `'YYYY-MM-DD HH:MM:SS'` UTC or a
  Date the driver serializes in UTC). If absent → `NULL`.
- The controller (`controllers/devicedata.controller.js`) reads `data.measured_at` off the payload
  and passes it down. Keep it inside the `data` JSON too (harmless, audit).
- Backward compatible: no required field; old app builds keep working, their rows are NULL.

### 3. Backend — count buckets on `COALESCE(measured_at, created_at)`
`services/rpmNote.service.js` — the 99454 driver at line 140 and the BP-stats window at line ~163
both read `dev_data`. `tzq.dayBucketSql(col)` / `monthWhereSql(col)` interpolate the column into
SQL, so pass the expression:
```
tzq.dayBucketSql("COALESCE(measured_at, created_at)")
tzq.monthWhereSql("COALESCE(measured_at, created_at)")   // both the count (140) and BP-stats (163)
```
- New rows bucket on the real measurement day; existing/old rows fall back to `created_at`
  (unchanged). `created_at` stays as the receipt/audit trail — nothing is dropped.
- Leave the other `dev_data.created_at` readers as-is for now (notification "recently transmitted"
  checks, last-reading display) — they're not the billing count; note as a possible later
  consistency pass, not in this change.

### 4. iOS — live path sends the device timestamp
Today the live path discards it: `vt_try_extract_result` (`ViatomDeviceManager.m:601`) pulls only
sys/dia/mean/pulse from the parsed `VTMBPBPResult`, and the `onMeasurementResult` payload (m:1692)
carries only a phone `capturedAt`. Thread the device time through:
- `vt_try_extract_result` (and the offset fallback) also output `measuring_timestamp`.
- Put it in the `result` dict → the durable outbox record → the `onMeasurementResult` payload as
  `measured_at` (epoch s).
- JS `storeMeasurementData` (`BloodPressure.js`) sets `data.measured_at = measured_at`, **falling
  back to the phone time only if the device didn't supply one** (so the field is always present
  going forward). The outbox row carries `measured_at` so a durable replay keeps it.
- This also makes live and history readings dedup on the **same** device-clock key (DEVICE_HISTORY_DESIGN §5).

## Sequencing + verification
1. **Backend** (1–3): migrate, ingest, count. Deploy. **Verify before moving on:**
   - Existing rows: run the June/July recount again — counts identical to today (fallback works).
   - New row: insert a test `dev_data` row with a `measured_at` a few days in the past → it counts
     on the *measured* day, not today; a row with `measured_at = NULL` still counts on `created_at`.
   - `npx knex migrate:list` clean; `CONVERT_TZ` still resolves (tz tables loaded).
2. **iOS live** (4): ship `measured_at` on live readings. Verify a live reading lands on the correct
   clinic-local day via `measured_at`.
3. **iOS history sync** (DEVICE_HISTORY_DESIGN write pipeline): only now does backfill post, with
   `measured_at` = each record's `measuring_timestamp`, deduped on it.

## Cleo — FYI note (not a decision)
> Heads up on a fix, no action needed. The remote-monitoring day-count was dating readings by when
> our server received them, not when the patient took them, so a batch that synced late could count
> as one day instead of several — it could only ever *undercount*. We're fixing it to use the
> device's own measurement time. We rechecked June and July: the count is **identical** either way
> (17 and 24), so nothing to resubmit. Going forward the count reflects the true measurement day.
