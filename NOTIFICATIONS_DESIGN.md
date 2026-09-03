# Patient notifications — scope (report before building)

Automated messages a clinician or admin can enable **per patient**: reading
reminders on a cadence, a prompt to schedule the monthly call, an acknowledgement
when a patient replies, and occasional ones (e.g. birthday).

**Status (2026-09-02): SCOPE ONLY. Not built.** This records what exists, what's
missing, and — importantly — which parts are *blocked on prerequisites* and must
not ship until those land, because they'd make promises we can't keep.

---

## What exists today (reuse) vs. missing (build)

**Reuse:**
- Twilio SMS send path — `services/twillio.service.js` (`sendSMS(to, message)`),
  works for any E.164 number. Today wired only to login OTP and a *test-only*
  staff alert route. Patient phone is on `users.phoneNumber`.
- `scheduled_calls` (staff intent to call the patient) — a natural trigger source
  for a "your call is coming up" reminder.

**Missing (must build):**
- Any scheduler/cron — nothing fires anything server-side on a cadence today.
- Patient-directed SMS (only OTP goes to patients now), plus a **send log**
  (idempotency, cost, delivery status) — none exists.
- Communications consent + opt-out/STOP — none exists.
- A per-patient per-type enablement model (the toggles).
- Push (APNs/FCM) — nothing at all (see below).

---

## The six questions, answered

### 1. Delivery channel — SMS is realistic; push is a project, not a feature

- **SMS works today.** Twilio is integrated. Gaps to close before patient use:
  single hardcoded from-number (no per-org sender), **no per-message logging or
  cost tracking**, no delivery-status webhook. Each message costs per send.
- **Push does NOT exist anywhere.** No device-token table, no iOS
  `registerForRemoteNotifications`, no RN push library installed, no APNs/FCM
  sender. Standing up push requires, end to end: an Apple Developer **APNs key +
  `aps-environment` entitlement**, an RN push library + the iOS registration &
  permission prompt, a backend **device-token table + registration endpoint**,
  and an APNs/FCM sender with token lifecycle handling. That is a multi-week
  infrastructure project, not part of this feature.
- **Recommendation:** SMS-only for anything that must reach a patient who isn't in
  the app; keep the in-app banner for those who are. Defer push to its own project.

### 2. Scheduling link — there is no patient surface for it to land on

- There is **no patient-facing web page anywhere** (backend is a pure JSON API;
  the dashboard is staff-only). Patients use the iOS app only.
- There is **no magic-link / tokenized-link** pattern. The only thing that
  identifies a patient is phone + SMS-OTP → JWT cookie. So a link in an SMS would
  require the patient to log in (phone + OTP) on a web page that doesn't exist, OR
  a signed one-time-link mechanism that doesn't exist.
- Deeper problem: `scheduled_calls` is the **clinic's intent to call the patient**,
  not a patient self-booking model. "Book it" implies patient-chosen slots from
  clinician availability — availability, slots, conflict handling — **none of which
  exists.** Self-booking is a separate, larger project.
- **Recommendation for v1:** the "schedule your monthly call" reminder is a
  *prompt to expect/confirm the call* ("Your care team will call you this month —
  call us at <clinic #> to set a time"), NOT a self-booking link. A real booking
  page (patient auth on web + availability model) is its own project; flag it,
  don't smuggle it in via a link that lands nowhere.

### 3. Acknowledgement reply — blocked on Messages being merged AND monitored

- The Messages backend API **is live** on the active branch (patient *send* path
  works), but the **monitoring layer is stranded on `fix/messages-e2e` and not
  merged**: no physician email/SMS notification on a patient reply, no clinician
  inbox, no dashboard Messages UI. The dashboard's `new_message` socket handler is
  a `console.log` stub. iOS **deliberately hid** the Messages entry point for
  exactly this reason (`PatientHome.js`: "held until the clinician side is live +
  monitored").
- So an auto-reply "your care team will review this" is a **promise we don't
  keep** — the message lands in a table nobody watches. Worse, an
  "acknowledgement when a patient replies" *requires knowing a patient replied*,
  which is the very notification path that lives only on the unmerged branch.
- **Recommendation:** this item is DOWNSTREAM of Messages shipping. Do not build
  the auto-ack until `fix/messages-e2e` (physician notification + clinician inbox +
  dashboard UI) is merged and someone is actually watching. Until then, automated
  SMS must say **"this is an automated message — we can't receive replies here"**
  (see #6), so no reply expectation is created.

### 4. Reading reminders — no true overlap, but dedupe against reality

- The existing "in-app reminder" is **not a notification** — it's an on-screen
  banner on the patient Home screen, visible only while the app is open, with no
  cadence and no push/local-notification delivery. It nudges someone *already in
  the app*.
- An automated SMS/push reminder reaches someone who is *not* in the app — so in
  practice they don't duplicate. The real dedupe is **against compliance, not
  against the banner**: before sending, check whether the patient has already
  transmitted a reading in the window and **skip the reminder if they're current.**
  Don't remind a compliant patient. (Same data the banner uses, available
  server-side.)

### 5. Consent & opt-out — a hard prerequisite, and yes a patient can stop them

- **No communications-consent concept exists.** `patient_consents` is RPM billing
  consent only. No `sms_consent`/`opt_out`/`unsubscribe`/STOP handling anywhere.
  Today's OTP SMS is transactional, so none was needed.
- Automated **non-urgent** SMS (reminders, and especially birthday messages) fall
  under TCPA-style rules: prior express consent, honor STOP/opt-out, identify the
  sender, include opt-out instructions.
- **Must build:** (a) a per-patient comms-consent opt-in record; (b) a Twilio
  inbound webhook for **STOP/HELP** that flags opt-out; (c) an opt-out check before
  **every** non-transactional send; (d) the send log (#1). **Yes, a patient can and
  must be able to stop them** — STOP keyword plus a staff/patient-visible toggle.
  This gates the whole feature; it is not optional polish.

### 6. Who they come from — identify as automated; never sign with a person's name

- One hardcoded from-number, no per-org sender. An automated message that nobody
  read before sending is a **system message** and must read as one.
- **Do NOT sign an automated message with an individual clinician's name** — that
  implies a person sent it and invites a reply that reaches no one (see #3). A real
  person texting is a different thing (that's monitored Messages).
- **Recommendation:** automated messages identify the **clinic** as sender, state
  they're automated, and say replies aren't monitored here + "reply STOP to stop."
  The from-identity and reply-handling are linked: because we can't monitor
  replies, the copy must not solicit one.

---

## Dependency order (what blocks what)

1. **Comms consent + opt-out/STOP + send log** — prerequisite for ANY automated
   patient SMS. Build first.
2. **Per-patient enablement model + a scheduler** — the toggles and the cron that
   fires due items. Depends on (1).
3. **Reading reminders** and **monthly-call prompt (as a prompt, not a link)** —
   the first two message types. Depend on (1) and (2). Dedupe reminders against
   compliance (#4).
4. **Birthday / occasional** — same machinery; lowest priority.
5. **Acknowledgement reply** — BLOCKED until `fix/messages-e2e` is merged and
   monitored (#3). Do not build before then.
6. **Self-booking link / patient web surface** — a separate project (#2). Not a
   prerequisite for the call *prompt*; required only if we want true self-booking.
7. **Push (APNs/FCM)** — a separate infrastructure project (#1). SMS ships without it.

---

## Scheduling link — smallest version (SCOPED, HELD — do not build)

Still blocked on a patient web surface + a real notion of availability; neither
exists. "Expect a call" stays. Recorded so the smallest viable shape is findable:

1. **Signed single-use link** — an opaque token in the SMS → patient_id + org +
   short expiry; no PHI in the URL. This token/magic-link primitive does not exist
   yet and is the core new piece.
2. **One public page, no login** — a minimal standalone page (outside the staff
   dashboard, which is auth-only) that validates the token and shows choices. This
   is the new patient web surface.
3. **Coarse slot picker, not a calendar** — a handful of clinic-defined windows
   (e.g. 3 fixed slots, or morning/afternoon), because real availability/slots
   don't exist. Patient picks one.
4. **Token-scoped booking endpoint** — validates the token, writes a
   `scheduled_calls` row (or a requested-time preference) for that patient;
   single-use so the link can't be replayed.

Its own project (token primitive + unauthenticated page + coarse availability +
scoped endpoint), separate from inbound-SMS. Held deliberately, not forgotten.
