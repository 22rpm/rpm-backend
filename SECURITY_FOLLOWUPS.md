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

## 7/8 consolidation — BUILT on `feature/bp-evaluator` (`4166892`), not yet deployed
One evaluator (`services/bpClassifier.js`) that both display and alerting call.
Confirmed thresholds (medical director + Quantix §8): classification AHA
(Normal/Elevated/Stage 1/Stage 2/Crisis, + Low, + Error); paging separate —
Crisis→emergency, SBP>160 OR DBP>100→urgent (strict >), Stage 1/2 at/below
160/100 flag but don't page, Error/Normal/Elevated→none. Folded in
`determineTypeForClinician` and the dead module-level `calculateBPStatus`;
retired `doctor_alert_settings` (4 vestigial LEFT JOINs dropped). Unit-tested
16/16. **Deploy as its OWN change** — the 140-160/90-100 band moves from paging
to flag-only (the alert-fatigue fix), so anyone relying on those pages must know
first.

**Open — for the medical director:**
- **Hypotension threshold.** AHA's categories only cover HYPERTENSION, so <90/<60
  is an open clinical question. The evaluator currently classifies it "Low" and
  **pages** (preserving today's behavior) pending the MD's decision on whether/at
  what threshold low BP should page. Add to the MD threshold list alongside the
  hypertension thresholds.
- **Per-patient overrides (§3.5).** The evaluator accepts a per-patient override
  of the URGENT paging line (never the AHA classification); no store/UI exists yet
  and nobody configures them. Wire when the MD wants per-patient thresholds — this
  replaces the retired `doctor_alert_settings` control cleanly.

## Other BP paths — audit for the evaluator (fast-follow)
The consolidation covered the primary ingest (`createDeviceDataService`). Audit
`triggerBPAlert`, `createBPDataService`, and `saveGenericDeviceDataService` in
`deviceData.service.js` to route through `bpClassifier` too, so no path keeps its
own thresholds or the old status vocabulary.

## 9. `bpClassifier` is now COPIED into the frontend — #7 can re-diverge across repos — OPEN
- The vitals rebuild (`feature/vitals-rebuild`, rpm-dashboard) colors readings by
  classification, and the frontend cannot import the backend module — so
  `services/bpClassifier.js` was COPIED to
  `rpm-dashboard-v1.0/src/utils/bpClassifier.js` (ESM, from `4166892`). It is
  correct today and it is byte-for-byte the canonical bands.
- **Why this is a #7 landmine, not just a copy:** thresholds are still MOVING —
  the hypotension (`<90/<60`) paging line is open with the medical director, and
  CMS bands change. When someone edits the backend `bpClassifier` and forgets the
  frontend copy, DISPLAY silently keeps the old bands while ALERTING uses the new
  ones — the exact display-vs-alerting divergence of #7, now split ACROSS REPOS
  where it is harder to spot (no shared file, no import to grep).
- **Rule until resolved: anyone changing BP thresholds must change BOTH**
  `rpm-backend/services/bpClassifier.js` AND
  `rpm-dashboard-v1.0/src/utils/bpClassifier.js`. The header comment in each names
  the other, but a comment is documentation, not enforcement.
- **Resolution (pick one), so the copy stops being trust-based:**
  1. Backend serves the classification WITH the readings (device-data returns each
     reading's `bpClassifier` result), and the frontend colors by that value —
     one classifier, no frontend copy. Preferred; also removes the deploy-
     sequencing caveat (frontend correct only after the value ships).
  2. A CI check that fails when the two files diverge (diff the copied region
     against the canonical, or generate the frontend copy from the backend at
     build time). Keeps the copy but makes drift loud instead of silent.
