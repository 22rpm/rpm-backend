# Review: hotfix/admin-routes-missing-auth
Reviewed 17 Aug 2026. Branch HEAD at review: de1fa4a (+ security fix commit).

## Verdict
As originally built, this branch did NOT fix the vulnerability it is named for.
It closed the unauthenticated hole and left an authenticated privilege-escalation
hole behind it. Fixed during this review and verified live.

## Scope of branch
1,428 insertions / 230 deletions across 18 files, 5 commits. Bundles three
concerns: org scoping, route auth, audit logging.

## Reviewed clean
- middleware/orgScope.js (124 lines, new). Fails closed throughout. Validates
  super-admin's organizationId against the DB. Ignores client-supplied org for
  non-super-admins. Returns 404 not 403 on cross-org access so record existence
  is not confirmed outside its clinic.
- middleware/auth.js requireRole. Reads req.user.role_type, consistent with orgScope.
- JWT chain verified: authRequired sets req.user = payload; auth.controller.js
  signs role_type and org_id at both live sites (login helper ~462, refresh ~1098).
  Field names match what the guards read.
- routes/org.routes.js. Every route has authRequired plus an explicit role guard.
  The one exception (doctors list, admin OR super-admin) is documented in-code.
- controllers/admin.controller.js getAllUsers. Correctly treats req.orgScope as
  authoritative.

## FINDING: authenticated privilege escalation (fixed)
routes/admin.routes.js gave these authRequired + resolveOrgScope, but no
requireRole and no scopePatientParam:
  PUT    /api/admin/users/:userId
  PATCH  /api/admin/users/:userId/status
  DELETE /api/admin/users/:userId
Handlers (admin.controller.js lines 70, 114, 141 — unchanged by the branch)
referenced neither req.orgScope nor req.user. resolveOrgScope was decorative:
it computed a value nothing read.

Impact: any authenticated user, including a patient, could update any user's
name/email/phone/status/PASSWORD (full account takeover of the super admin),
disable any account, or delete any user in any organization.

Note: deleteUser contained the comment "// Skip self-delete check for now
since no auth" — a temporary workaround that became permanent.

Also found and fixed: PUT and GET /api/admin/patients/:patientId/doctors had
no role guard. Any in-org authenticated user could reassign a patient's care
team, which drives alert routing.

## Fix applied
Chain is now authRequired -> requireRole -> resolveOrgScope ->
scopePatientParam("userId") -> handler. Added blockedSuperAdminTarget and
restored the self-delete guard.

## Verified live (local, port 4000)
Patient token (user 48, role_type patient, org_id 4) via curl:
  DELETE /api/admin/users/47              -> 403 insufficient role
  PATCH  /api/admin/users/47/status       -> 403
  PUT    /api/admin/users/47              -> 403
  PUT    /api/admin/patients/48/doctors   -> 403
  DELETE /api/admin/users/47 (no cookie)  -> 401
Not yet tested: admin cross-org target (expect 404), admin targeting
super-admin (expect 403), admin self-delete (expect 400).

## NOT reviewed — still unknown
- controllers/auth.controller.js (468 lines changed). Largest file in the diff.
  Contains the hand-restored functions. Login path; a defect here locks out all users.
- routes/alert.route.js (66), routes/doctor.routes.js (21),
  routes/deviceData.routes.js (9), controllers/drController.js (61),
  controllers/organization.controller.js (57), services/* (~300 lines total).

## Other findings (not fixed)
- POST /api/dev-data/devices/:devId/store has NO authentication. Anyone can
  inject fabricated vital signs for any device. Likely by design for device
  writes, but it is an integrity risk given alerts fire off readings.
- Leftover test/debug writers: POST /api/alerts/test-alert,
  /api/alerts/test/bp-alert, /api/dev-data/test/devices/data, POST /api/auth/
- production_schema.sql (324 lines) committed to the branch. Structure only,
  no data or credentials. Should not be in a code branch.
- authRequired does no device/session lookup; a stolen token works until
  expiry (45m). Server-side logout does not invalidate it.
- authMiddleware (live chat) is a second auth path not covered by these guards.
- Verbose console.log of cookie names and user ids on every authenticated request.

## Production log check (same day)
nginx retains 14 days (Aug 3-17). Only hits to the vulnerable paths were six
curl probes from 24.199.45.18 on 15 Aug against fake user id 999 — the same IP
browsed the dashboard in Safari on 7 Aug, i.e. own verification testing.
No evidence of unauthorized access within the retained window. Period before
Aug 3 cannot be assessed.
Also confirmed: production frontend serves raw .jsx source (Vite dev server).
