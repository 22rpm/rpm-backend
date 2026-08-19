# Audit: making `users.email` nullable (phone-only patients)

Checklist for anyone touching patient email. Written before the `users.email`
NOT NULL → NULL migration, which is **deferred** — enrollment currently still
requires an email. The migration itself is low-risk (`users_email_unique` already
tolerates multiple NULLs); the risk is in the paths below.

## The new invariant this creates
Every user needs a way to log in. Today that's guaranteed by email being NOT
NULL. Once email is nullable:

> **Email OR phone is required. If email is null, phone is mandatory** — that
> patient can only authenticate via the phone `login` path (SMS OTP). Never route
> a patient to a login path that lacks a phone branch.

The main `login` (`controllers/auth.controller.js`) already branches correctly:
`looksLikePhone(identifier)` → `findUserByPhone` → **Twilio SMS OTP**; email
identifier → email OTP. A phone-only patient logs in by phone and gets an SMS.
That path works — it's why nullable email is viable.

## A-items — paths that break / send-to-null with a null email

- **A1. `simpleLogin` — REMOVED (this branch).** It was a second login path with
  no phone branch (email/username only), no tokens, and it bypassed OTP. A
  phone-only patient sent there would silently fail. No client called it
  (verified: no `simple-login` reference in rpm-dashboard-v1.0, rpm-ios-app,
  22-rpm-android-app). Route, export, and handler deleted so a future client
  can't wire to it.
- **A2. Email OTP channel** — `controllers/auth.controller.js` (~line 419–422),
  `sendOtpEmail(user.email, otp)`. Only reached when a user logs in *by email*,
  so a phone-only patient never hits it — but if a UI offers them the "email"
  method, `sendMail({ to: null })` fails. Guard: don't offer email login to
  null-email users.
- **A3. `services/mfa.service.js` `sendMfaOtp(... to: email)`** — emails an MFA
  OTP. The `/mfa/*` router is **not mounted** (dormant). Would break for a
  null-email user if ever enabled.
- **A4. `controllers/organization.controller.js` `resetPassword` (~line 396)** —
  matches on `user.email` and "sends" a new password to email (currently only
  `console.log`). It's an **admin** endpoint, not a patient path, but would fail
  for any null-email user if used.

## Degrades but does NOT crash (no method calls on `.email` anywhere)
- `findUserByEmail(null)` → `WHERE email = NULL` matches nothing (safe; email
  login just won't find phone-only patients, which is correct).
- JWT payload `email: user.email` → null in token; `check-me`/profile, worklist,
  and message lists return `email: null`. **Every UI surface showing email must
  handle null.** No crash.

## authMiddleware result (flagged as never-audited)
`middleware/auth.js` `authMiddleware` is **dormant** — imported in
`routes/messageRoutes.js:5` but its `router.use(authMiddleware)` is **commented
out at `messageRoutes.js:8`** (`authRequired` is the active guard). The
middleware itself makes **no** email assumption (`jwt.verify` → `req.user =
decoded`). Inert today; if re-enabled it does not break on null email.

## Before wiring any patient-facing email later
Reminders (§3.7), invitations, password reset: null-check email and fall back to
SMS or skip. The A-items above are the checklist.
