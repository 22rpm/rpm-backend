# 22RPM — Session Handoff
Last updated 19 Aug 2026. Replaces the 15 Aug version.

## Who / what
Ricky Torres, founder/CEO, 22RPM (Twenty Two Health LLC). ~12 patients, targeting 100.
I orchestrate AI tools rather than write code. Give exact commands, one thing at a
time, with a checkpoint after each. Tell me the file and line numbers. When something
breaks, ask me to check the browser console or backend terminal rather than guessing.

## Repos and environments
GitHub org "22rpm", cloned to ~/dev/22rpm-prod/:
  rpm-backend, rpm-dashboard-v1.0, rpm-ios-app, 22-rpm-android-app

Local: MySQL db rpm_db_v1, root password Bigrick94.
  Backend:  cd ~/dev/22rpm-prod/rpm-backend && npm start        (port 4000)
  Frontend: cd ~/dev/22rpm-prod/rpm-dashboard-v1.0 && npm run dev  (port 5174)

Production: EC2 50.18.96.20, accessed via AWS Console -> EC2 Instance Connect.
  App path: /home/ubuntu/22-rpm/rpm-backend  (and rpm-dashboard-v1.0)
  Database: rpm_db, reachable as: mysql -u root -proot -h 127.0.0.1 rpm_db
  (127.0.0.1 matters — socket auth fails)
  Processes: pm2, "rpm-backend" and "rpm-frontend". Also DL_AdminPanel_* on the same box.
  Production also runs the FRONTEND via Vite dev server — raw .jsx source is public.

## DEPLOYED to production, 19 Aug
- Unauthenticated admin routes fixed. PUT/PATCH/DELETE /api/admin/users/:userId and
  org.routes.js now return 401 unauthenticated, 403 for wrong role. Verified with curl.
- middleware/orgScope.js (resolveOrgScope, scopePatientParam), requireRole
- Audit logging (audit_log table, login success/failure instrumented)
- Login rewritten: OTP required on every untrusted device (the old
  method:"username" bypass is closed), real server-derived device fingerprints,
  60-day device trust, SMS OTP via Twilio for phone identifiers
- UNIQUE constraints on role.user_id and users.username
- CORS switched to api.twentytwohealth.com, exact-match only
- Login.jsx now branches on the server's requiresOtp instead of the client's guess
- Production email moved from Wajahat's personal Gmail to info@twentytwohealth.com
- Migrations 29-32 applied (prod was on 1-28, now on 32)

## NOT deployed — pushed but local only
feature/care-activity (rpm-backend): clinical time ledger, call documentation,
  clinical notes, staff-name endpoint, transactional patient enrollment, and 12
  migrations (20260817*, 20260818*). All verified with curl locally.
feature/org-context (rpm-dashboard-v1.0): org selector, fetch interceptor,
  super-admin routing, patient activity UI. Verified locally.
These two are PAIRED — the UI calls endpoints that only exist on the backend branch.

## Known landmines
- Production's working tree drifted from git: server.js had an uncommitted CORS edit
  nobody recorded. Assume more drift is possible. Check git status on the box before
  any deploy.
- Migration files are fragmented across branches. Always run knex migrate:list before
  migrate:latest and confirm only the intended files are pending.
- calculateBPStatus is defined in three places; one returns "High" for normal readings.
  Production has 62 alerts. Possible alert fatigue / patient safety issue.
- TIMEZONE BUG: timestamps are written as local time into columns with no timezone
  info, then serialized as if UTC. A record created 11:15 PM Pacific displays as
  4:15 PM. Affects BP readings. Production's timezone has NOT been checked. Do not
  attempt a fix before establishing what each environment stores.
- PatientModal.jsx is 5,232 lines with ~1,700 commented out and two handleExport
  functions. Filter commented lines when grepping.
- No EC2 snapshots, no database backups. Take a mysqldump before any migration.
- rpm-dashboard-v1.0 has 128 Dependabot vulnerabilities (4 critical).
- POST /api/dev-data/devices/:devId/store has no authentication — anyone can inject
  vital signs for any device.

## Credentials to rotate (all exposed)
- Twilio auth token (in both .env files)
- Production MySQL root: root/root, in /home/ubuntu/22-rpm/rpm-backend/.env
- Wajahat's GitHub PAT — removed from the box's git remote, but STILL LIVE on his
  account. Only he can revoke it. Not yet contacted.

## Open work
- Deploy feature/care-activity + feature/org-context together
- Part 3 of care activity: the start/stop timer (backend design agreed, not built)
- Part 6: full activity timeline
- Patient enrollment FORM (endpoint exists, no UI)
- Patient worklist rebuild (schema landed, UI not built)
- Billing engine: three independent tests — 20+ min, 1+ live interactive
  communication, and transmission-day count. Not started.
- 99445 short-duration device supply code — spec sent to Husnain
- Everything verified against ONE organization only. Seed a second org before trusting
  the cross-clinic protections.
- iOS app hardcodes rmtrpm.duckdns.org — breaks if that domain is retired
- No Security Risk Analysis on file. Standing legal violation. Highest-value item.
