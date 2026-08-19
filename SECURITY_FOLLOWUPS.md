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
