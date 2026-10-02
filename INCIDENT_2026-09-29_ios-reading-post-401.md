# OPEN — iOS reading POSTs silently 401 after a 45-minute cookie expiry; all iOS patients

**Status:** OPEN. Root cause identified and confirmed by nginx logs + a live fix-on-login.
Fixes scoped below (not built). **Opened:** 2026-10-02 (onset 2026-09-29).
**Severity:** HIGH — silent loss of clinical reading data for **every iOS patient**, with a
patient-facing UI that falsely says the reading was saved, and **no server-side detection**. The
only reasons data has survived at all are the durable on-device outbox and accidental re-logins.

> **One-line mechanism:** the BP reading POST authenticates by a **cookie with a 45-minute TTL**
> that is renewed **only by a full login**; the token-refresh flow is broken four independent ways
> and is never invoked on a 401; so ~45 minutes after each patient's last login, every reading POST
> 401s forever until the patient happens to log in again.

## Timeline — patients 32 & 33 (the reported case)
- **Sep 29 03:45 UTC** — both patients' last successful login (`user_devices.last_activity_at`,
  written only in the login handler `auth.controller.js:488`), ~3 minutes apart.
- **~Sep 29 04:30 UTC** — both `token` cookies expire (45-minute TTL). With refresh broken and no
  re-login, they stay expired.
- **Sep 29 → Oct 2** — every reading POST 401s. `dev_data` receives nothing from either patient;
  `last_activity_at` frozen at Sep 29 03:45.
- **Oct 1/2, evening** — both patients take BP readings. They **appear in the app**. Each POST to
  `/rpm-be/api/dev-data/devices/data` returns **401 at the duckdns nginx**; the outbox re-drains,
  producing **~14 × 401 in ~3 seconds**; **no refresh attempt appears** in the logs.
- **Oct 2 06:35 UTC** — a successful login issues a fresh 45-minute cookie; the next outbox drain
  **immediately flushes the queued readings** (2xx), and delivery resumes. This fix-on-login is the
  confirmation of the mechanism.

The "both within three minutes" looked like a common server event; it is not — it is a **shared
last-login moment**. The 45-minute TTL is the cause, and it applies to every iOS patient (see Blast
radius).

## Finding — the reading path and why it dies
Live reading flow (iOS, React Native): native BLE callback → **durable outbox write**
(`Documents/bp_outbox.json`) → `onMeasurementResult` event → **JS displays the value** →
`drainOutbox()` POSTs it. Display and delivery are decoupled; the outbox file is the source of truth.

The ingest POST (`outbox.js:86`, `axios.post('${DEV_DATA_BASE}/devices/data', …,
{ withCredentials:true })`) authenticates by **cookie only** — no `Authorization: Bearer`. The
`token` cookie is minted with **`expiresIn:"45m"` and `maxAge: 45*60*1000`**
(`controllers/auth.controller.js:481,515-519`) and is renewed **only by a full login** (`res.cookie`
at `:515`; the refresh handler's cookie renewal is unreachable from iOS — see below). Nothing in the
running app renews that cookie, so 45 minutes after login every reading POST 401s. On each 401 the
drain does `kept += 1; console.warn` (`outbox.js:98-101`) — the row is retained, **nothing
escalates, nothing refreshes, nothing re-logs-in.**

### The four independent breaks in the refresh flow (why a valid refresh_token doesn't help)
The device has an unrevoked refresh token valid to Oct 13. It cannot renew the cookie because:
1. **No 401 trigger.** There is no axios interceptor and no 401 handler anywhere in the app. A 401
   on the reading POST invokes nothing. Refresh runs only on a 40-minute **foreground-only** timer
   (`App.js` `checkAndScheduleRefresh`, stopped on background).
2. **Wrong token location.** iOS sends the refresh token in the request **body** (`App.js:50`,
   `{ refreshToken }`); the backend reads it from the **cookie** — `req.cookies.refresh_token`
   (`auth.controller.js:1138`). With no cookie sent, the handler returns **401 "No refresh token"**
   (`:1142`). The refresh call 401s server-side every time, regardless of the valid stored token.
3. **No cookies on the refresh call.** `App.js:50` omits `credentials:'include'`, so it neither
   sends the `refresh_token` cookie nor stores the new `token` cookie from the response.
4. **Nothing usable in the body.** Even on success the handler renews only the **cookie** (`:1186`)
   and returns a body with **no `accessToken`** (`:1196`); `App.js:61` reads `data.accessToken` →
   `undefined` → writes `undefined` into AsyncStorage, corrupting even the Bearer path.

So the refresh flow is a four-way no-op for the one credential the reading POST depends on.

### No 401 handler anywhere
Grep confirms: no axios interceptor, no `status === 401` handler in the data path. A 401 is caught
only by the outbox's generic `catch` (`outbox.js:98-101`) which keeps the row and logs a warning.
There is no reachability/NetInfo listener and no background timer, so a queued reading is retried
only when the user visits app-start / BP-screen focus / home / readings (`App.js:166`,
`BloodPressure.js:1039,899`, `PatientHome.js:65`, `Readings.js:35`) — all of which re-fail until a
login refreshes the cookie.

### The false "Reading saved" reassurance
After a reading, `ReadingConfirmation.js` shows the `queued` state for **any** non-delivery —
including a 401 while the patient is fully online — reading **"Reading saved · We'll send it to your
care team automatically when you're back online"** (`ReadingConfirmation.js:33,42`). The home/list
pill shows a soft **"waiting"** vs "synced" (`bpReading.js:30-66`). There is **no error, no "not
transmitted," no retry control, and no age/staleness surface** (`outbox.js:114 oldestPendingAgeMs()`
exists but has no caller). A reading stuck for days is visually identical to one sent seconds ago,
and the copy actively tells the patient it is handled when it is not.

### No server-side detection
Nothing server-side notices. `user_devices.last_activity_at` is written only on login
(`auth.controller.js:488`), not on data POSTs, and nothing reads it for staleness. There is no job
that flags an enrolled patient with no readings for N days (see `SILENT_PATIENT_DETECTOR_DESIGN.md`).
The one signal that existed — **401s on the reading endpoint in the duckdns nginx access log** — was
present from Sep 29 and **nobody was watching it**.

## Log evidence
duckdns nginx access log: repeated `POST /rpm-be/api/dev-data/devices/data` returning **401**, in
bursts (~14 in ~3 s — the outbox re-draining all queued rows), from Sep 29 onward for the affected
devices, with **no** intervening `POST /api/auth/refresh-token` success. The 401 originates in the
backend `authRequired` middleware (expired/empty cookie), so nginx records status 401 but **no
patient id** (the cookie is httpOnly; the body isn't logged). Delivery resumes immediately after the
06:35 login.

## Blast radius — EVERY iOS patient, not two
This is **systemic**, not specific to 32 & 33. Reading delivery works only in the **45 minutes after
a login** and then fails silently until the next login. Because the app keeps the user "logged in"
via AsyncStorage tokens and the refresh flow never renews the cookie (and never re-logs-in), a
patient is effectively **never** issued a fresh cookie after that first 45-minute window. Patients 32
& 33 are simply the ones observed; the fleet-wide failure is governed by "time since each patient's
last login," which for a stay-logged-in app is ~always expired.

**What has been saving data:** (a) the **durable on-device outbox** retains unsent readings across
app restarts and re-POSTs idempotently (server dedups on the baked `timestamp`), so a later
authenticated drain flushes them; and (b) **accidental re-logins** (reinstall, logout, an AsyncStorage
token finally failing and bouncing to Login) that mint a fresh cookie and trigger a drain. Neither is
a designed delivery path. The one unrecoverable case is a reading taken with the app **not connected**
(cuff memory only): iOS history sync is disabled (`HISTORY_SYNC_ENABLED=false`) and the native history
path writes nothing to the outbox.

**Recovery of the reported readings:** the Oct 2 06:35 login should already have flushed patients 32
& 33's queued readings. Verify on the box: `dev_data` for those `user_id`s should show the tonight
readings delivered just after 06:35, dated to `measured_at`. (Note: the 99454 count still buckets on
`created_at` — see `SILENT_PATIENT_DETECTOR_DESIGN.md` premise correction — so billing credits them
to the receipt day.)

## Remediation — priority order, release vs no-release

### A. No App Store release (ship first — server + ops only)
1. **401 alert on the reading endpoint (detection, fastest).** Watch the duckdns nginx access log
   for 401s on `POST /rpm-be/api/dev-data/devices/data` (and `/bp/data`) and alert above a low
   threshold. Zero code/deploy; see the companion scoping. This makes the signal that was ignored
   since Sep 29 visible immediately.
2. **Server-side auth-failure logging with patient id (detection, durable).** At the `authRequired`
   401 for the ingest routes, decode-without-verify the expired token (or map `refresh_token` →
   `user_devices.user_id`) to log *which* patient is 401ing, queryable and reusable by the
   silent-patient detector. Backend deploy, no app release.
3. **Lengthen the access-cookie TTL and/or accept Bearer on the ingest route (server).** The ingest
   POST already could accept a Bearer token (other endpoints send one from AsyncStorage, which the
   refresh path *does* keep fresher). Accepting `Authorization: Bearer` on `/devices/data`
   server-side would let the existing (AsyncStorage) token authenticate reading posts without an app
   release — but only if the app actually sends it (it does not today), so this pairs with B. On its
   own, raising the 45m TTL only widens the window, not a fix.
4. **Fix the server refresh contract** so it reads the refresh token from the body **or** cookie and
   returns `accessToken` in the body (`auth.controller.js:1138,1196`) — so a corrected app can
   actually refresh. Backend deploy; harmless to current clients.

### B. Requires an App Store release (the real fix)
5. **Send `Authorization: Bearer` on the reading POST** (`outbox.js`, `historySync.js`,
   `bpReading.js`) from the AsyncStorage token — so delivery no longer depends on the 45-minute
   cookie. **CORRECTION (2026-10-02):** an earlier draft said this "matches medications/profile/
   settings." It does not — `authRequired` (`middleware/auth.js:110`) reads the cookie ONLY and
   **ignores the `Authorization` header**, and medications/profile/settings use the same
   `authRequired`, so they are cookie-dependent too (they have been failing the same way, unreported
   — the cookie expiry degrades the whole authenticated surface, not just readings). Bearer must
   therefore be **enabled on the backend first** — see `BUILD_55_DELIVERY_RELIABILITY.md` §B1 — and
   only then will sending it from the app help.
6. **Add a 401 handler / interceptor** that, on a 401, refreshes (via the corrected contract, #4) and
   retries once; on refresh failure, bounce to Login rather than silently queueing forever.
7. **Fix the refresh call** to use `credentials:'include'` (or move fully to Bearer) and to read the
   returned `accessToken`.
8. **Honest delivery UX** — replace the unconditional "Reading saved, we'll send it automatically"
   with a real state: `sent` vs `queued (will retry)` vs **`not sent — tap to retry / sign in`**, and
   surface `oldestPendingAgeMs()` as a staleness warning.
9. **Enable the device-history outbox path** so app-disconnected (cuff-memory) readings are delivered
   (separate track, gated by `DEVICE_HISTORY_DESIGN.md`).

## Prevention
- A reading POST must not depend on a short-TTL credential that nothing refreshes; authenticate it
  the same way as the other authenticated endpoints (Bearer), with a working 401→refresh→retry path.
- The platform must **detect** silent ingest (the 401 alert now; the silent-patient detector next) —
  a failure mode this quiet must not again depend on a clinician noticing.
- Delivery UX must never claim success it hasn't confirmed.
