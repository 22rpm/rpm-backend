# Production data-integrity findings — device ingest (dev_data)

Recorded 2026-08-23 from a live iOS/Android test against production (main, 32
migrations, UTC) plus read-only prod queries and log review. Two distinct ingest
bugs corrupting `dev_data` in production, both longstanding (~9 months). This
document exists so the data loss and duplication are on the record if ever
questioned (payer audit, patient inquiry, internal review).

## Summary
| bug | effect | evidence | status |
|---|---|---|---|
| `devices` check-then-insert race | readings **lost entirely** (throw aborts the `dev_data` write) | 28 error log lines, ≥ users 20 & 33 | **fix in progress** (this branch) |
| `dev_data` retry with no idempotency | **duplicate** reading rows | 14 duplicate events since Nov 2025, 8 patients, one n=3 | tracked; fix after devices |
| Android `dev_id = 'unknown'` fallback | readings not attributable to the enrolled cuff | 2 `dev_data` rows + `devices` id 21 (user 15) | tracked (provenance/audit) |

## Bug 1 — `devices` check-then-insert race → readings lost entirely
`createDeviceDataService` (services/deviceData.service.js) ensures the device row
with a non-atomic **check-then-insert**:
```sql
SELECT id FROM devices WHERE dev_id = ? AND user_id = ?      -- step 1a
-- if none:
INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?,?,?)  -- step 1b
```
Under **concurrent POSTs for a not-yet-created device** — which the client
manufactures, because `storeDeviceData` (app `BloodPressure.js`) retries up to 3×
on a 5 s timeout — both requests `SELECT` (find none) and both `INSERT`; the second
violates `devices_dev_id_user_id_unique (dev_id, user_id)` and throws:
```
❌ createDeviceDataController error: Error: Duplicate entry
'54E5B047-3BCB-BDFB-BCD4-97B38E6056CB-33' for key 'devices.devices_dev_id_user_id_unique'
  at async createDeviceDataController (devicedata.controller.js:26:20)
```
**The throw aborts the reading.** The `devices` insert is step 1; the `dev_data`
insert is step 3; there is no transaction. The throw propagates → the controller
500s → **step 3 never runs → the reading is never written.** It is not merely
"errored" — the systolic/diastolic values are gone.

**Scope: 28 lost readings across at least users 20 and 33.** (Count from prod pm2
error logs: lines matching `devices_dev_id_user_id_unique`.) The true count/timespan
is bounded by log retention.

## Bug 2 — retry with no idempotency → duplicate rows
`createDeviceDataService` step 3 is a plain `INSERT INTO dev_data` with **no unique
key and no idempotency**. When the server writes the row but responds slowly (> the
client's 5 s timeout) or the response is lost, the app **retries → a second
identical row**. The client's own de-dup key is
`result_${sys}_${dia}_${pulse}_${Date.now()}` — including `Date.now()` makes every
key unique, so it can never match a prior send; the guard is inert.

**Scope: 14 duplicate events since Nov 2025 across 8 patients, one with n=3.** Nine
months. Confirmed live: rows **234 and 235**, device `51F0F5CA-…`, user 15,
identical 117/82/70, same `created_at 2026-08-23 00:04:05`, same device time — two
rows written, not one rendered twice.

Billing impact: same-timestamp duplicates do **not** add a distinct transmission
*day* (99445/99454 day-counts unaffected), but they **inflate reading counts and
double-weight that value in the average BP** for the affected month. RPM-note
billing is not deployed to prod (32 migrations, no `rpm_notes`), so no month has
been billed *by the system*; any manual billing off the dashboard's inflated
averages/counts since Nov 2025 would carry the error.

## The missing-first-reading reassessment (user 15, this test)
The user's first reading (minutes before 00:04:05) left **no `devices` row and no
`dev_data` row**. `devices` row 37 was created at **00:04:05** — the same second as
the duplicate second-reading rows (234/235) — so the device was created during the
**second** reading, not the first. And two `dev_data` rows for that event means it
did **not** throw (a throw yields at most one row). Therefore the first reading
failed **before the server persisted anything** — a POST-level failure (BLE result
event missed, or all 3 retries failed, e.g. a 401 before the session was ready),
**not** the Bug-1 throw. Bug 1 is real but was hitting other patients (users 20/33),
not this event.

## `dev_id = 'unknown'`
The **Android** app writes the literal string when the BLE device address is
missing: `BloodPressure.js:845` → `id: payload.address || 'unknown'`. Readings then
POST with `devId: 'unknown'`, creating a `(user, 'unknown')` `devices` row (observed:
id 21, user 15) and stamping `dev_data.dev_id='unknown'`. (iOS uses
`bp_device_001` / `unknown_device_id` fallbacks instead.)

Billing/provenance: transmission-day counting is keyed on `user_id`, and the unique
key is `(dev_id, user_id)`, so an `'unknown'` reading **still counts toward the
correct patient's days — the count is right.** What breaks is **device provenance**:
the reading cannot be tied to the specific enrolled cuff, which a device-supply
(99453/99454) audit presumes. It is an attribution/audit gap, not a miscount.
NOTE: Android is being tested next and this may be reproduced live.

## Recovery of the 28 lost readings — NOT POSSIBLE
The controller entry log records only `{ userId, devId, devType }`
(devicedata.controller.js:20) — **not `data`** — and there is no body-logging
middleware. The throw happens before any value is logged, and the systolic/
diastolic/pulse existed only in the request body and transiently on the patient's
phone. **So the values of the 28 lost readings are not in the server logs and are
unrecoverable.** Only `user_id`, `dev_id`, `dev_type`, and the approximate time
survive. This is a documented data-loss event: 28 real patient readings, values
gone, across ≥2 patients over ~9 months.

## Prod queries used (read-only)
```sql
-- duplicate events across all history (Bug 2 scope)
SELECT dev_id,user_id,created_at,
       JSON_EXTRACT(data,'$.systolic') s, JSON_EXTRACT(data,'$.diastolic') d, COUNT(*) n
FROM dev_data WHERE dev_type='bp'
GROUP BY dev_id,user_id,created_at,s,d HAVING n>1 ORDER BY created_at DESC;

-- duplicate events by month
SELECT DATE_FORMAT(created_at,'%Y-%m') ym, COUNT(*) dup_events FROM (
  SELECT created_at FROM dev_data WHERE dev_type='bp'
  GROUP BY dev_id,user_id,created_at,
           JSON_EXTRACT(data,'$.systolic'),JSON_EXTRACT(data,'$.diastolic') HAVING COUNT(*)>1
) x GROUP BY ym ORDER BY ym;
```
Lost readings are counted from pm2 error logs (`devices_dev_id_user_id_unique`), not
from `dev_data` (they left no row).

## Fixes (tracked)
1. **Bug 1 (this branch, `fix/device-upsert-idempotent`):** make the device-ensure
   an atomic idempotent upsert (`INSERT … ON DUPLICATE KEY UPDATE`) and wrap it so a
   `devices` error can never abort the `dev_data` write. Stops the loss.
2. **Bug 2 (next):** server-side idempotency constraint on `dev_data` (billing-
   durable) + client de-dup key fix (drop `Date.now()`) + smarter retry.
3. **`'unknown'` (Android):** capture the device address reliably, or reject/flag
   readings that cannot be tied to an enrolled device.

Separately (not a data bug, same incident review): production OTP delivery is down —
Twilio `username is required` and Gmail `BadCredentials` — a config/credential issue,
tracked as an auth-availability incident.
