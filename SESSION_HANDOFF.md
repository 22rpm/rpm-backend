# 22RPM — Session Handoff
Last updated 20 Aug 2026. Replaces the 19 Aug version.

## Who / what
Ricky Torres, founder/CEO, 22RPM (Twenty Two Health LLC). ~13 patients, targeting 100.
I orchestrate AI tools rather than write code. Give exact commands, one thing at a
time, with a checkpoint after each. Tell me the file and line numbers. When something
breaks, ask me to check the browser console or backend terminal rather than guessing.
I scope tightly, defer decisions to the right owner, and want evidence before I trust
a result. Design before building; propose schemas before writing them.

## Repos and environments
GitHub org "22rpm", cloned to ~/dev/22rpm-prod/:
  rpm-backend, rpm-dashboard-v1.0, rpm-ios-app, 22-rpm-android-app

Local: MySQL db rpm_db_v1 (this is the real dev DB — .env DB_NAME=rpm_db_v1),
  root password Bigrick94.
  Backend:  cd ~/dev/22rpm-prod/rpm-backend && npm start          (port 4000)
  Frontend: cd ~/dev/22rpm-prod/rpm-dashboard-v1.0 && npm run dev (port 5174)
  `npx knex migrate:latest` now works again locally (see Migration state).
  A THIRD local DB `rpm_db` still exists — stale, no migration tracking, a footgun.
  See MIGRATION_FOLLOWUPS.md; decide whether to drop it.

Production: EC2 50.18.96.20, accessed via AWS Console -> EC2 Instance Connect.
  App path: /home/ubuntu/22-rpm/rpm-backend  (and rpm-dashboard-v1.0)
  Database: rpm_db, reachable as: mysql -u root -proot -h 127.0.0.1 rpm_db
  (127.0.0.1 matters — socket auth fails)
  Processes: pm2, "rpm-backend" and "rpm-frontend". Also DL_AdminPanel_* on the same box.
  Production also runs the FRONTEND via Vite dev server — raw .jsx source is public.
  No EC2 snapshots, no database backups. mysqldump before ANY migration.

## Branch topology (all three are pushed to origin and current)
- **main** — the clean base. Carries the reconciled 45-migration directory, the
  knexfile fix, the deployed hotfix line, and the meta-docs. Fork new work from here.
- **feature/care-activity** (rpm-backend) — the entire care-activity + RPM-note
  backend, 17 commits ahead of main. NOT merged, NOT deployed.
- **feature/org-context** (rpm-dashboard-v1.0) — the whole current dashboard
  (enrollment, worklist, edit, clinic context, RPM-note UI). NOT deployed.
  NOTE: there is also a STALE backend branch named feature/org-context — ignore it;
  the real org-context work is the frontend one. (Superseded backend branch; delete
  candidate, held pending confirmation.)
The backend feature branch and the frontend feature branch are PAIRED — the UI calls
endpoints that only exist on feature/care-activity.

## DEPLOYED to production
### 20 Aug
- **BP ingest classifier fix.** deviceData.service.js `calculateBPStatus` had
  `sVal > 140 || dVal > 99`, so 140/95 (Stage 2 HTN) stored as "Normal" and NaN
  defaulted to "Normal" — those readings generated NO alert. Fixed to standard
  boundaries (>=180/>=120 Emergency, >=140/>=90 High, <90/<60 Low; malformed ->
  "Error", excluded from the clinical alert gate). Cherry-picked to the box as
  2fb21d1, pm2 restart, verified live: 140/95 -> "High" + alert with 2 recipients.
  The same fix is on origin/main as b257b17 — main and prod agree on that file
  (verified byte-identical). A read-only backfill audit across the patient roster
  (no rows mutated) confirmed the misclassification scope before the fix.
### 19 Aug (unchanged from prior handoff)
- Unauthenticated admin routes fixed (401/403). orgScope middleware, requireRole.
- Audit logging (audit_log). Login rewrite: OTP on every untrusted device, real
  device fingerprints, 60-day trust, Twilio SMS OTP. UNIQUE on role.user_id and
  users.username. CORS -> api.twentytwohealth.com exact-match. Login.jsx uses
  server requiresOtp. Prod email -> info@twentytwohealth.com. Migrations to 32.

## BUILT but NOT deployed (on the two feature branches, pushed to origin)
The RPM monthly-note generator, end to end, plus its dependencies:
- **Care-activity schema + endpoints**: time_entries (manual + timer), patient_calls,
  clinical_notes, insurance/device/profile/condition/device/consent/setup/billing
  tables; transactional enrollment; enrollment-options; org-scoped worklist;
  GET/PATCH patient edit; GET /api/org/me.
- **RPM note pre-fill**: GET /api/patients/:id/rpm-note?month=YYYY-MM — server-computes
  everything we have (demographics incl. MRN, provider, consent, devices, 99453
  education, distinct transmission days, BP/HR summary, time split, call log), applies
  the billing rules, and reports which CPT codes the data supports. Never fills
  clinical judgment. Verified: John Smith (user 48) 5 days -> 99445, 39 min;
  Bob Reyes (user 50) nothing monitored but 99453 from setup.
- **Confirmed billing rules** (config/rpmBillingRules.js — biller signed off; CONFIG
  not code): calendar-month period; device supply 0-1 not billable / 2-15 -> 99445 /
  16+ -> 99454; 99453 once per patient per device type, INDEPENDENT of transmission
  days; management 20 -> 99457, +20 -> 99458; **99457 is TWO tests** (20+ min AND >=1
  live interactive communication — data review alone doesn't count); month-end DOS;
  single-provider assumption (flags if >1); time-bucket split.
- **rpm_notes** (migration 20260822120000, batch 8): append-only signed-note ledger
  (same pattern as time_entries/clinical_notes). Frozen content snapshot, signature
  record (who/role/when/ip/ua), reproducible content_hash anchored into audit_log in
  the SAME transaction, generated head_key enforcing one root per patient+month,
  nullable document_key/document_sha256 for the future PDF. POST /rpm-note/sign,
  GET /rpm-note/signed (returns hash_valid + billing_snapshot).
- **MRN** on patient_profiles (migration 20260821120000, batch 7), nullable, captured
  at enrollment + edit.
- **Dashboard**: Quantix-faithful note UI (components/rpmNote/) — 10 sections in
  template order, pre-filled, provider fields blank, e-sign, "Save as PDF / Print"
  via the browser print pipeline; a **divergence banner** that flags over-claim /
  under-claim when a signed note's frozen codes no longer match current data;
  enrollment "Setup / education date" field (defaults from enrolled_at, drives 99453
  DOS); worklist FileText action opens the note.
- **Migration reconciliation** (already on main): feature branches had each authored
  migrations against the shared dev DB but were never unified, so migrate:latest
  failed "directory corrupt". main now carries the full applied set (45 files), a
  knexfile fix (development reads DB_NAME again; was hardcoded to the stale rpm_db),
  and a `scratch` env for pre-prod replay verification.

## Migration state
- Local rpm_db_v1 is on batch 8. mrn = batch 7, rpm_notes = batch 8. These two, plus
  the 12 care-activity migrations, are applied LOCALLY ONLY — prod is still on 32.
- Deploying the care-activity backend to prod means running its migrations there.
  Prod has no backups: use the `scratch` env dress rehearsal first (create an empty
  schema, `npx knex migrate:latest --env scratch`, mysqldump --no-data diff vs the
  target, drop it), then mysqldump prod, then migrate. See MIGRATION_FOLLOWUPS.md.

## Blocked on whom (three pending external answers)
- **Compliance** — (1) is e-signature acceptable, or is a wet/Acrobat signature
  required, and (2) the exact attestation wording. The note uses the Quantix
  template's OWN attestation text verbatim, kept in config marked `pending` so it
  swaps without touching the PDF layout. rpm_notes stores either outcome
  (signature_method enum, document_key for an uploaded artifact).
- **Medical director (via Ricky)** — the alert threshold values. doctor_alert_settings
  exists but is INERT (see landmines); the consolidation is designed, not built, and
  needs real thresholds. Ricky owns getting these.
- **Husnain** — S3 / PHI-document storage. Blocks persisting the rendered note PDF;
  rpm_notes.document_key is nullable and ready to backfill once storage exists.
- **Biller** — nothing further. All RPM billing rules are confirmed (incl. 99445
  short-period as 2-15 days). The earlier "99445 spec sent to Husnain" item is closed.
- patient_calls.outcome — DONE, not a TODO any more. The constrained set shipped
  (`config/callOutcomes.js`, case-sensitive CHECK, migration `20260823120000`),
  `rpmBillingRules.js` `detection: "outcome"` (99457 test-(b) is now AUTOMATIC —
  Reached patient/caregiver qualifies), and the call form is a required select.
  Remaining: the server-side NULL gap (API/CHECK still permit NULL) — see
  `BILLING_FOLLOWUPS.md` §9. A NULL outcome renders "test (b) NOT DETERMINED —
  outcome not recorded" (missing evidence), never "FAILED".

## Known landmines
- **Second BP classifier still buggy.** The ingest classifier is fixed/deployed, but
  determineTypeForClinician (deviceData.service.js) still uses the old bands and
  labels 140/95 severity "low". doctor_alert_settings is INERT — the alert-routing
  join reads it but never applies the values, so it only ever REDUCES alerting, never
  enforces a threshold. Consolidation into one evaluator is designed
  (SECURITY_FOLLOWUPS #7/#8), not built. Prod has 0 doctor_alert_settings rows, so the
  table can be reshaped freely.
- **Production working tree drifts from git.** server.js had an uncommitted CORS edit
  nobody recorded. Check `git status` on the box before any deploy.
- **No EC2 snapshots, no DB backups.** mysqldump before any migration. The `scratch`
  env replay is the dress rehearsal; prod should only see a migrate whose effect
  you've already reproduced.
- **TIMEZONE BUG:** timestamps written as local time into tz-naive columns, serialized
  as UTC. 11:15 PM Pacific shows as 4:15 PM. Affects BP readings. Prod tz not checked.
  (The new endpoints use DATE_FORMAT on DATE columns to dodge the date-shift, but the
  underlying timestamp bug is unaddressed.) Establish what each env stores before fixing.
- **POST /api/dev-data/devices/:devId/store has NO auth** — anyone can inject vitals
  for any device.
- **PatientModal.jsx** is ~5,200 lines with ~1,700 commented out and two handleExport
  functions. Filter commented lines when grepping.
- Stale `rpm_db` database + a duplicate alert-read-status migration (062942 doesn't
  return a promise) — both in MIGRATION_FOLLOWUPS.md, neither fixed.
- rpm-dashboard-v1.0 has 128 Dependabot vulnerabilities (4 critical).

## Credentials to rotate (all exposed)
- Twilio auth token (in both .env files)
- Production MySQL root: root/root, in /home/ubuntu/22-rpm/rpm-backend/.env
- Wajahat's GitHub PAT — removed from the box's git remote, but STILL LIVE on his
  account. Only he can revoke it. Not yet contacted.

## Open work / next
- **Deploy the pair** (feature/care-activity + feature/org-context) once the compliance
  answer lands — migration dress rehearsal first (no prod backups).
- Build the alert-threshold consolidation once the medical director's numbers arrive:
  one BP evaluator, retire the inert doctor_alert_settings, fold in
  determineTypeForClinician. Design in SECURITY_FOLLOWUPS #7/#8 + ALERT_THRESHOLD_DESIGN.md.
- Wire note-PDF persistence to storage once Husnain answers (document_key ready).
- Care-activity Part 3 (start/stop timer — designed, not built) and Part 6 (timeline).
- Everything verified against ONE organization. Seed a second org before trusting the
  cross-clinic protections.
- iOS app hardcodes rmtrpm.duckdns.org — breaks if that domain is retired.
- No Security Risk Analysis on file. Standing legal violation. Highest-value item.

## Session close — 21 Aug 2026, ~1am

### Completed tonight
- MIGRATION RECONCILIATION. main is now the clean 45-file base. Proven by a
  scratch-schema replay: created an empty database, ran all 45 migrations, and
  diffed the result against rpm_db_v1. Only difference was redundant FK-backing
  indexes MySQL creates on existing tables but not fresh ones — benign. The MRN
  migration's ALTER genuinely executed for the first time. knex migrate:latest
  works normally again. Use the "scratch" env in knexfile.js to repeat this
  before any production migration run.
- Caught two silent-revert risks: origin/main and feature/care-activity were both
  missing the BP classifier fix that's deployed to production. Found by comparing
  md5 hashes of deviceData.service.js, not by trusting reports. All now match
  prod at 37e5fb634d2c6d46ccdeb0a32258e246.
- ALL BILLING RULES CONFIRMED (see BILLING_FOLLOWUPS.md and RPM_NOTE_POLICY.md).
- RPM NOTE GENERATOR built and verified working end to end.

### Confirmed billing rules — no longer pending
Period: calendar month (Medicare 2026 reporting preference).
Device supply by distinct transmission days: 0-1 not billable, 2-15 -> 99445,
16+ -> 99454. Both reimburse $52.11.
Management by minutes: 10-19 -> 99470 ($26.05), 20-39 -> 99457 ($51.77),
40+ -> 99457 + 99458 units ($41.42 each, no cap).
99453 setup ($21.71) once per patient per device type, INDEPENDENT of
transmission days.
Date of service: the date each threshold was met, per code — not month-end.
99457 is TWO independent tests: 20+ minutes AND at least one live interactive
communication. Data review alone does not qualify.
E-signature confirmed acceptable — it's how providers already sign.
Attestation wording: Quantix template text, verbatim, still pending compliance.

### Alert thresholds — confirmed, built, NOT deployed
Classification from AHA, urgent line from Quantix template section 8.
On branch feature/bp-evaluator, deliberately separate so it deploys as a
conscious change: it REDUCES paging. Production today pages on everything
>=140/90. Under the new evaluator, 140-160/90-100 flags but does not page.
That's the intended fix for alert fatigue, but anyone relying on those pages
should be told before it ships.
OPEN: hypotension threshold. AHA covers only hypertension. The evaluator
currently pages on <90/<60, preserving today's behavior, pending a decision
from the medical director.

### Where I stopped
Reviewing John Smith's generated RPM note in the browser. It renders correctly —
Quantix template reproduced faithfully, BP range 113/72 to 157/98, average
135/84, 5 transmission days, 39 minutes, clinical sections correctly blank with
a "provider" badge, and the month's call log shown as read-only reference.
Had not yet scrolled to the billing determination and signature sections. Expect
99445 (5 days) and 99457 (39 min), with the interactive-communication test
FAILING because the outcome migration nulled the ambiguous "reached" values.

### Still open
- Husnain: S3/PHI document storage. Blocks PDF persistence. rpm_notes.document_key
  is nullable and ready.
- Medical director: hypotension paging threshold.
- Me: rotate Twilio and MySQL root credentials; Wajahat's GitHub PAT still live
  on his account.
- Deferred by choice: ICD-10 codes, place of service, provider NPI — schemas
  proposed in BILLING_FOLLOWUPS.md, not built. Without them the note is not a
  submittable claim on its own; the biller adds the diagnosis code.
- Branch deletions, deliberately held. Retirement list in the branch audit.
- NOTHING from this week is deployed. Production is on 32 migrations; the
  care-activity set is 13 migrations and a large body of code away from live.

### Read these alongside this file
SECURITY_FOLLOWUPS.md, BILLING_FOLLOWUPS.md, MIGRATION_FOLLOWUPS.md,
FRONTEND_FOLLOWUPS.md, CARE_ACTIVITY_NOTES.md, RPM_NOTE_POLICY.md,
ALERT_THRESHOLD_DESIGN.md, BRANCH_REVIEW_2026-08-17.md
