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

**Channel: SMS to the phone on file is primary.** It works for every patient including those with no
email; email recovery is at best a secondary for patients who have and prefer it. (See "no email"
below — email is not a reliable channel for this panel.)

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

## "No email" patients — SMS is the only channel that works
Login OTP channel is chosen by the identifier used (`auth.controller.js:255-355`): phone → SMS OTP;
email/username → **email** OTP. So a patient with no email:
- can only log in via **phone → SMS OTP**; logging in by username emails the OTP to a non-existent
  address and **fails** (adjacent bug worth its own fix — username login assumes an email exists).
- must therefore recover via **SMS**. This is the reason SMS-to-phone-on-file is the primary recovery
  channel, not a preference.

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

**PR-1 — Backend reset primitive.** *[blocks PR-2, PR-3]*
- `POST /api/auth/password-reset/request`: look up user; issue a 6-digit code via
  `otp.service.createOtp(user.id, code, "reset")` + `twilioService.sendSMS(phoneOnFile, code)`; ~10-min
  expiry, single-use. Sends ONLY to the contact on file. Self-service response is anti-enumeration
  ("if an account matches, we sent a code"); the staff path (PR-2) may be explicit.
- `POST /api/auth/password-reset/confirm`: `verifyOtp(user.id, code, "reset")` → set new password
  (min length, bcrypt) → consume code → (decide PR-1a) invalidate sessions/device-trust.
- Rate-limit per account/number; audit request + completion (actor). Remove/replace the broken
  `/org/admins/:id/reset-password` here.

**PR-2 — Dashboard patient-row reset button (ADMIN-ONLY). Ships first.** *[depends: PR-1]*
- A real "Send password reset" action on the patient row → calls `.../request` server-side so the
  patient gets the SMS code; staff never sees/handles the credential. Gate `requireRole(...ADMIN_ROLES)`
  + `scopePatientParam`. This is the real replacement for the removed decoy. Smallest increment on
  PR-1; removes the founder as the sole reset path.

**PR-3 — In-app "Forgot password?" (iOS + Android). Scales to zero-touch.** *[depends: PR-1]*
- Login-screen link → enter identifier → `.../request` (SMS to phone on file) → enter code + new
  password → `.../confirm`. Anti-enumeration copy. Two app codebases; each is thin over PR-1.

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
- **2026-09-17 — Do both options** (dashboard button + in-app), on one shared SMS primitive; SMS to
  phone-on-file is the primary channel.
- **2026-09-17 — Decoy reset buttons removed immediately** (ahead of the build).

## Open questions
1. Email as a secondary recovery channel at all, or SMS-only for simplicity?
2. Invalidate sessions/device-trust on reset — yes/no? (PR-1a)
3. Minor/proxy patients: whose phone receives the code (ties to CLINICIAN_SMS_DESIGN open Q5).
4. Patients with **neither email nor phone** on file can't receive any code — they always need a
   manual/in-person reset. How many are there (see prod query), and what's the fallback for them?
