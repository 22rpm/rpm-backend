# Security follow-ups (backend)

Tracked, NOT fixed on `hotfix/admin-routes-missing-auth`. Recorded during the
privilege-escalation fix for the admin user-mutation and care-team routes.

## 1. `role.user_id` needs a UNIQUE constraint — RESOLVED (`43706f2`)
- Added `UNIQUE(role.user_id)` via `20260819120000_add_unique_role_user_id.js`
  (defensive dedup keeping the most-privileged row, then the constraint). This
  makes `updateUserRole`'s `INSERT ... ON DUPLICATE KEY UPDATE` behave as intended.

## 2. `getUserRoleType` most-privileged-wins — RESOLVED (`43706f2`)
- `getUserRoleType` and the new `findRoleByUserId` now order by privilege
  (super-admin > admin > clinician > patient), not newest-wins. All three
  session-issuing paths (login, verifyOtpController, refresh) resolve role by
  `user_id`. `UNIQUE(users.username)` also added
  (`20260819120100_add_unique_users_username.js`); settings username change now
  returns 409 on conflict.

## 3. OTP generation uses `Math.random()` — RESOLVED for login (`c94e134`)
- Login OTP now uses `crypto.randomInt(100000, 1000000)`
  (`controllers/auth.controller.js`). Note: `services/mfa.service.js` still uses
  `Math.random()`, but that path is dormant (imported, not called). Convert it if
  it is ever reactivated.

## 4. Production MySQL root credentials are `root`/`root` — rotate
- Confirmed on the box today: prod MySQL uses `root`/`root`, stored in
  `/home/ubuntu/22-rpm/rpm-backend/.env`. Needs credential rotation (a scoped
  app user, not root) on a scheduled window. Not blocking a code merge, but a
  standing infrastructure risk.

## 5. Production working tree had drifted from git — process, not code
- During deploy prep (2026-08-19) the box's `server.js` was found to carry an
  uncommitted, load-bearing CORS change (origins pointed at
  `api.twentytwohealth.com`) that existed nowhere in git. Deploying `main` as-is
  would have silently reverted it and broken the dashboard for every user. The
  change has since been brought into `main` (`e9d9901`), but the underlying
  problem is infrastructural: files are being edited directly on the production
  box, so the deployed state is not reproducible from the repo and every deploy
  risks clobbering unrecorded changes.
- This is an infrastructure/process issue, not a code defect. For Husnain:
  production should be deployed only from committed refs, with no manual edits on
  the box; if a hotfix must be made on the box, it needs to be committed and
  pushed the same day. Consider a pre-deploy `git status` gate that refuses to
  deploy when the working tree is dirty.

## 6. IDOR: cross-org clinician read on `getDoctorsByOrganization` — LIVE in prod
- `GET /api/org/organization/:organizationId`
  (`routes/org.routes.js:101`, `controllers/organization.controller.js:556`)
  reads the org id straight from the client-supplied path param and never runs
  `resolveOrgScope`. It is gated `requireRole("admin","super-admin")` but does not
  check that an admin's requested org is their own — so an admin at clinic A can
  request `/api/org/organization/<B>` and get clinic B's active clinician roster
  (id, name, username, email, phoneNumber). A live cross-org read of PHI-adjacent
  staff data, on deployed code.
- Callers today: `AddUserModal.jsx:39` and `EditUserModal.jsx:61` (dashboard),
  both passing the org in the URL path.
- **Fix size — small, and worth shipping on its own.** `orgScope.js` is already on
  main, so this needs no new infrastructure. Two shapes:
  - *Tightest, zero frontend risk (recommended to ship now):* add a guard so a
    non-super-admin can only read their own org — resolve the caller's role, and if
    not super-admin, force the query to `req.user.org_id` (or 404 when the path id
    differs). ~5 lines in the controller; admins and super-admins keep working
    exactly as today, the cross-org read is closed.
  - *Consistent with the rest of the clinical surface (do later):* add
    `resolveOrgScope` to the route and read `req.orgScope` instead of the path param.
    Transparent for admins (scope ignores client input, uses own org). BUT
    super-admins resolve their org from `?organizationId=` (query), while the two
    callers pass it in the path and the fetch interceptor's `CLINICAL_RE` does not
    cover `/api/org/*` — so this variant also needs the callers (or the interceptor)
    updated, or a super-admin path-param fallback in `resolveOrgScope`. Bigger blast
    radius; not needed to close the vuln.

## 7. Four divergent BP classifiers; ingest one drove alerts and was wrong
- Blood-pressure readings are classified in **four** different, disagreeing
  places:
  1. `services/deviceData.service.js:766` — local `calculateBPStatus` inside
     `createDeviceDataService`. **This is the ingest path and it gated alerting.**
     It used `sVal > 140 || dVal > 99` (strict `>`, diastolic cutoff 99), so a
     140/95 Stage-2 reading classified as `"Normal"`, and NaN defaulted to
     `"Normal"`. Since the alert fired only when `bpStatus !== "Normal"`, those
     readings produced **no alert at all**. **Fixed in `hotfix/bp-classification`**:
     boundaries corrected to `>=180/>=120` (Emergency), `>=140/>=90` (High),
     `<90/<60` (Low); NaN → `"Error"`; and alerting decoupled from the label onto
     an explicit **placeholder** urgent threshold (SBP>=160 or DBP>=100, from the
     biller template) pending the medical director's decision.
  2. `services/deviceData.service.js:686` — module-level `calculateBPStatus`
     (`>120 || >80` → High). Over-sensitive; not the ingest path.
  3. `services/doctor.service.js:65` — local `getBPStatus` (display):
     `<=139 && <=89` → warning, else critical.
  4. `services/doctor.service.js:114` — module `getBPStatus` (display): `>140 ||
     >90` → warning; has the same `>140` off-by-one (140/85 → normal).
- **Display and alerting can disagree.** The number a clinician sees on the
  vitals screen comes from the `doctor.service` classifiers; the number that
  decided whether they were paged came from `deviceData.service:766`. A reading
  can render **critical on screen while having generated no alert** — the two
  code paths use different thresholds and neither is the single source of truth.
- **Follow-up:** consolidate to ONE classifier and evaluate alert thresholds
  from configuration, not a hardcoded string comparison, so display and alerting
  cannot diverge. The `hotfix/bp-classification` change is a stopgap: it stops the
  silent under-classification and the alert-suppression, but leaves the other
  three variants and the display/alert split in place. Clinical thresholds
  (abnormal flag vs urgent alert) are pending the medical director; a read-only
  backfill audit (`bp_audit.sql`) quantifies readings already stored `"Normal"`
  that are actually elevated.

## 8. `doctor_alert_settings` is an inert control — configured, never applied
- **Most user-visible of these problems:** clinicians have a per-clinician alert
  threshold UI (Settings → Systolic/Diastolic High/Low, "Set as Default
  (Recommended)") that writes real rows, and the alert path reads them — but the
  configured VALUES are never used. A clinician setting Systolic High to 130 vs
  200 changes nothing.
- **The control and its writes:**
  - Table `doctor_alert_settings` (`config/migrations/20251104115156_...`):
    `doctor_id` UNIQUE, `systolic_high`/`systolic_low`/`diastolic_high`/
    `diastolic_low` (defaults 140/90/90/60).
  - Save endpoint `routes/alert.route.js:~2857` upserts the row; read endpoint
    `~2766`. Frontend `rpm-dashboard-v1.0/src/pages/Settings.jsx` (~1128+) POSTs
    to `/api/alerts/alert-settings`. "Set as Default" fills the form with
    130/99/90/69 (a THIRD default set, disagreeing with both the migration's
    140/90/90/60 and the load-fallback 130/99).
- **Read at alert time but not applied** (`services/deviceData.service.js`):
  - The recipient query LEFT JOINs the settings and selects the columns
    (`:899`, `:912`, `:931`).
  - Recipient filtering calls `determineTypeForClinician(vitals)` (`:972`) — with
    the VITALS ONLY. That function (`:722`) classifies against **hardcoded** bands
    (`sVal > 140`, `130-140`, `dVal > 99`, `90-99`, ...) and never receives or
    compares the clinician's configured thresholds.
  - The only thing read from the settings is a `hasSettings` boolean (`:978`):
    in the else-branch (`:983`), if the reading does NOT cross the hardcoded band
    AND the clinician HAS a row, they are **excluded**. So the sole functional
    effect of saving settings is to **reduce** what a clinician receives — the
    inverse of what the UI implies.
- **Note:** `determineTypeForClinician` (`:722`) is a SECOND alert-time BP
  classifier with the SAME `> 140` / `> 99` boundary bugs as the ingest one, and
  it shapes the alert (recipients + type) after the gate. It is unfixed. (This is
  the classifier the earlier stopgap missed; see #7 for the four-classifier list —
  this is effectively a fifth threshold surface.)
- **Production: 0 rows** (confirmed) — no clinician has ever saved settings, so
  nobody relies on the inert control and the table can be reshaped freely with no
  migration. Resolution is the consolidation design (one evaluator, one threshold
  source): either wire this up for real or remove the UI so it stops implying a
  control that does nothing.
- **Severity mislabel (for consolidation):** with the classifier fix deployed, a
  140/95 reading DOES page recipients — but `determineTypeForClinician` classifies
  it severity **"low"** (its `sVal > 140` off-by-one puts 140 in the *moderate*
  band, not extreme). So a Stage-2 reading reaches the clinician labeled low
  severity (muted color, low-urgency sound). The alert fires — what matters for
  the stopgap — but the severity is wrong, and it disagrees with the ingest
  classifier's "High". Same root cause as #7: fold `determineTypeForClinician`
  into the single evaluator so severity is computed once, correctly.
- **Malformed-reading device alert (fast-follow):** the stopgap persists
  `bpStatus:"Error"` for malformed readings but deliberately does NOT fire a
  clinical BP alert for them (it would render as a misleading low-severity
  clinical event, e.g. "BP alert (severity: low) - abc/95"). A proper
  device/data-quality alert type — visibly a device problem, with its own
  rendering — should be added so a garbage-sending cuff surfaces to staff without
  masquerading as a clinical reading.

## 9. Session cookies + JWTs logged in plaintext to prod logs — LIVE LEAK, redacted (`fix/device-upsert-idempotent`)
Prod's pm2 `out` log printed **full session cookies in plaintext** — `token=` and
`refresh_token=` JWTs — in the socket-auth handshake dump. The decoded payload
carries the user's **name, email, phone, role_type, org_id**, so anyone with box or
log access could lift a live session and impersonate that clinician **or patient**.
Found while chasing the ingest bug.

Leak sites (all value-leaking `console.log`s), now redacted to booleans/ids:
- `socket/socketServer.js:234-235` — `socket.handshake.headers` (the `cookie`
  header) and `socket.handshake.query` (a query `token`, used in prod per the
  fallback) → now logs only which auth source is present.
- `server.js:287-288` (`/rpm-be/test-socket`) — `req.headers.cookie` and full
  `req.headers` → now logs `Cookie present: <bool>`.
- `controllers/settings.controller.js:20` — `console.log("Decoded token:", decoded)`
  (the whole JWT payload) → now logs `Token verified for user: <id>`.
- Left as-is (not a value leak): `middleware/auth.js:113` logs cookie NAMES
  (`Object.keys(req.cookies)`), not values.

Follow-ups: rotate `JWT_SECRET` is NOT required (secrets weren't logged, tokens
were — but those tokens are now in historical logs). **Consider the already-logged
tokens compromised**: purge/rotate the affected pm2 logs, and note any token in
them is valid until expiry (2h access; refresh longer). Longer term, a redaction
layer on the logger so header/cookie objects can never be logged whole.

## 10. Production OTP delivery was down (both channels) — RESOLVED (pm2 stale env)
For an unknown period, **all** OTP delivery failed in production: Twilio SMS threw
`username is required` and Gmail threw `BadCredentials` on every send. **Cause: pm2
was carrying a stale environment from before the Twilio/Gmail keys were added to
`.env`** — the running process never had them, so `dotenv` values existed on disk
but not in the live process env. `pm2 restart --update-env` fixed it. **Both
credentials were valid throughout — no rotation was needed** (the well-formed
`.env` values plus the provider round-trip confirmed it; the `username is required`
error was the tell — a missing SID at runtime, not a bad pair, which would 401).

Impact and the real problem:
- **Patients were affected too, not just clinicians** — patient login uses SMS OTP,
  so patient logins requiring an OTP could not complete during the outage.
- **Nothing surfaced the failure.** It was found *by accident* while chasing an
  unrelated ingest bug in the logs. There is no alert, health check, or dashboard
  for "OTP send is failing" — a core auth dependency was down silently.
- Follow-ups: (1) add monitoring/alerting on OTP send failures (Twilio/Gmail send
  errors → surface, don't just `console.log`); (2) deploys that touch `.env` must
  use `pm2 restart --update-env` (or an ecosystem `env_file`) so the process env and
  `.env` can't diverge again; (3) a startup self-check that both providers
  authenticate would have caught this at boot.

## 11. Auth identity: phone-mandatory, non-unique phone, first-match login resolution — design (phone OR email, each unique) — DESIGN ONLY, no code
Context: `phoneNumber` was a **mandatory** enrollment field before real numbers
existed, so ~10 prod test accounts all carry the fake `123456789` (data entry, not
a mystery). The design must change to **phone OR email, at least one, each unique if
present** — and the login resolver must **reject ambiguous matches, never pick one**.

### The vulnerability (login resolver)
`findUserByPhone` (services/user.service.js:91) resolves by a **suffix match**
(`... LIKE '%<last-10-digits>'`), `ORDER BY id DESC`, and on multiple matches it
**logs a warning and returns `rows[0]` anyway**. Called from
`auth.controller.js:246` when the identifier looks like a phone. Two problems:
1. **First-match resolution.** An ambiguous phone silently resolves to the newest
   matching account. Today it's masked by the password check (bcrypt), but if two
   patients ever legitimately share a number, login with the shared phone resolves
   to the wrong account — a real account-confusion/takeover vector. **Ambiguity must
   be REFUSED, never resolved by picking one.**
2. **Suffix `LIKE` cross-match.** `'%tail'` matches *different* numbers that share a
   10-digit suffix (different country code, extra leading digits). The suffix hack
   exists precisely because stored phone formats are inconsistent.

### Constraints today
`users.email` UNIQUE **and NOT NULL**; `users.username` UNIQUE; `users.phoneNumber`
**nullable, NO unique constraint**. So phone is non-unique (the 10 duplicates), and
email being NOT NULL blocks phone-only patients.

### What "at least one of phone/email, each unique if present" requires
- **Schema (migration):**
  - `email` → **nullable** (so a phone-only patient can exist); keep `UNIQUE(email)`
    (MySQL allows multiple NULLs, so many phone-only rows are fine).
  - Add `UNIQUE(phoneNumber)` (also NULL-tolerant → many email-only rows fine).
  - Add `CHECK (phoneNumber IS NOT NULL OR email IS NOT NULL)` — at least one.
  - **Normalize phone to E.164 canonical on write** and store canonical. Uniqueness
    and exact-match are meaningless without this — it's what lets the resolver drop
    the suffix `LIKE` for an exact match, and what makes `UNIQUE(phoneNumber)` real.
  - `username` stays UNIQUE and always-present — it's the internal handle, distinct
    from the phone/email *contact/login* identifiers.
- **Enrollment validation:** require **≥1** of phone/email (phone no longer
  mandatory); validate + normalize phone to E.164; validate email; pre-check for
  duplicates and let the DB UNIQUE catch races. This is where the `123456789`
  pattern stops being created.
- **Login resolver:** exact-match on canonical phone (not suffix `LIKE`); **if >1
  row matches, REFUSE** — return the generic `Invalid credentials`, audit
  `reason: "ambiguous_identifier"`, never pick one. Keep the >1-refuse even after
  `UNIQUE(phoneNumber)` makes >1 impossible — defense in depth. The email/username
  resolvers already exact-match on unique columns.

### OTP channel selection (one / other / both)
Today the channel is tied to the **identifier type used** (phone→SMS, email/
username→email), not to what the account actually has — so a username login for a
patient with only a phone tries email → `sendOtpEmail(user.email=null)` → fails.
New rule: derive the channel from the **resolved user's available contact**:
- only phone → SMS; only email → email (regardless of how they identified);
- both present → default to the channel matching the login identifier (phone-login
  → SMS, email-login → email), or a stored per-user preference;
- none → impossible under the new CHECK (and no longer the current 500).

### The ten `123456789` accounts under the new constraint
A `UNIQUE` index is **retroactive** — the migration **fails to create the index
while duplicates exist**, so there is **no "enforce going forward only."** They must
be cleaned up **first**:
- They're test accounts and each already has a UNIQUE email → **set their fake
  `phoneNumber` to NULL** (email remains as identity → satisfies the CHECK), or give
  a real number where one is genuinely needed for SMS login.
- **Sequence:** (1) clean up the 10 on prod (NULL the fake phones / set real);
  (2) normalize all existing phones to E.164; (3) migration: `email` nullable +
  `UNIQUE(phoneNumber)` + `CHECK(at least one)`; (4) ship the enrollment validation
  + the exact-match/ambiguity-refusing resolver + the OTP-channel change. Steps 1–2
  are a hard prerequisite — the constraint cannot ship over the duplicates.

The security core is step (4)'s **ambiguity rejection**; the rest (unique phone,
E.164, at-least-one) removes the conditions that make ambiguity possible.
