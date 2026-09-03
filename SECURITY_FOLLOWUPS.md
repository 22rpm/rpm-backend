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

## 5. Production working tree drifts from git — process, not code (NOW THREE TIMES)
- **Occurrence 1 (2026-08-19, backend):** during deploy prep the box's `server.js`
  was found to carry an uncommitted, load-bearing CORS change (origins pointed at
  `api.twentytwohealth.com`) that existed nowhere in git. Deploying `main` as-is
  would have silently reverted it and broken the dashboard for every user. The
  change has since been brought into `main` (`e9d9901`).
- **Occurrence 2 (2026-09-02, dashboard):** during dashboard deploy prep, the prod
  box's `src/pages/VitalSigns.jsx` carried an uncommitted hot patch to
  `handleExport` (fixing it to pass its arguments) — a working export on prod that
  existed nowhere in git. Discarded during this deploy because
  `feature/vitals-integrated` supersedes it (its export path is already correct),
  so nothing was lost — but only by luck of the superseding branch. Any deploy of a
  branch that predated the fix would have silently regressed a working export.
- **Occurrence 3 (2026-09-02, dashboard):** during the dashboard deploy, `npm ci`
  produced a tree missing `react-is`, which `recharts` imports — the app broke
  until `react-is` was `npm install`ed directly on the box, leaving `package.json`
  and `package-lock.json` uncommitted. Slightly different in kind from 1 and 2
  (a missing DECLARED dependency, not a hand-edited source fix), but the same drift
  shape: an uncommitted change the deploy needed, that a clean checkout would lose.
  **Root-fixed:** `react-is@^19.x` is now a direct dependency (committed), so a
  clean checkout installs it and this specific break can't recur.
- **This is now a pattern, not a one-off — three times across both repos.** Twice a
  real, load-bearing source fix was applied directly to prod and left outside git
  (CORS, export); once a required dependency was installed on the box and left
  uncommitted. Each time the deployed state was non-reproducible from git and a
  clean checkout would have regressed.
- Infrastructure/process issue, not a code defect. For Husnain: production must be
  deployed only from committed refs, with no manual edits on the box; a hotfix or a
  dependency added on the box must be committed and pushed the same day. The
  pre-deploy `git status` gate that refuses to deploy on a dirty tree is no longer
  optional — three occurrences across two repos is the evidence it's needed. A
  clean-room deploy check (`npm ci` from the committed lock on a fresh clone, build,
  smoke test) would have caught occurrence 3 before it hit prod.

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

## 9. Settings change silently degraded a user's permissions until re-login — FIXED (3a15ab9)

**Access-control defect, not just a token bug.** `controllers/settings.controller.js`
re-signed the session token after any profile/settings update, but built the
payload as `{ id, name, username, email, role: decoded.role }` — and tokens are
signed by `issueSession` with **`role_type`**, not `role`. So `decoded.role` was
**undefined**, and the new token **also dropped `org_id` entirely** (issueSession
includes it).

**What it affected:** after a user changed any setting, their cookie was replaced
with a token carrying **no `role_type` and no `org_id`**. From that point until
they logged out and back in:
- `requireRole` (`middleware/auth.js`) reads `req.user.role_type` → undefined →
  **403 on every role-gated route** (enroll, worklist, note, sign, care activity,
  admin, org).
- `resolveOrgScope` (`middleware/orgScope.js`) locks non-super-admins to
  `req.user.org_id` → missing → **403 / no org scope**, so they can't see their
  own org's patients.

Net: a clinician or admin who edited their profile silently lost access to the
app's gated functionality — permissions degraded to near-nothing — with no error
explaining why, recoverable only by re-login. Latent because settings changes are
infrequent and re-login masks it.

**Fix:** re-sign matching `issueSession` — `role_type` + `org_id` (+ phoneNumber).
Found during the role-model scoping. Reinforces the standing inconsistency that
tokens carry `role_type` while response bodies use `role` (also the dead socket
gate — see ALERT_FOLLOWUPS #1 note).

## 10. Session cookie not stored over local http — FIXED (2ef398c), was unmerged until now

**Symptom:** login succeeds but no auth cookie persists on the iOS app against a
local **http** backend — `authRequired` logs `Available cookies: []` on every
subsequent call, so everything 401s. Diagnosed from scratch **twice** before it
was noticed that the fix already existed.

**Cause:** `issueSession` set the auth cookies `secure:true; sameSite:none`
(hardcoded), so a plain-http client (LAN dev, e.g. `http://192.168.1.x:4000`)
drops them at store time — nothing to send back. Compounded by a clean reinstall
(e.g. after a LAN IP change) wiping the previously-stored cookie. `logout` also
cleared with `sameSite:strict`, mismatching the `none` it was set with, so logout
could leave a live session cookie (prod bug).

**Fix — `2ef398c` on branch `fix/cookie-secure-conditional`:** a single
`sessionCookieFlags()` helper used by BOTH set and clear;
`secure = ALLOW_INSECURE_COOKIES !== "true"` (fail-secure opt-in, prod
byte-identical), `sameSite = secure ? "none" : "lax"` (None requires Secure). Set
`ALLOW_INSECURE_COOKIES=true` in the dev `.env` for local http.

**Where it lives / how to stop re-diagnosing it:** the fix was on its own branch
and **never merged into `feature/care-activity`**, so `ALLOW_INSECURE_COOKIES`
read as dead code there and it looked unfixed. Now **merged into
`feature/care-activity`**. If you branch for local http testing off anything that
predates the merge, cherry-pick/merge `2ef398c` — the `.env` var does nothing
without it. Any branch where `grep -r ALLOW_INSECURE_COOKIES controllers/` is
empty does NOT have the fix.

**Related open question (see below / ALERT_FOLLOWUPS):** `authRequired` reads only
`req.cookies.token` and ignores the `Authorization: Bearer` header the app also
sends, so there is no fallback when the cookie is absent. Whether to accept either
is a deliberate decision, not yet made.

## 11. `authRequired` accepts only the cookie, ignoring the Bearer header the app sends — decide + unify (not blocking)

**The inconsistency:** two auth middlewares evolved separately.
- `authRequired` (`middleware/auth.js`) reads **only** `req.cookies.token`. It's on
  essentially every route (doctor, patient, alerts, medications, auth/check-me, …).
- `authMiddleware` reads **only** `Authorization: Bearer` and its own comment says
  it's "being used in live chat messageService" — added for one feature, never
  generalized.

The iOS app sends **both** a cookie (`credentials:'include'`) and
`Authorization: Bearer <token>` (the login-body token, stored in AsyncStorage). So
the client clearly expects Bearer to work, but for `authRequired` routes the server
ignores it — meaning there is **no fallback** when the cookie is absent. That's why
the cookie-over-http failure (#10) was total rather than degraded.

**Not intentional — drift**, not a designed scheme.

**Recommendation (reasoning captured for later scoping):** accept **cookie first,
Bearer fallback** in a single unified `authRequired`, and collapse `authMiddleware`
into it.
- **Mobile robustness:** a Bearer fallback makes the whole cookie-over-http
  fragility (the #10 class of bug) non-fatal for the app. Native cookie stores are
  finicky; Bearer is the normal mobile path, and the plumbing already exists (the
  app stores + sends the token) — only the server ignores it.
- **Dashboard stays cookie-only:** the web client keeps the httpOnly cookie and must
  **not** start storing tokens in JS (XSS exposure). Accepting Bearer on the server
  doesn't force the web to use it; the dashboard simply won't send one.
- **Mobile posture unchanged:** the app already keeps the token in AsyncStorage, so
  honoring Bearer there doesn't weaken a protection it still holds.
- Keep `sameSite` on the cookie for the cookie path's CSRF protection.

**Why deferred:** not blocking anything — #10 fixed the cookie path, so auth works
today. This is a robustness + consistency improvement. **Scope as its own reviewed
unit** (like the role-model units): audit every route's middleware (`authRequired`
vs `authMiddleware`), define one middleware that accepts cookie-or-Bearer, confirm
refresh/TTL works on the header path, and decide the web dashboard's stance
explicitly. Cross-ref #10.

## 12. Inbound patient SMS replies were silently DISCARDED — FIXED
- The Twilio inbound webhook (`controllers/notification.controller.js` `smsInbound`)
  handled STOP/START/HELP keywords and dropped everything else. A patient who
  texted back anything real — "my BP was high this morning", "I don't understand
  the reminder", "please call me" — reached the server (received, signature-
  verified) and **vanished**. `notification_log` was outbound-only, so there was
  nowhere for it to land and nowhere a clinician could see it. A patient was
  texting into silence, and nobody knew because nothing recorded the loss.
- **Impact:** clinical/safety — a patient could report a symptom or a problem by
  reply and no one would ever see it. It also silently undercut the "your care
  team will review this" acknowledgement that was (correctly) held.
- **Found:** 2026-09-03, scoping the inbound-SMS work. It had been live since the
  notification webhook shipped.
- **Fix (this change):** added `direction`/`acknowledged_at`/`acknowledged_by` to
  `notification_log`; the webhook now STORES non-keyword replies as inbound rows;
  the Notifications tab shows the thread both ways; and the patient list carries a
  "reply waiting" badge (unacknowledged inbound) so a reply isn't buried in a tab
  nobody opens. Keyword handling (STOP/START/HELP) is unchanged.
- **Not covered (see the aging question / follow-ups):** an *unanswered* reply
  doesn't yet escalate beyond the badge, and a clinician still can't send a
  free-text SMS reply back (only templates). Unknown-number inbound is logged and
  dropped (notification_log.patient_id is NOT NULL) rather than kept in a catch table.

## 13. Session cookies + JWTs logged in plaintext — RE-LEAKED on this branch via a branch-cut gap, re-redacted; plus a NEW plaintext-password leak
The socket-auth handshake dump printed **full session cookies in plaintext** to the
prod pm2 `out` log on every socket connection — `token=` and `refresh_token=` JWTs.
The decoded payload carries **name, email, phone, role_type, org_id**, so anyone
with box/log access could lift a live session and impersonate that user. The leaked
token observed was for **user 1 — now super-admin with cross-org PHI access across
every clinic**, so this is the highest-blast-radius session on the system.

**Why it came back:** this exact leak was fixed once in `1eb41cd`
("Redact session cookies/JWTs from logs"), but that commit lives on
`fix/device-upsert-idempotent` / `feature/apple-review-bypass` / `fix/messages-e2e`
and is **NOT an ancestor of `feature/care-activity`** — the branch was cut before
the fix, so the fix never merged in. This is the recurring branch-cut process
defect (see #5): a security fix on a sibling branch silently absent from the active
branch. The redaction didn't "not survive a merge" — there was no merge.

**Value-leak sites on this branch, now re-redacted to booleans/ids:**
- `socket/socketServer.js:234-235` — `socket.handshake.headers` (cookie header) and
  `socket.handshake.query` (query `token`) → now logs which auth source is present.
  This is the line producing the reported pm2 leak.
- `server.js:305-306` (`/rpm-be/test-socket`) — `req.headers.cookie` and full
  `req.headers` → `Cookie present: <bool>`.
- `controllers/settings.controller.js:20` — `console.log("Decoded token:", decoded)`
  (whole JWT payload) → `Token verified for user: <id>`.
- **NEW, not in `1eb41cd`'s scope — `controllers/organization.controller.js:416`**
  (`resetPassword`) logged the **generated plaintext password** and account email:
  `` `Password reset for ${email}. New password: ${newPassword}` `` → now logs a
  user id only. Worse than the JWTs in one respect: **a password has no expiry** —
  it is valid until the user changes it, whereas the access token dies in ~2h.
- Left as-is (not value leaks): `middleware/auth.js:113` logs cookie NAMES
  (`Object.keys(req.cookies)`); `server.js:245` logs the Twilio auth-token *length*
  (a number, for the env self-check), not any session value.

**Operational follow-ups (do these — the code fix doesn't undo the disclosure):**
- **Treat every token already in the logs as compromised until expiry.** Purge/rotate
  the affected pm2 `out` logs on prod (`pm2 flush`, and rotate any archived copies).
- The user-1 super-admin refresh token is the priority: its refresh window is long,
  so **invalidate existing sessions for user 1** (force re-login) rather than waiting
  it out — the access token expires in ~2h but the refresh token does not.
- Any account whose reset password passed through `resetPassword` while line 416 was
  live should be **reset again** — that cleartext password sat in the logs.
- Longer term: a redaction layer on the logger so header/cookie objects can never be
  logged whole, and fold #5's branch-cut discipline in so a security fix on one
  branch is reconciled onto all active branches.

### 13b. Reconciliation of the sibling branches — a SECOND redaction pass was also stranded
Triggered by 13's branch-cut discovery, we diffed the three siblings
(`fix/device-upsert-idempotent`, `feature/apple-review-bypass`, `fix/messages-e2e`)
against `feature/care-activity` (`git log --right-only --cherry-pick`). Findings:

- **`04e3f20` "Redact auth/user-service log leaks (2nd pass)" was ALSO not on this
  branch** — the same class as `1eb41cd`, stranded the same way. As a result
  `feature/care-activity` was **live-leaking, on every login**: the **plaintext OTP**
  (`services/mail.service.js:14`, `controllers/auth.controller.js:388`,
  `services/otp.service.js:22` dumping `otp_tokens` rows incl. `otp_code`), the
  **bcrypt password hash + email + phone** (`services/user.service.js:10,82` dumping
  the full user row), settings field **values** (`settings.controller.js:30`), and
  `req.user`/`patientRows` **PII dumps** (`admin.controller.js:236,272`,
  `messageController.js:75,114`). An OTP in the log lets anyone with log access
  complete a login during the OTP window; a bcrypt hash is offline-crackable.
  **All re-redacted on `feature/care-activity` in this pass** (ids/booleans only).
- The first sweep for 13 pattern-matched header/cookie/token/authorization and
  **missed the OTP/hash/row leaks** because those log lines say "OTP is" / `rows` /
  "Query result". Lesson: a leak sweep must grep for the *data* (otp, hash, password,
  `req.user`, row dumps), not just the transport words.
- **Not gaps (already correct here):** `1dd987e` (socket auth reading
  `decoded.role_type`) — `socketServer.js` already reads `decoded.role_type || decoded.role`;
  `723d984` (`getCliniciansByPatient` assigned+active+org scoping) — `messageService.js`
  already scopes (with an org-bounded orphan fallback). Reproduced independently on
  this branch, so no action.
- **Intentional divergence, NOT a fix to pull:** `9e75310`/`b54a683`/`862cccb` — the
  Apple-review OTP bypass (seeded user 44). Prod moved OFF `feature/apple-review-bypass`
  ONTO `feature/care-activity`, which does **not** carry the bypass — confirm the iOS
  review no longer depends on it before assuming that's fine.
- **Also stranded, non-security (data integrity):** `a21702a` (idempotent device
  upsert — a devices-table race could abort/lose a reading) and `5830953` (idempotent
  `dev_data` insert — a retry could duplicate a reading), documented in
  `DATA_INTEGRITY_FINDINGS.md`. Worth reconciling separately — they concern lost/dup
  clinical readings, not disclosure.

### 13c. Prevention — third time a branch-cut gap has cost real debugging
This is the **third** incident (see #5) where a fix on one branch was silently absent
from the active branch. The pattern is always: a fix lands on branch X; a feature
branch was cut before it (or from `main`); the fix never merges; it re-manifests in
prod. Concrete guardrails, cheapest first:
1. **Reconcile before every prod deploy.** Add to the deploy checklist:
   `for b in <all active branches>; do git log --right-only --cherry-pick --oneline HEAD...$b; done`
   and eyeball anything that looks like a fix/security commit not on HEAD. This diff
   is what caught 13b; it takes seconds.
2. **Security fixes go to a shared base, not a feature tip.** A redaction/authz fix
   should land on `main` (or the migration-reconcile base) and every active branch
   rebased/merged forward — never committed only onto whatever branch happened to be
   checked out. (Both `1eb41cd` and `04e3f20` were committed onto a sibling and never
   propagated.)
3. **Cut branches from the active branch, not `main`** (already a standing rule) —
   basing on `main` is exactly how the fix gets orphaned.
4. **A leak sweep greps for the data, not the transport** (see 13b) — `otp`, `hash`,
   `password`, `req.user`, whole-object/row dumps, not just `cookie`/`token`/`header`.

## 14. Prod cert SAN mismatch — RESOLVED, FALSE ALARM (no outage; do NOT reissue)
Raised HIGH on a code+cert prediction: the cert at `rmtrpm.duckdns.org` (50.18.96.20)
covers only `api.twentytwohealth.com`, and with the iOS app hardcoding `rmtrpm` under
strict ATS, every call should fail. **The nginx logs overturned it** — the iOS client
(CFNetwork) connected successfully throughout, including today. No outage; the SAN
observation is real but the live client tolerates it. Low ingest volume is expected
(one real patient, device `7C46598B`; the rest are test devices); June/July are
legitimate 99454, August (9 days) correctly not billable. **Do not reissue the cert.**
Lesson: verify a predicted client failure against real server/client evidence before
declaring an incident. Full record + resolution: **`INCIDENT_2026-09-03_prod-cert-san.md`**.
