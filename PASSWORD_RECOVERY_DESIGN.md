# Password recovery — design (SCOPE, not built)

**Status:** DESIGN. **Date:** 2026-09-17. Goal: a patient who forgets their password can recover
without the founder resetting it by hand. Panel is mostly elderly; this will be routine.

## Recommendation first
Do **both** options — they share one backend primitive, so the second is mostly UI, and each covers a
gap the other doesn't. **Order:**
1. **Build the shared backend primitive** — issue a reset code to the patient's **phone on file** via
   SMS (reuse the existing OTP machinery), verify it, set the new password. Reuses `otp.service`
   (`createOtp`/`verifyOtp`) with `purpose:"reset"` + `twilioService.sendSMS` — the same channel that
   already delivers login OTPs, so it's a small build.
2. **Option 2 — dashboard reset button on the patient row (SMALLER; ships first).** Any staff member
   triggers "send this patient a reset" → the primitive SMSes the patient a code (staff never handles
   the credential). Immediately removes the founder as the single bottleneck.
3. **Option 1 — in-app "Forgot password?" (LARGER; scales to zero-touch).** Patient self-serves:
   enter identifier → receive SMS code → set new password. Reuses the same verify/set endpoints; adds
   UI in **both** apps + anti-enumeration.

**Channel (DECIDED 2026-09-17): SMS to the phone on file is primary; EMAIL is the fallback; if
neither is on file, a LOUD failure that tells staff a manual reset is required — never a silent
nothing.** SMS is the channel an elderly panel actually uses, and new enrollees won't all have email.
But the email fallback is **not optional**: prod today is 21 patients / 0 no-email / **11 no-phone**,
so until those 11 phone numbers are entered, email is the ONLY channel that reaches them — the
fallback has to work from day one. (A patient who replied STOP can't receive SMS regardless, so an
opted-out patient also falls through to email.)

## Which is smaller, and why not both
- **Option 2 is the smaller build:** the patient list already exists in the dashboard; the only new
  pieces are one backend endpoint (the primitive) + a row button. No mobile work.
- **Option 1 is larger:** it needs a "Forgot password?" entry point + a reset flow screen in **two**
  app codebases (iOS + Android), plus the anti-enumeration/rate-limit front on the backend.
- **No reason not to do both.** They're complementary (staff-assisted vs self-service) and sit on the
  same backend primitive, so doing both ≈ one backend + two thin front-ends. Option 2 buys immediate
  relief; Option 1 is what actually scales.

## What happens today (the gap being closed)
- **No self-service anywhere.** Neither app has a forgot-password link; the "Change Password" row in
  app settings is a dead placeholder (no handler).
- **The dashboard "Reset Password" button is a DECOY.** Its dialog promises "an email will be sent
  with instructions" but its handler is a no-op stub (`AdminUsers.jsx:136`: "In real app, this
  would…") — nothing is sent, nothing changes. Actively misleading: staff think they reset it.
  **This must be removed or wired to the real flow.**
- **The backend `resetPassword` endpoint is a broken orphan.** `POST /org/admins/:id/reset-password`
  (`organization.controller.js:396`; the plaintext-logger fixed in a6917c2) has **no caller**, and if
  called it generates a random password, stores it, and tells no one (no send, not in the response) —
  locking the account. Also requires an `email` match, so unusable for a no-email patient. **Remove
  or replace** with the primitive.
- **The only working reset today** is an admin/super-admin editing the user and typing a new password
  (`PUT /api/admin/users/:id`), then reading it to the patient by phone. Admin-only (not clinicians),
  manual, unnotified, and the staff member handles the plaintext credential.

## Channel populations (why both SMS and email must work)
Prod: 21 patients / 0 no-email / 11 no-phone. So today **email reaches everyone and SMS reaches the
~10 with a phone**; as phones are entered and new (possibly no-email) patients enrol, SMS becomes the
one most will use. Recovery therefore tries **SMS first, email second**. The group to watch is
**neither on file** — they can receive no code and always need a manual reset (open question #4).

Adjacent (separate) issue in LOGIN (not recovery): login's OTP channel is picked by the identifier
(`auth.controller.js:255-355`) — phone → SMS, email/username → email. A no-email patient logging in by
**username** gets the OTP emailed to a non-existent address and **fails silently**. Tracked as its own
higher-priority bug below.

**Count the affected patients (run on PROD — `mysql -u root -proot -h 127.0.0.1 rpm_db`; the local dev
DB is not representative):**
```sql
SELECT
  COUNT(*) AS patients,
  SUM(u.email IS NULL OR u.email = '')             AS no_email,
  SUM(u.phoneNumber IS NULL OR u.phoneNumber = '') AS no_phone,
  SUM((u.email IS NULL OR u.email='') AND (u.phoneNumber IS NULL OR u.phoneNumber='')) AS neither
FROM users u JOIN role r ON r.user_id = u.id AND r.role_type = 'patient';
```
`no_email` sizes the login-bug/SMS-recovery population; `neither` is the group that can receive no code
at all and always needs a manual reset (open question #4). (Local dev DB on 2026-09-17: 7 patients, 0
no_email, 4 no_phone — illustrative only, NOT prod.)

## The shared backend primitive
Reuse what exists — do NOT build a parallel OTP system:
- **Issue:** `createOtp(user.id, code, "reset")` + `twilioService.sendSMS(phoneOnFile, code)`. Code is
  6 digits, short expiry (e.g. 10 min), single-use.
- **Verify + set:** `verifyOtp(user.id, code, "reset")` → on success accept a new password (min length,
  bcrypt hash, `updateUserPassword`), consume the code.
- **Endpoints (sketch):**
  - `POST /api/auth/password-reset/request` — body: identifier (self-service) or handled server-side
    for the staff button. Looks up the user, sends the code to the **contact on file only**.
  - `POST /api/auth/password-reset/confirm` — body: identifier + code + new password. Verifies, sets.
- Both the dashboard button and the app forgot-password call these; the app adds the identifier entry.

## Security requirements (non-negotiable)
- **Send the code only to the contact ON FILE** (stored phone/email), never a contact typed during
  reset — otherwise it's an account-takeover vector.
- **Anti-enumeration (self-service):** the request response is identical whether or not the account
  exists ("If an account matches, we've sent a code"). The staff button can be explicit (staff is
  trusted).
- **Rate-limit** reset requests per account/number; **expire** codes (~10 min); **single-use**;
  invalidate on a completed reset.
- **Audit** each reset request + completion (actor = patient or the staff member) — account-creation
  today writes no audit record (SECURITY_FOLLOWUPS #17); don't repeat that here.
- Consider **invalidating active sessions / device trust** on a completed reset (a forgotten password
  can mean a compromised or lost device).
- **Gating for the dashboard button — DECIDED (owner, 2026-09-17): ADMIN-ONLY, not widened.**
  Keep it `requireRole(...ADMIN_ROLES)`. Rationale: the bottleneck isn't real yet (two clinicians + a
  care manager), and password reset is an **account-takeover path if a staff account is compromised** —
  the fewer accounts that can trigger it, the smaller the blast radius. Revisit widening to clinical
  staff when the team is larger. The patient-scoping (`scopePatientParam`) still applies.

## Cleanup
- **DONE (2026-09-17, dashboard commit 9d7c734):** removed the **decoy** "Reset Password" buttons from
  both routed screens (AdminLayout, SuperAdminLayout) — shipped ahead of this checklist because staff
  believing a reset happened is worse than no button. See FRONTEND_FOLLOWUPS #5.
- Remove/replace the broken `POST /org/admins/:id/reset-password` endpoint (folded into PR-1).
- The **username-login-with-no-email** OTP failure is a SEPARATE, higher-priority bug — it's an active
  lockout at the front door, not a recovery gap. Tracked below, outside the recovery track.

## Build checklist (ordered)
Prereq: Twilio BAA (asserted in place from the SMS work) — recovery reuses the same SMS channel.

**PR-1 — Backend reset primitive. BUILT (2026-09-17).** *[blocks PR-2, PR-3]*
- `services/passwordReset.service.js` — `otp_type="password_reset"`, 6-digit, 15-min expiry,
  single-use (via `otp.service`). Channel order per row: **SMS (`twillio.service.sendSMS`) if a valid
  phone is on file AND not opted-out → EMAIL (`mail.sendPasswordResetEmail`) fallback → `no_contact`
  loud failure**. One code, whichever channel delivers it; SMS-send failure also falls through to
  email. Request rate-limit 3/15min (DB-backed via otp_tokens); confirm attempt-limit 8/15min
  (in-memory); audited (`ACTIONS.PASSWORD_RESET`, metadata records the actual channel).
- `POST /api/auth/password-reset/request` (public, anti-enumeration, channel-agnostic message) and
  `/confirm` (verify → bcrypt set → consume; generic failure; min 8-char). `controllers/passwordReset.controller.js`,
  routes in `auth.routes.js`. Verified locally: SMS→email fallback, single-use, wrong/weak/reuse
  rejected, password set correctly.
- STILL OPEN: PR-1a (invalidate sessions/device-trust on reset) — deferred, open question #2. The
  broken `/org/admins/:id/reset-password` is now superseded; remove it in a follow-up.

**PR-2 — Dashboard patient-row reset button (ADMIN-ONLY). BUILT (2026-09-17).** *[depends: PR-1]*
- "Send password reset" action on the user row (`AdminLayout.jsx` UsersManagementView) → confirm →
  `POST /api/admin/users/:userId/send-password-reset` → the patient gets the code (SMS→email); staff
  never see or set it. Gate `requireRole(...ADMIN_ROLES) + resolveOrgScope + scopePatientParam`
  (`admin.routes.js`, `passwordReset.controller.adminSendReset`). Surfaces the channel-aware result and
  the explicit "no phone or email — manual reset required" failure. Replaces the removed decoy.

**PR-3 — In-app "Forgot password?" — iOS BUILT (2026-09-17), Android NEXT.** *[depends: PR-1]*
- **iOS (`rpm-ios-app/Login.js`, commit 9b581dd):** "Forgot password?" link → two-step modal →
  `.../request` (generic/anti-enumeration, always advances) → enter code + new password (min 8) →
  `.../confirm` → success prompts sign-in. Mirrors the OTP modal.
- **Android BUILT (2026-09-17)** — `22-rpm-android-app` `Login.js`, commit 8ca21a8 on the stack tip
  `fix/login-phone-label` (it edits the same Login.js that branch changes, so it rides with the
  Android stack — no fork). Same two-step flow; uses `AUTH_BASE` from the centralized apiConfig.
  **IMPORTANT: PR-3 was reclassified BLOCKING, not "next"** — sending a code (PR-1/PR-2) with no entry
  point is a half-built feature that misleads staff into thinking reset works. Both platforms now have
  the entry point (each reaches patients only via a new app build, not a server pull).

**Order:** PR-1 → PR-2 (ship) → PR-3 (ship). Decoy removal already done.

**Separate track — LOGIN BUG (higher priority than recovery):** username/email login for a patient
with **no email** routes the OTP to a non-existent address and fails with no explanation
(`auth.controller.js:255-355`) — an active lockout. Fix: when the resolved user has no email, fall
back to SMS OTP if a phone is on file, else return a clear message. Do this before/independent of the
recovery track — it locks people out at the front door today. (Count of affected patients: run the
prod query in §"No email".)

## Decisions of record
- **2026-09-17 — Dashboard reset stays ADMIN-ONLY** (not widened to all staff). Account-takeover blast
  radius; bottleneck not yet real. Revisit when the team grows.
- **2026-09-17 — Do both options** (dashboard button + in-app), on one shared primitive.
- **2026-09-17 — Channel order: SMS to phone-on-file → EMAIL fallback → loud "manual reset" failure if
  neither.** Corrected from an interim email-primary call once the panel reality was clear (elderly →
  phone; but 11 current patients have no phone, so email fallback is mandatory day one, not later).
- **2026-09-17 — Decoy reset buttons removed immediately** (ahead of the build).
- **2026-09-17 — PR-1 + PR-2 BUILT** (SMS-primary).
- **2026-09-17 — PR-3 reclassified BLOCKING** (was "next"): PR-1/PR-2 send a code with nowhere to enter
  it — confirmed there is NO reset-entry anywhere (not the dashboard: staff-facing, send-only; not the
  apps until this). **iOS + Android PR-3 BUILT** (`Login.js` on each; Android on stack tip
  `fix/login-phone-label` 8ca21a8). Reset entry now exists on both platforms — reaches patients only
  via a new app build. Login no-email bug remains a separate higher-priority track.

## Open questions
1. Email as a secondary recovery channel at all, or SMS-only for simplicity?
2. Invalidate sessions/device-trust on reset — yes/no? (PR-1a)
3. Minor/proxy patients: whose phone receives the code (ties to CLINICIAN_SMS_DESIGN open Q5).
4. Patients with **neither email nor phone** on file can't receive any code — they always need a
   manual/in-person reset. How many are there (see prod query), and what's the fallback for them?
