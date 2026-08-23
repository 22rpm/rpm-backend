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

### `dev_id = 'bp_device_001'` (iOS) — WORSE than `'unknown'`
iOS falls back to a **shared literal** when the connected device id is missing:
`rpm-ios-app/BloodPressure.js:478` → `devId: currentDevice?.id || 'bp_device_001'`.
This is worse than Android's `'unknown'` for three reasons:
1. **It looks like a legitimate device id, not a null.** `'unknown'` self-identifies
   as a fallback and can be filtered/flagged; `'bp_device_001'` masquerades as a
   real device, so fallback readings are indistinguishable from real-cuff readings
   in the data — you cannot detect or audit them after the fact.
2. **Collides on `(dev_id, user_id)`.** Every iOS reading that hits the fallback for
   a given patient maps to the same `(bp_device_001, user_id)` `devices` row, so a
   patient with both real-cuff and fallback readings ends up with the cuff's data
   **split across two device rows** (the real UUID and `bp_device_001`) — fragmented
   attribution for one physical device.
3. Same billing nuance as `'unknown'`: per-`user_id` transmission-day counts are
   still correct, but device provenance is broken — and here it's broken *silently*,
   because nothing marks the reading as fallback.

**Scope — QUERY PROD (read-only; count + which patients):**
```sql
SELECT user_id, COUNT(*) n, MIN(created_at) first, MAX(created_at) last
FROM dev_data WHERE dev_id = 'bp_device_001'
GROUP BY user_id ORDER BY n DESC;
-- and the masquerading devices rows:
SELECT id, dev_id, user_id, dev_type, created_at FROM devices WHERE dev_id = 'bp_device_001';
```
**Scope (prod, as of 2026-08): 17 readings, 5 patients, ONGOING (April→August), not
historical:**
| user | readings | span |
|---|---|---|
| 23 | 11 | 2026-04-01 → 2026-08-07 |
| 34 | 2 | 2026-04-16 |
| 32 | 2 | 2026-06-05 |
| 25 | 1 | 2026-05-06 |
| 33 | 1 | 2026-06-02 |

Six `devices` rows carry the literal (ids 16, 25, 26, 27, 34, 35). User 23 is the
significant case — 11 fallback readings over four months.

**Audit gap does NOT materialize (checked 2026-08).** User 23 also has a real device
(`7C46598B-…`, 73 readings Apr→Aug) plus a one-off third id (`2AC57657-…`, 1 reading
2026-04-01). Every month has real-device readings, so device-supply attribution
holds for all of them:

| month | fallback | real-device |
|---|---|---|
| 2026-04 | 2 | 9 |
| 2026-05 | 4 | 14 |
| 2026-06 | 3 | 17 |
| 2026-07 | 1 | 25 |
| 2026-08 | 1 | 9 |

No month is entirely fallback → the 99454 concern is real *in principle* but has not
bitten. The fallback rate is also **declining** (≈2/11 → 1/10), consistent with an
occasional race rather than a systematic failure. `2AC57657-…` appears once, on
2026-04-01, at the same timestamp as her first `bp_device_001` reading — likely an
earlier pairing; flagged, not chased.

### Why the fallback fires (root cause)
The device identity is **re-read from a mutable ref at store time, not bound to the
measurement.** `onMeasurementResult` (BloodPressure.js:785) — the native BLE result
event — carries the reading values but **no device id**; the handler and
`storeMeasurementData` both read `connectedDeviceRef.current` (804 / 475), and
`onDeviceDisconnected` sets that ref to `null` (770). The Viatom cuff disconnects
after each reading, and the app clears the ref + rescans on every disconnect
(770-777) — so there is a structural **race between the result event and the
disconnect event**. When the disconnect wins, the store reads a null ref →
`'bp_device_001'`. This is a timing race inherent to "measure → disconnect → store,"
which is why it recurs across five patients months apart, not a one-off.

### Proposed behavior (a reading with no identifiable device must not invent one)
Transmission-day counts key on `user_id`, so counts are unaffected by any choice
here — this is purely **provenance**. Recommendation:
1. **Primary — bind the peripheral UUID to the reading at measurement time.** Have
   the native `onMeasurementResult` event include the producing peripheral's
   `identifier.UUIDString` (the native manager knows `connectedPeripheral`), and use
   `evt.deviceId` instead of the live ref. The id then travels *with* the reading and
   a later disconnect can't erase it — this removes almost all fallbacks.
2. **When genuinely unknown — store `dev_id = NULL` + an explicit unattributed flag**
   (e.g. `data.deviceAttributed: false`). NOT reject (the BP reading is real; dropping
   it is clinical data loss, the same class of bug as the devices-throw). NOT a
   placeholder literal (masquerades as a real device, collides on `(dev_id,
   user_id)`). NULL + flag preserves the reading, doesn't collide, and is
   filterable/auditable as "provenance missing" rather than silently faked.
3. **Backend:** tolerate a null/unattributed `dev_id` — store the `dev_data` row but
   do NOT create a `devices` row for it (folds into the devices-upsert fix), and
   surface unattributed readings for staff review rather than accepting silently.

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
