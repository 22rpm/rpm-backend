# Testing — state of the codebase

Recorded as a fact about the repo, not a criticism of any one change.

## There is no automated test suite

`npm test` is the default placeholder ("Error: no test specified"). There are no
unit tests, no integration tests, no route/contract tests, and no CI that runs
any. This is true across the whole backend, not just recent work.

**How everything has actually been verified:** device checks (a person driving
the app) and throwaway scripts run against the dev database (`rpm_db_v1`) and then
deleted. The role-model and tz work above were verified that way — see the
verification records in `ROLE_MODEL.md`, `TZ_FIX_DESIGN.md`, and the FOLLOWUPS
docs. Those records are the closest thing to a regression guard that exists, and
they are prose, not executing code.

**What this means going forward:**
- Nothing here is protected against regression by a test. A future change can
  silently break assignment scoping, alert routing, the sign gate, or the tz
  bucketing, and only a manual check or a user noticing would catch it.
- Several defects found recently were exactly the kind a basic test would have
  caught immediately: the phantom `patient_doctor` JOIN (ALERT_FOLLOWUPS #1), the
  dead socket role gate (ALERT_FOLLOWUPS #2), the settings token dropping
  `role_type`/`org_id` (SECURITY_FOLLOWUPS #9), admin being able to sign a note.
  Each sat latent because nothing exercised the path.

**Highest-value first tests, if/when this is picked up** (access control is where
a silent break is worst): `patientAccess` (canAccessPatient / assignmentScope per
role), the sign-gate (clinician-only, at the route AND service), cross-org denial,
and the tz day-bucketing fixtures (the 8pm-Pacific boundary). These have the most
detailed manual verification records already, so they are the cheapest to turn
into permanent tests.
