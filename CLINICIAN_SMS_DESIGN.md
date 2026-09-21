# Two-way clinician↔patient SMS — design (SCOPE, not built)

**Status:** DESIGN. **Date:** 2026-09-16.

**Compliance gate — reality check (2026-09-16):** the Cleo/Kinza review queue has been pending since
**Sept 9** and Cleo has **not logged into her account**. Phase 0 must not be blocked indefinitely on a
reviewer who isn't engaging. Policy for this doc: the compliance questions are still routed to
Cleo/Kinza (§Open questions, and REVIEW_FOR_CLEO_AND_KINZA.md), but **if they don't respond, the
owner (Ricky) makes the call and records it here** with the date and rationale. Decisions made this
way are logged in §Decisions of record below, not left implicit.

**Twilio BAA — asserted in place (verify).** Owner states a Twilio BAA is executed. This design can't
confirm it from code (a BAA is an account-level legal agreement, not config). **If it is NOT actually
executed, that is a CURRENT exposure, not a future one** — months of BP-alert SMS (patient readings →
clinicians) and OTP SMS already carry PHI/PHI-adjacent data through Twilio. Verification: Twilio
Console → account/**Trust Hub / Compliance** (or the signed BAA in the org's legal records), or open a
Twilio support ticket asking for BAA status on the account SID. Confirm you've seen the **executed**
agreement, not just "we have a Twilio account." Proceeding on the owner's assertion.

**Phase 0 (post-BAA) reduces to two owner decisions** — both made below, not waiting on Cleo:
(1) notification-only vs limited-content → **DECIDED: notification-only default, free-text as a
consented exception** (§Q4, §Decisions); (2) the `sms_clinical_consent` wording → **APPROVED by owner
2026-09-21 — no longer pending** (§Consent wording).

**Goal (user's words):** a clinician logs into the dashboard, texts a patient directly, and has a
two-way conversation over SMS.

## Recommendation first (the short version)
Build **one conversation, two transports** — do NOT build an SMS messaging silo next to the in-app
one. Concretely:

1. **One thread model for all patient↔staff messages**, keyed by patient, tagged by `channel`
   (`in_app` | `sms`). The in-app `messages` table becomes that model; SMS is a transport that writes
   into it. `notification_log` stays what it is — the SMS **transport/audit** log (send attempts,
   delivery status, skips, failures, inbound webhook). One inbox, one thread, both channels. This is
   the answer to Q5 — a clinician looks in exactly one place.
2. **Secure in-app thread is the primary clinical channel.** SMS is the fallback for patients who
   won't use the portal, and the nudge that drives them to it.
3. **Free-text clinical SMS is allowed only behind a SEPARATE, documented, risk-acknowledged
   consent** (`sms_clinical_consent`), distinct from the existing reminder consent — with a Twilio
   BAA in place, minimum-necessary content, and sensitive-category guardrails. Default posture for
   anything sensitive is **notification-only** ("You have a new message from your care team — open
   the app to read it"). Real content over SMS is a deliberate, consented exception, not the default.
4. **Keep the single clinic Twilio number**, but make every thread a **care-team-shared** thread with
   **per-message clinician attribution** (who sent it) stamped both in the DB and in the SMS body
   ("Dr. Chen, Quantix Health: …"). Per-clinician numbers are the wrong default at ~13 patients.
5. **~~Merge/land `fix/messages-e2e` FIRST~~ — SUPERSEDED 2026-09-21. Do NOT merge it; build on
   mainline.** When this was written the inbox primitives were assumed to live only on that branch.
   They don't: `feature/measured-at` already has the `messages` table, `messageService`,
   `/api/messages/*`, `getUserConversations` (unread counts), `getCliniciansByPatient` (org-scoped),
   and a working dashboard chat UI (`PatientCommunication.jsx` → `ChatInterface`). Meanwhile
   `fix/messages-e2e` branched 2026-08-27 and is now ~18,359 lines behind — merging it would DELETE
   the RPM-note PDF, billing, and password-reset work. Its only unique asset (the debounced
   notify-physician logic) is used as read-only reference and rewritten for the daily cadence here.
   **Plan: build Phase 1 on mainline, then delete the branch.** See §"Phase 1 — CONCRETE BUILD SPEC".

Rationale for each below.

---

## What exists / what's missing (verified against code)
- **Inbound SMS**: `POST /api/notifications/sms-inbound`, Twilio-signature-verified, matched to a
  patient by last-10 digits; STOP/START/HELP handled; real replies land in `notification_log`
  (`direction='inbound'`) and raise a "reply waiting" badge on the worklist
  (`patientWorklist.service.js`). **A reply from an unmatched number is logged-and-dropped**
  (`notification_log.patient_id` is NOT NULL).
- **Outbound SMS**: template-only, via send-now (`POST /api/patients/:id/notifications/send` →
  `sendOnDemand`) and the scheduler. One patient at a time. Single `TWILIO_PHONE_NUMBER` sender.
- **Consent**: `patient_comm_prefs.sms_consent` (opt-in to automated SMS) + `opted_out` kill switch,
  **deliberately separate from RPM consent** (`patient_comm_prefs` header comment). Gate:
  `notification.service.js:215`.
- **In-app messaging**: `messages` table (`sender_id`,`receiver_id`,`message`,`is_read`) +
  `POST /api/messages/send` + Socket.IO. Core send/thread works today; the **clinician inbox +
  unread badge + physician-notify are only on the unmerged `fix/messages-e2e`**.
- **Missing**: free-text clinician→patient SMS, and a thread view rendering the conversation.

---

## Q1 — Threading: is `notification_log` enough, or do we need a messages-style structure?
**`notification_log` can render a transcript but is the wrong home for the conversation.** It has
`direction` + `body` + `created_at` per `patient_id`, so a flat chronological thread is derivable.
But it is an **attempt/audit log**, not a conversation model, and three gaps matter:
- **No sender attribution on outbound** — there's no "which clinician sent this." Needed for Q2 and
  for any care-team-shared thread.
- **It mixes automated template sends (reminders, call prompts) with would-be clinical free-text**,
  and it stores `skipped`/`failed` attempts. A "skipped reminder" is not a message; a thread view
  over raw `notification_log` would show non-messages.
- **It's SMS-shaped** (`to_number`, `twilio_sid`, `skip_reason`). Forcing in-app messages through it
  would be awkward — and we want in-app + SMS in ONE thread (Q5).

**Decision:** make the in-app **`messages` table the single conversation model** and add a `channel`
column. Every human message — in-app or SMS, inbound or outbound — is a `messages` row. SMS sends and
replies ALSO write/append `notification_log` for transport + delivery + audit (its existing job).
`notification_log.message_id` links the two. So:
- `messages` = the human conversation (what the inbox/thread renders). Transport-agnostic.
- `notification_log` = the SMS wire log (delivery status, STOP, failures, the raw webhook). Unchanged
  in purpose; gains a nullable `message_id` back-reference and, for outbound, `sender_user_id`.

This avoids two message stores and keeps `notification_log`'s "every attempt/outcome recorded"
guarantee intact.

## Q2 — The shared number (identity + "did someone already reply?")
Two real problems from one shared `TWILIO_PHONE_NUMBER`: the **patient** can't tell which clinician
they're texting, and a **clinician** can't tell if a colleague already replied.

Options considered:
- **(a) Per-clinician Twilio numbers.** Clean 1:1 identity, but: a per-number cost, provisioning/
  management overhead, and a patient with two clinicians now juggles two numbers and two threads.
  Wrong default for a ~13-patient clinic; revisit only if they later want strict 1:1 identity.
- **(b) One clinic number + care-team-shared thread + attribution.** ← **recommended.** The patient
  is texting **the care team**, not an individual — set that expectation explicitly. Solve both
  problems without new numbers:
  - *Patient-facing identity*: prefix every outbound with the sender + clinic
    ("Dr. Chen, Quantix Health: …"). The patient replies to the one number; the reply is matched to
    the patient and appended to their single thread.
  - *"Did someone already reply?"*: the thread is **one shared conversation per patient, visible to
    all assigned clinicians**, showing who sent each message and whether an inbound is still
    unacknowledged (reuse the existing `acknowledged_at` "reply waiting" mechanism as the inbox
    unread state). Optionally a soft **assignment** ("Nora is handling this") to avoid double-replies
    — a nicety, not required for v1.
- **(c) Number pool / sticky per-clinician routing.** Overkill; skip.

**Decision:** single clinic number, care-team-shared thread, per-message clinician attribution in
both the DB (`messages.sender_id`) and the SMS body. Add `sender_user_id` to outbound
`notification_log` rows too, for the wire audit.

## Q3 — Consent: same gate as reminders, or different?
**Different.** `sms_consent` today means "OK to send automated notifications" — and the table's own
design already insists RPM consent ≠ SMS consent. By the same logic, **consenting to reminder texts
is not consenting to a clinical discussion by text.** A reminder is low-sensitivity and one-way; a
clinical conversation can carry symptoms, meds, diagnoses.

**Decision:** add a **second, separate flag `sms_clinical_consent`** in `patient_comm_prefs`
(with `_at`/`_by`), gating free-text clinical SMS. Rules:
- Reminders keep gating on `sms_consent` (unchanged).
- Free-text clinical SMS gates on `sms_clinical_consent` **AND** `NOT opted_out`.
- The **`opted_out` (STOP) kill switch applies to BOTH** — STOP means stop everything.
- Obtaining `sms_clinical_consent` must **capture a risk acknowledgment** (the patient was told SMS
  is not secure and still chose it — see Q4). Store when/who; ideally the consent language version.
- If a clinician tries to send clinical SMS without it: **block**, and offer the notification-only
  nudge or the in-app thread instead.

## Q4 — PHI over SMS (the big one)
SMS is not a secure channel and its **last mile (carrier → patient handset) can never be secured by
us**, even with a vendor BAA. The handoff already rules plain email out for PHI, so the conservative
posture must carry here.

What the rules actually allow (not legal advice — for Cleo/Kinza to confirm): HIPAA does **not** flatly
ban PHI over SMS. Under the right-to-request-confidential-communications framework and OCR's
email/text guidance, a covered entity **may** communicate PHI over an unsecured channel **if it warns
the patient of the risk and the patient still requests/agrees** to it — and the CE still owes
reasonable safeguards and minimum-necessary. So the mechanism that makes clinical SMS permissible is
**documented, risk-acknowledged patient consent** (Q3) — not encryption we don't have.

What RPM/telehealth companies normally do — two patterns:
- **Notification-only ("log in to read")**: SMS carries **no PHI** — just "You have a new message
  from your care team, open the app." All content stays in the secure portal. Safest; the default for
  anything sensitive.
- **Consented limited-content**: with documented consent, exchange **limited, low-sensitivity**
  clinical content by SMS (logistics, "your BP readings look good this week," reminders), while
  **excluding sensitive categories** (behavioral health, substance use, HIV/repro, etc.).

**DECIDED (owner, 2026-09-16): notification-only is the default for anything clinical; free-text SMS
is the consented exception.** Concretely:
- **Twilio BAA** — asserted in place (see header; verify the executed agreement). Covers Twilio's
  handling; does **not** secure the carrier/device last mile — consent covers that.
- **Notification-only is the DEFAULT clinical path.** When a clinician posts clinical content, the
  patient's SMS carries **no PHI** — just a nudge ("You have a new message from your care team — open
  the app to read it"). The content lives in the secure in-app thread. This is what happens unless the
  clinician deliberately chooses the exception below.
- **Free-text clinical SMS is an explicit, consented EXCEPTION**, not a mode a clinician lands in by
  accident. It requires `sms_clinical_consent` on file (§Q3, wording below) and is subject to:
  minimum-necessary content, a **PHI warning in the compose box**, a **sensitive-term soft-warning**
  before send, and full logging. The compose UI must make it obvious which mode is active (nudge vs
  real content) — a clinician should never send PHI over SMS thinking they were sending a nudge.
- **Never** put PHI in the outbound reminder/nudge templates (they already avoid it — keep it so).

See §Decisions of record.

## Q5 — Relationship to the in-app messaging on `fix/messages-e2e`
Two channels doing similar things is exactly how a clinician misses a message. **Do not build SMS as
a second inbox.** `fix/messages-e2e` adds the clinician **inbox + unread badge + notify** on top of
the `messages` table; that inbox should be **the one inbox for both channels**.

**Decision / sequencing:**
- **Land `fix/messages-e2e` first** (or rebase this work onto it). It supplies the inbox/unread/
  thread UI this design extends.
- **SMS becomes a `channel` on the same `messages`/inbox model** (Q1). Inbound SMS already captured by
  the webhook ALSO appends a `messages` row so it shows in the unified thread; the "reply waiting"
  badge and the in-app unread badge become **one** unread signal.
- A per-thread **channel indicator** (in-app vs SMS) and a **per-patient preferred channel** so a
  clinician composing once reaches the patient the right way.

---

## The inbox-monitoring gate (BLOCKS Phase 1)
`fix/messages-e2e` was held for a reason that **still stands**: nobody monitors the clinician inbox.
Merging it — or shipping SMS two-way — means **patients can message and expect a reply**. A message
nobody reads is worse than no channel at all: the patient believes they've reached their care team.
So the gate is operational, not just technical.

**"A clinician has to remember to open a page" is NOT monitoring.** If that's all we have, don't ship.
Real monitoring means an unread message becomes **visible without anyone choosing to go look**, and an
unread message has a **defined fate**. Concretely, ALL of these before Phase 1 ships:

1. **Push, don't pull — out-of-band notify on inbound.** When a patient messages, the responsible
   clinician is notified where they already are (email/SMS, later push), not left to notice a badge.
   `fix/messages-e2e` ships `notifyOnPatientMessage` (physician email/SMS on a new patient message) —
   this is the load-bearing piece. Verify it fires reliably and targets the right person (assigned
   clinician / care-team, not a black hole).
2. **A persistent unread indicator in the global chrome**, not only on the Communication page. The
   `/unread-count` badge from that branch must be surfaced in the main nav so it's visible from
   wherever a clinician works — otherwise it's the "remember to check a page" failure.
3. **An aging + escalation rule — the answer to "what happens to a message nobody reads."** An unread
   inbound that ages past a threshold (e.g. 1 business day) **escalates**: re-notify, and/or notify a
   named backup/supervisor. Without this, a message can sit unread forever and no one is accountable.
4. **A named owner / coverage window.** Who watches the inbox, during what hours — a **named
   commitment**, written down, not "the team."
   **Actual state (2026-09-16):** the practice has **one active clinician**. The second clinician
   account was a functional/test account, now deactivated. So today coverage is **one person, with no
   clinical backup.** Consequences to face before shipping, not after:
   - The escalation rule (item 3) has **no second clinician to escalate to.** Its backstop is the
     owner (Ricky) — escalation = re-notify the clinician, then notify the owner. Name that explicitly
     as the fallback; don't leave "escalate" pointing at nobody.
   - One person means **no coverage when that person is off** (PTO, sick, after hours). The stated
     `[COVERAGE WINDOW]` in the consent wording must reflect that honestly (e.g. business hours only,
     one clinician), and out-of-window inbound gets the auto-acknowledgement (item 5) rather than a
     false promise of a quick reply.
   - This is a **single point of failure by design today.** It's not a blocker to *deciding* to ship,
     but it must be a conscious acceptance by the owner, recorded — a second active clinician (or a
     designated non-clinician triager who can at least see and route messages) is the real fix.
5. **Patient expectation-setting** (ties to consent wording): the channel is **not 24/7 and not for
   emergencies**. An auto-acknowledgement on first inbound ("Thanks — a team member will reply within
   one business day. For an emergency call 911.") sets the response contract and covers the gap
   between "patient sent" and "human read." Recommended, and cheap.

**Gate:** items 1–4 are hard requirements; 5 is strongly recommended. If the org can't commit a named
owner + coverage window (item 4), **do not ship Phase 1** — the technical pieces don't substitute for
a human who is accountable for reading it. This is the operational commitment the owner asked to see
made explicit; it is a go/no-go, not a nice-to-have.

### RISK: escalating to a non-clinician is not a clinical safety net
The escalation backstop named above is the owner (Ricky), who is **not a clinician**. That is a real
patient-safety gap and must be recorded, not glossed: **if an urgent message escalates to a
non-clinician, they cannot clinically assess it or give medical advice.** A patient texting "my chest
hurts and my BP is 190" needs a clinician, and a non-clinician receiving that has no safe way to
triage it.
- **The only safe protocol for a non-clinician who receives an escalated message:** do NOT attempt to
  assess or advise. Immediately try to reach a clinician (phone, not the same channel). If no
  clinician is reachable and the message reads as an emergency, direct the patient to **call 911 / go
  to the ER** — which is exactly why the channel's outbound consent language says "not for
  emergencies, call 911," and why the auto-acknowledgement (item 5) matters: those are the safety net
  when no clinician is in the loop.
- **This is a reason to get a clinical triager in the chain (below), not a workaround.** A
  non-clinician backstop is acceptable only as the *last* link for the rare both-clinicians-
  unavailable window, never as the routine triager.

### Resolving the single point of failure — add Kinza (lead nurse) as triager
The owner identified Kinza (lead RN) as the obvious triager. She isn't in the system yet. Adding her
**does resolve the single-point-of-failure** and moves the escalation chain to patient → Kinza (RN
triage, within nursing scope) → physician — taking the non-clinician owner out of the routine
clinical path (he remains only the last-resort backstop for the both-unavailable window). **This is
what makes Phase 1 shippable.** Scope of adding her:
- **Role = `care_manager`, NOT `clinician`.** This is the important call. `care_manager` is exactly the
  modeled "clinical staff, under physician supervision" role: it is in `CLINICAL_STAFF` (so she can
  read/reply to messages, send reminders, view/generate notes) and in `ORG_WIDE_ROLES` (so she sees
  the **whole clinic's** inbox with no per-patient assignment), but it is **not** in `CLINICIAN_ONLY`
  or `CONSENT_ROLES` — so she **cannot sign the RPM note** (the physician/QHP billing attestation) or
  attest consent, which she shouldn't (RpmNote.jsx already renders read-only for care_manager). Her
  time also attributes correctly as "clinical staff (under supervision)" in the note's time table.
- **Creating a `clinician` instead would over-grant note-signing** and add assignment overhead
  (clinician visibility is assignment-gated per patient; care_manager is org-wide). Don't.
- **Path (≈5 minutes):** the **Clinicians screen hardcodes role `clinician`**
  (`SuperAdminClinicians.jsx` → `createClinician` → `/api/auth/register` with `role:"clinician"`), so
  it's the WRONG screen for her. Use the **Admin → Users** screen (`AddUserModal`), whose role
  dropdown includes **Care Manager** → `/api/auth/register` (admin-gated). Fields: name, username,
  email, phone (required — drives her SMS OTP login), an initial password, role = Care Manager,
  Active.
- **Caveats to note, not blockers:** (a) she won't appear in the "Clinicians" list, which filters
  `role_type='clinician'` — expected. (b) The Phase-1 inbox (`fix/messages-e2e`) must surface
  **org-wide** for `care_manager` so she actually sees every thread — verify when landing that branch.
  (c) Account creation writes **no audit record** (SECURITY_FOLLOWUPS #17), so her creation is
  unlogged — note it in the roster review. (d) The initial password is set by the creator; she should
  change it on first login (no forced-change flow exists).

**Net:** with Kinza as `care_manager`, item 4's named owner = Kinza (primary), physician (clinical
escalation), owner (last-resort backstop only). The single point of failure is resolved and Phase 1
clears its gate.

### Coverage & escalation statement (v1 — the named commitment for gate item 4)
- **Coverage window:** care texts are monitored **Monday–Friday, 9am–5pm Pacific.** This is the same
  window stated to patients in the consent wording, and the same clock the escalation SLA runs on.
- **Primary triager:** **Kinza (lead RN, `care_manager`).** She reads and triages inbound messages
  within the window, handles what's within nursing scope, and routes clinical decisions up.
- **Clinical escalation:** **Dr. Aamir** — anything requiring a clinical decision (med change,
  diagnosis, an urgent symptom) goes to him. Kinza → Dr. Aamir is the routine clinical chain.
- **Last-resort backstop:** **Ricky (owner, non-clinician)** — only when both Kinza and Dr. Aamir are
  unreachable. Per the risk above, he does not clinically triage: he tries to reach a clinician, and
  failing that redirects an emergency to 911/ER.
- **SLA (proposed — adjust):** an inbound message during the window is acknowledged within **2 business
  hours**; if not, re-notify Kinza and escalate to Dr. Aamir. A message arriving **outside** the window
  gets the auto-acknowledgement ("we'll reply within one business day; emergencies call 911") and is
  triaged at the next window open — never left silent.

### RISK: the coverage plan is one household
**Kinza is the owner's wife as well as the lead nurse.** Operationally she's the right triager, but be
clear-eyed: with Kinza (primary) and Ricky (backstop) in the **same household**, a chunk of the
coverage plan depends on **one household's availability**. If both are unavailable at once (travel,
illness, a family event), the chain collapses to Dr. Aamir alone — and if he's also out, **there is no
one.** This isn't a reason not to ship, but it is a concentration risk to record, not discover later:
the durable fix is a **second person outside the household** in the chain (another RN/triager, or a
covering clinician), and until then the coverage window + auto-ack + "not for emergencies, call 911"
are what protect the gap. Revisit as the patient panel grows past what one household can reliably
cover.

---

## Data model (deltas — no new parallel tables)
- `messages`: add `channel` ENUM(`in_app`,`sms`) default `in_app`; add nullable
  `notification_log_id` (link outbound/inbound SMS to its wire row); consider `delivery_status`
  mirrored from Twilio for SMS rows (or read via the join). Keep `sender_id`/`receiver_id` as the
  attribution.
- `notification_log`: add nullable `message_id` (FK → `messages.id`) and `sender_user_id`
  (FK → `users.id`, null for automated/system sends). No change to its existing columns/purpose.
- `patient_comm_prefs`: add `sms_clinical_consent` (bool, default false), `sms_clinical_consent_at`,
  `sms_clinical_consent_by`, and (recommended) `sms_clinical_consent_version` for the acknowledged
  language. `opted_out` continues to govern all channels.
- (Optional v1.1) a soft `conversation_assignment` (patient_id → staff_user_id) for "who's handling
  this," if double-replies become a problem.

## Flows
- **Outbound clinical SMS**: clinician composes in the thread → server checks `sms_clinical_consent`
  && `!opted_out` → create `messages` row (channel=sms, sender=clinician) → `notification.service`
  sends via Twilio with attribution prefix, records a `notification_log` outbound row
  (`sender_user_id`, `twilio_sid`, `message_id`) → Twilio status callback updates delivery on both.
  No consent → blocked with the notification-only / in-app fallback offered.
- **Inbound reply**: existing `sms-inbound` webhook (unchanged for STOP/START/HELP + `notification_log`
  inbound) ALSO appends a `messages` row (channel=sms, sender=patient) → surfaces in the unified
  thread + inbox; `acknowledged_at` is the unread state. Unmatched-number replies still logged-and-
  dropped (pre-existing gap; note it).
- **Notification-only nudge**: a non-PHI template ("new message from your care team — open the app")
  sent when clinical content is posted in-app to a patient whose preferred/available channel is SMS.

## Phasing
- **Phase 0 — compliance gate.** Twilio BAA (asserted in place — verify the executed agreement).
  Owner decisions, made without waiting on Cleo (see §Decisions of record): notification-only default
  **[DECIDED]**; `sms_clinical_consent` wording **[DRAFT — owner sign-off pending]**; sensitive-
  category policy **[owner to decide]**. Questions still routed to Cleo/Kinza but not blocking.
- **Phase 1 — unify + surface inbound. GATED by the inbox-monitoring gate above (items 1–4 are hard
  go/no-go).** Land `fix/messages-e2e`; add `channel` to `messages`; make the `sms-inbound` webhook
  append a `messages` row so patient replies appear in the unified thread/inbox (today they only raise
  a badge); surface the unread badge in global nav; wire the aging/escalation rule. **Do not ship
  without a named inbox owner + coverage window.**
- **Phase 2 — outbound free-text SMS:** `sms_clinical_consent` flag + UI; `sendClinicalMessage`
  endpoint (gated, attribution, `messages`+`notification_log`+Twilio, delivery wired back); compose
  box in the thread with the PHI warning + consent state shown.
- **Phase 3 — polish:** conversation assignment, sensitive-term soft warnings, per-patient preferred
  channel; per-clinician numbers only if 1:1 identity is later required.

## Phase 1 — build checklist (in order, with dependencies)
**What Phase 1 delivers:** one monitored inbox where inbound patient messages — in-app AND SMS replies
— are surfaced, notified, and can't sit unread. It does NOT yet include free-text clinician→patient
SMS (that's Phase 2). The gate items below are **ship-blocking**, not polish: merging this means
patients can message and expect a reply, so "surfaced + monitored" is the whole point.

**Prerequisites (no code; must be true before Phase 1 ships):**
- **PRE-1 [gate item 4] — named inbox owner exists. ✅ MET (2026-09-21).** Kinza's account exists:
  **user id 47, role `care_manager`, organization 2, active.** She is the named, accountable inbox
  owner; the coverage & escalation statement (§Coverage & escalation) stands. Gate item 4 is
  satisfied — go on this axis.
- **PRE-2 — Twilio BAA confirmed** (asserted; verify the executed agreement). Not code.

**Tickets:**
- **P1-1 — Land `fix/messages-e2e`.** Merge/rebase it onto `feature/measured-at` +
  `feature/vitals-integrated`. Supplies the clinician **inbox**, **`/unread-count`**, and
  **`notifyOnPatientMessage`** that the rest builds on. *Blocks: everything.* On landing, **verify the
  inbox surfaces org-wide for `care_manager`** (so Kinza sees every thread, not just assigned).
  *[ship-blocking]*
- **P1-2 — Migration: `messages.channel` + `notification_log.message_id`.** `channel` ENUM
  (`in_app`|`sms`) default `in_app`; nullable `message_id` FK on `notification_log` linking an SMS
  wire row to its human `messages` row. `mysqldump` first (prod has no backups). *Depends on: P1-1
  (baseline messages model). Blocks: P1-3.* *[ship-blocking]*
- **P1-3 — Inbound SMS → append a `messages` row.** In the `sms-inbound` path
  (`notification.controller.smsInbound` → `recordInboundReply`), in addition to the existing
  `notification_log` inbound row, create a `messages` row (`channel='sms'`, sender = patient) and set
  `notification_log.message_id`. This is what makes an SMS reply appear in the unified thread/inbox.
  **Decision inside this ticket:** `messages` is sender/receiver 1:1, but an inbound SMS is to "the
  care team," not one person — pick the convention (receiver = the patient's assigned clinician / the
  triager Kinza) or make the thread care-team-shared. This is where Q2's shared-thread meets the 1:1
  schema; resolve it here, small model tweak if needed. *Depends on: P1-1, P1-2. Blocks: P1-4, P1-5,
  P1-6, P1-7.* *[ship-blocking]*
- **P1-4 [gate item 2] — Unread indicator in global nav.** Surface `/unread-count` in the main app
  chrome (not only the Communication page), counting both channels (needs P1-3 so SMS inbound
  counts). "Remember to check a page" is the failure this closes. *Depends on: P1-1, P1-3.*
  *[ship-blocking / gate]*
- **P1-5 [gate item 1] — Out-of-band notify on inbound.** Make `notifyOnPatientMessage` fire for
  **SMS inbound too** (P1-3), not just in-app, and target the **triager (Kinza)** per the coverage
  model. Best done by triggering notify off the unified `messages`-row creation, so one path covers
  both channels. *Depends on: P1-1, P1-3.* *[ship-blocking / gate]*
- **P1-6 [gate item 3] — Escalation SLA job.** A business-hours-aware job (respects Mon–Fri 9–5 PT):
  an inbound `messages` row unacknowledged past **2 business hours** → re-notify Kinza and escalate to
  Dr. Aamir. Reuse `notificationScheduler`'s loop + the P1-5 notify mechanism; ack clears it (the
  existing `acknowledged_at`). This is the answer to "what happens to a message nobody reads."
  *Depends on: P1-3, P1-5.* *[ship-blocking / gate]*
- **P1-7 [gate item 5] — Auto-acknowledgement on inbound.** Automated template reply (no PHI) on the
  first inbound in a window and for out-of-window inbound: "Thanks — a team member will reply within
  one business day (Mon–Fri 9–5 PT). For an emergency call 911." Uses the existing send pipeline.
  *Depends on: P1-3.* *[strongly recommended, not strictly blocking]*

**Ship go/no-go:** PRE-1, PRE-2, and P1-1 through P1-6 all done; P1-7 strongly recommended. If PRE-1
(a named owner) isn't real, stop — the code doesn't substitute for it.

**Build order (critical path):** PRE-1 ∥ PRE-2 (parallel, no code) → P1-1 → P1-2 → P1-3 → { P1-4, P1-5
} → P1-6; P1-7 any time after P1-3.

**Explicitly OUT of Phase 1 (→ Phase 2):** free-text clinician→patient SMS (`sendClinicalMessage`),
`sms_clinical_consent` flag + capture UI, the compose box with the notification-only-vs-free-text mode
indicator + PHI warning + sensitive-category soft-warn, and the **SUD/Part 2 per-patient
hard-disable**. Those ride on the outbound path, which Phase 1 doesn't build.

## Consent wording — `sms_clinical_consent` (APPROVED 2026-09-21 by owner — no longer pending)
Patient-facing risk acknowledgment obtained before any free-text clinical SMS. **APPROVED for use
2026-09-21 by the owner (Ricky), self-signed because the Cleo/Kinza review queue never engaged (see
header). This is the version below — coverage window filled (Mon–Fri 9am–5pm Pacific) and STOP
clarified.** Phase 2 is no longer blocked on a reviewer. Plain language, ~8th-grade reading level.
`[Clinic]` = the practice name shown to the patient (e.g. "Quantix Health"). Store the wording
`_version` on each patient's consent so a later change is distinguishable from what they agreed to.

> **Texting about your care — please read before you agree**
>
> Text messages (SMS) are **not secure**. Regular texts are not encrypted, and someone could read
> them if your phone is shared, lost, or stolen. They also pass through your phone company, which we
> don't control.
>
> If you agree, you're allowing **[Clinic]** to send and receive text messages about your care —
> which may include health information such as your readings, symptoms, or medications.
>
> - You don't have to agree. You can use our **secure app** or a **phone call** instead, and you'll
>   get the same care either way.
> - **When to expect a reply:** we read and reply to care texts **Monday–Friday, 9am–5pm Pacific
>   time**. Texts are **not for emergencies** — if you have a medical emergency, call **911**.
> - **Stopping texts:** reply **STOP** to stop **all** texts from us — care messages *and* reminders —
>   because they come from the same number. To stop just **one** kind (for example, keep appointment
>   reminders but stop care messages), tell your care team and we'll turn that one off.
> - Standard message and data rates may apply.
>
> **☐ I understand text messages are not secure, and I agree to send and receive care-related text
> messages with [Clinic].**

On the two blanks:
- **`[COVERAGE WINDOW]` — SET (2026-09-16): Monday–Friday, 9am–5pm Pacific.** The hours the patient is
  told are the same number the escalation SLA (gate item 3) enforces — see the Coverage & escalation
  statement in the inbox gate. Remaining owner item is the sensitive-category cut (§Sensitive
  categories).
- **STOP semantics are now explicit in the text**, because reminder consent (`sms_consent`) and
  clinical-text consent (`sms_clinical_consent`) are separate gates and a patient must not think a
  silent one-channel stop happened. The rule the wording promises, and the system MUST implement:
  - **STOP = the universal kill switch.** It sets `opted_out` and blocks **every** SMS from the shared
    number — reminders and clinical alike — because carrier/Twilio STOP is per-number, not
    per-message-type. There is no way to honor "STOP clinical only" via the STOP keyword; the number
    is one number. Pretending otherwise would be the exact "we ignored them" failure.
  - **Granular opt-out** (drop one gate, keep the other) is a **staff/patient toggle of the specific
    consent flag**, not STOP: clearing `sms_clinical_consent` stops clinical texts while
    `sms_consent` reminders continue, or vice versa. Reachable by "tell your care team"; a
    patient-facing preference is a later nicety.

Capture on agreement: who obtained it (`sms_clinical_consent_by`), when (`_at`), and the wording
**version** (`_version`) so a later change to this text is distinguishable from what a given patient
actually agreed to. Withdrawal via STOP (`opted_out`) or a staff toggle of the flag is logged.

## Sensitive categories (narrowed to a cardiac/kidney/diabetes panel, 2026-09-16)
A nine-item list gets ignored. Narrowed to what actually surfaces in **this** population's care and
carries heightened sensitivity — the point is a bright line clinicians will respect, not
completeness. Split into two buckets because they need different responses:

**A. Do-not-text content (belongs in the app — WARN at compose).** Even with `sms_clinical_consent`,
keep these out of SMS:
- **Substance use disorder** — comorbid alcohol/opioid use is common in cardiac/renal/diabetic
  patients and they're often on controlled substances. Also the strongest legal case (42 CFR Part 2)
  — see the hard-stop note below.
- **Behavioral / mental health** — depression and anxiety are among the most common comorbidities in
  this panel; psychiatric diagnoses, therapy, psych meds. (Self-harm/suicidal ideation is bucket B.)
- **Pregnancy** — clinically you *must* know it (ACE inhibitors/ARBs are teratogenic, several
  diabetes drugs are contraindicated), and it's sensitive. Knowing it is fine; texting about it isn't.
- **HIV status** — plausible via med reconciliation (antiretrovirals affect renal function) and
  legally heightened in many states.

Cut from the earlier draft as noise for this panel (fold under "minimum necessary always applies,"
not their own lines): genetic information, sexual orientation/gender identity, immigration status,
minors' confidential services (that's a consent-authority question — open question #5, not a content
category), and the broader STI list beyond HIV.

**B. Safety-escalation triggers (ACT, don't just redirect).** These aren't "move to the app" — if a
patient texts them, the response is **escalate to a clinician now** (the coverage/escalation chain),
and the "not for emergencies, call 911" language is the backstop:
- **Self-harm / suicidal ideation.**
- **Abuse / intimate-partner violence / a safety concern.**
- **Acute-emergency language** (chest pain, stroke symptoms, severe hypo/hyperglycemia).

## Block vs warn — and the one exception (SUD / 42 CFR Part 2)
**Warn, not hard-block, for content categories — agreed.** A keyword block gives false confidence
(misses coded language) and false positives ("I am *not* depressed"); a filter can't read meaning.
Mechanism: (1) policy — never text bucket A, use the app; (2) a **soft compose-time acknowledgment**
before any free-text SMS; (3) the **notification-only default** already routes sensitive content to
the app; (4) an optional **keyword soft-flag** as a nudge, explicitly labeled a reminder not a
guarantee.

**On SUD/Part 2 — yes, it justifies more than warn, but NOT a keyword hard-block.** The reasoning
that kills keyword-blocking everywhere kills it for SUD too: you can't reliably detect SUD *content*
by keyword. The hard control that actually works is **per-patient, not per-message** — for a patient
**flagged** SUD / Part 2-protected, **disable free-text clinical SMS entirely** and route them to app
or phone. That's a single boolean check, not content inspection: no false positives, no false
confidence, and it gives Part 2's stricter consent + re-disclosure rules the extra margin they
warrant. So: **warn for content in general; a patient-level hard-disable for SUD-flagged patients.**
- *Caveat for the reviewer:* whether our RPM records are even Part 2 depends on facts (is any SUD-
  treatment information actually flowing in?), and that's a legal determination. The patient-flag
  disable is cheap insurance regardless of how that lands. (Mechanism: a per-patient sensitivity flag
  — small addition; where it lives is a Phase-2 detail.)

This resolves open question #3.

## Decisions of record
Decisions made by the owner because the Cleo/Kinza queue is not moving (pending since Sept 9; see
header). Each is revisitable if the reviewers engage.
- **2026-09-16 — Notification-only is the default for clinical content; free-text SMS is a consented
  exception.** (Owner call. §Q4.) Rationale: SMS last mile is unsecured; default must not leak PHI,
  but the owner's goal of real two-way texting is preserved as a deliberate, consented path.
- **2026-09-16 — Twilio BAA asserted in place; proceeding on that basis pending sight of the executed
  agreement.** (Owner assertion. If untrue, it's a current exposure — header.)
- **2026-09-16 — STOP is the universal kill switch; per-type opt-out is a flag toggle, not STOP.**
  (Owner call, §Consent wording.) Reminder consent and clinical consent are separate gates, but STOP
  on the shared number stops everything; keeping one channel while dropping the other is a staff/
  patient toggle of the specific consent flag.
- **2026-09-16 — Inbox coverage: add Kinza (lead RN) as `care_manager` to be the triager; that
  resolves the single point of failure and makes Phase 1 shippable.** (§inbox gate.) Chain becomes
  patient → Kinza (RN triage) → physician; owner is last-resort backstop only. Create her via Admin →
  Users (role dropdown = Care Manager), NOT the Clinicians screen (which forces `clinician` and would
  over-grant note-signing). Recorded risk: a non-clinician escalation target cannot clinically triage
  — safe protocol is reach-a-clinician / redirect-to-911, never self-assess.
- **2026-09-16 — Coverage window = Mon–Fri 9am–5pm Pacific; escalation chain = Kinza (RN, primary) →
  Dr. Aamir (clinical) → Ricky (last-resort, non-clinician).** (§Coverage & escalation statement.)
  SLA proposed at 2 business hours. Concentration risk RECORDED: Kinza is the owner's wife, so primary
  + backstop are one household — the durable fix is a second person outside the household.
- **2026-09-16 — Clinicians screen can't create `care_manager` (hardcodes `clinician`) — logged as a
  followup** (rpm-dashboard FRONTEND_FOLLOWUPS.md #4): that screen should manage clinical staff
  generally. Meanwhile create care_managers via Admin → Users.
- **2026-09-21 — `sms_clinical_consent` wording APPROVED by owner (self-signed).** Was
  [PENDING]; the owner signed off the version in §Consent wording (Mon–Fri 9–5 PT window filled, STOP
  clarified) because the Cleo/Kinza queue never engaged. Phase 2's outbound free-text SMS is no longer
  gated on a reviewer. Wording `_version` is captured per patient on consent.
- **2026-09-16 — Sensitive-category policy: narrowed + warn, with a SUD hard-disable.** (§Sensitive
  categories.) Do-not-text content narrowed to SUD, behavioral health, pregnancy, HIV (rest cut as
  noise for this panel); safety-escalation triggers (SI, IPV, acute emergency) split into their own
  act-don't-redirect bucket. Enforcement = warn (soft compose acknowledgment + notification-only
  default), NOT keyword block. **Exception: SUD/Part 2 gets a per-patient hard-disable of free-text
  clinical SMS** (a patient-flag check, not content inspection). Resolves open question #3. Owner to
  confirm the SUD patient-level disable.

## Open questions — routed to Cleo/Kinza, but NOT blocking (see REVIEW_FOR_CLEO_AND_KINZA.md)
As of 2026-09-16 the review queue has been pending since Sept 9 and Cleo has not accessed her account.
These remain the right questions for a compliance reviewer, but Phase 0 will not wait indefinitely —
unanswered items fall to the owner (§Decisions of record).
1. Is consented limited-content clinical SMS acceptable, or notification-only for all PHI? *(Owner
   has provisionally DECIDED notification-only default + consented free-text exception — confirm.)*
2. Exact `sms_clinical_consent` language + risk acknowledgment; do we version it? *(DRAFT above.)*
3. Sensitive-category exclusions + enforcement. *(RESOLVED by owner 2026-09-16: narrowed list, warn
   not block, SUD patient-level hard-disable — §Sensitive categories. Confirm if you engage.)*
4. Retention/e-discovery: SMS content now lives in `messages` + `notification_log` — retention policy?
5. Minor/proxy patients: who consents, who may text.

---

# Phase 1 — CONCRETE BUILD SPEC (2026-09-21) — supersedes the fix/messages-e2e-based Phase 1 plan above

Owner approved the build 2026-09-21 with four decisions (below). This section is the plan of record;
the earlier `fix/messages-e2e`-based P1-1..P1-7 checklist is retained for history but **not the plan**
(that branch is not being merged — Recommendation #5, revised).

## Trigger (why now, in one line)
A patient replied **4 times on Sept 17 and nobody saw it for 4 days.** Phase 1 exists to make an
inbound patient message — SMS **or** in-app — impossible to miss: it lands in one shared inbox, raises
a shared unread badge, and pushes a no-PHI email to the care team the first time each day.

## Decisions of record — 2026-09-21 (owner)
- **D1 — One inbox.** Rename the existing dashboard tab **"Patient Communication" → "Messages"** and
  **extend** its `ChatInterface` (`rpm-dashboard-v1.0/src/pages/PatientCommunication.jsx`) into the
  care-team-shared inbox. Do NOT add a second messaging tab (that would reintroduce the Alerts-vs-
  Messages confusion this design avoids). "Alerts" stays BP-reading alerts; "Messages" is patient
  conversations.
- **D2 — Email on BOTH channels.** The no-PHI inbound-alert email fires for **SMS inbound AND in-app
  inbound**, keyed off the single unified `messages`-row insert (one code path covers both). An unseen
  in-app message fails exactly like the Sept-17 SMS miss.
- **D3 — Super-admin scope.** The **Messages tab is org-scoped** (the currently-selected clinic via
  `?organizationId`, consistent with every other screen). The **email reaches the owner (super-admin)
  for every org**, so the last-resort backstop is never blind. A true cross-org aggregate view is a
  future additive endpoint, not built now (one live org today).
- **D4 — Ship Phase 1 first**, then Phase 2 (outbound free-text SMS). **Delete `fix/messages-e2e`
  once Phase 1 lands.**
- **Gate item 4 MET** — Kinza = **user 47, `care_manager`, org 2, active** (§PRE-1).
- **Consent wording APPROVED** — owner self-signed 2026-09-21 (§Consent wording); Phase 2 unblocked.

## The core model decision — patient-keyed, care-team-shared conversation
The existing `messages` table is a **1:1 user↔user DM** (`sender_id`,`receiver_id`,`is_read` per
receiver). That cannot express "read for the whole team" (D-req #5) or "the whole care team sees every
patient's thread." So:
- Add **`messages.patient_id`** = the conversation key (the patient party; set at insert, one-time
  backfill of existing rows). The "conversation" is all rows for a `patient_id`, not a sender/receiver
  pair.
- **Shared read = repurpose `is_read` on inbound rows.** An inbound row (`sender_id` = the patient) has
  `is_read` meaning **the care team has read it** — cleared for EVERYONE when any staff member opens
  the patient's thread (keyed to `patient_id`, not the viewer). `read_at`/`read_by` audit who cleared
  it. Outbound rows keep `is_read` = "the patient read it" (for the mobile app) — no conflict.
- The mobile app's existing `/api/messages/*` (send, `/conversations`, `/conversation/:userId`) is
  **untouched** — the new staff endpoints are additive and the schema deltas are nullable/defaulted.

## Data model deltas (one migration, `config/migrations/`; mysqldump prod first — no backups)
- `messages`: **+`patient_id`** INT UNSIGNED NULL FK users (indexed); **+`channel`**
  ENUM('in_app','sms') DEFAULT 'in_app'; **+`notification_log_id`** BIGINT NULL FK notification_log;
  **+`read_at`** TIMESTAMP NULL; **+`read_by`** INT UNSIGNED NULL FK users. Backfill `patient_id` =
  whichever of sender/receiver has role `patient`.
- `notification_log`: **+`message_id`** BIGINT NULL FK messages (back-reference to the human row).
- `patient_comm_prefs`: **+`sms_clinical_consent`** BOOL DEFAULT false, **+`_at`**, **+`_by`** FK users,
  **+`_version`** VARCHAR. (Phase 2 uses these; column added in Phase 1's migration so it's one change.)
- **new `message_notify_log`**: (`id`, `patient_id` FK, `notified_on` DATE, `created_at`),
  **UNIQUE(`patient_id`,`notified_on`)** — the daily-cadence dedupe key.

## Backend tickets (rpm-backend, feature/measured-at)
- **B1 — Migration** (schema deltas + backfill) as above.
- **B2 — `saveMessage` sets `patient_id` + `channel`** (compute the patient party). Additive; mobile
  send path keeps working.
- **B3 — Staff inbox service + endpoints** (role+org scoped; clinician → assigned patients,
  care_manager/admin/super-admin → org via `resolveOrgScope`; access re-checked with `patientAccess`):
  - `GET /api/messages/inbox` — patients in scope, last-message snippet + time + channel + **shared
    unread count**, **unread sorted to top**.
  - `GET /api/messages/unread-count` — total shared inbound unread in scope (nav badge).
  - `GET /api/messages/thread/:patientId` — unified in-app+SMS thread; **marks inbound read (shared)**
    + writes `read_at`/`read_by` + audit (`ACTIONS`).
  - Reply in Phase 1 uses the **in-app** channel via the existing `POST /api/messages/send`
    (sender = staff, receiver = patient; now also stamps `patient_id`/`channel='in_app'`). Outbound
    **free-text SMS** is Phase 2 (gated on `sms_clinical_consent`).
- **B4 — Inbound webhook writes a `messages` row.** In `recordInboundReply`
  (`controllers/notification.controller.js` → `services/notification.service.js`), in addition to the
  existing `notification_log` inbound row, insert a `messages` row (`channel='sms'`,
  `sender_id`=patient, `patient_id`=patient, `is_read=false`) and set `notification_log.message_id`.
  This is what surfaces an SMS reply in the thread + badge (the Sept-17 fix).
- **B5 — No-PHI email fanout + daily cadence.** On the unified `messages`-row insert for an **inbound**
  message (both channels — D2), fan out a no-PHI email to **assigned clinician(s) + org
  care_managers + org admins + all super-admins**. Body: *"You have a new message from a patient in
  [org name]. Log in to view: [link to Messages]."* — no name, no content, no number (copy the
  `sendDigestEmail` no-PHI pattern, nodemailer/Gmail). **Cadence:** `INSERT … ON DUPLICATE KEY` into
  `message_notify_log(patient_id, notified_on)` with `notified_on` in **America/Los_Angeles** (matches
  the coverage clock); send only when the row is newly inserted (first inbound that Pacific day),
  skip otherwise. Fire-and-forget — never blocks/fails the inbound handler or the send.

## Dashboard tickets (rpm-dashboard-v1.0, feature/…)
- **D-1 — Rename tab → "Messages"** (`Sidebar.jsx` label; keep internal id/route to avoid churn in
  `fetchInterceptor` regexes) and **gate visibility** to `clinician, care_manager, admin, super-admin`
  (the existing biller-filter pattern).
- **D-2 — Extend `ChatInterface` into the shared inbox:** source the conversations list from
  **`/api/messages/inbox`** (all patients in scope) instead of `/conversations` (only my DMs); render
  the thread via `/api/messages/thread/:patientId`; keep the reply box posting to `/api/messages/send`
  (in-app, Phase 1).
- **D-3 — Unread badge** on the sidebar "Messages" item from `/api/messages/unread-count` (reuse the
  `Navbar` bell-badge markup). Add any new patient-scoped `/api/messages/*` route to the
  `fetchInterceptor` clinical regexes so super-admin org-scoping (`?organizationId`) is appended.

## What Phase 1 deliberately does NOT include (→ Phase 2)
Outbound **free-text SMS** (`sendClinicalMessage`), the `sms_clinical_consent` capture UI, the compose
box's notification-only-vs-free-text mode + PHI warning + sensitive-term soft-warn, and the SUD/Part-2
per-patient hard-disable. Phase 1's reply box is **in-app only** — so it ships without putting the
(now-approved) consent wording in front of a patient. Phase 1 alone closes the "nobody saw it" gap.

## Ship go/no-go for Phase 1
Gate item 4 (named owner) ✅ MET (Kinza, user 47). Coverage window, escalation chain, and auto-ack
(P1-7 / gate item 5) still apply operationally — the auto-acknowledgement on inbound is recommended
alongside this. Twilio BAA remains owner-asserted (verify the executed agreement).

## Phase 1 — BUILT 2026-09-21 (commits + deploy + followups)
**Backend** (`feature/measured-at`): migration `20260921120000_messages_sms_bridge.js`;
`staffMessages.service.js` + `messageNotify.service.js`; `messageService.saveMessage` stamps
patient_id/channel + fires the alert on inbound; `notification.service.recordInboundReply` mirrors
SMS into `messages`; `mail.sendPatientMessageAlert`; endpoints `GET /api/messages/{inbox,
unread-count,thread/:patientId}` (STAFF + resolveOrgScope).
**Dashboard** (`feature/vitals-integrated`): tab renamed → Messages, `ChatInterface` retargeted to
the shared inbox/thread, sidebar unread badge, interceptor regex broadened.

**DEPLOY ORDER (strict — the code reads new columns):**
1. `mysqldump` prod (`rpm_db` on 50.18.96.20) — no backups exist.
2. Run the migration (`knex migrate:latest` against prod) — adds columns + `message_notify_log`,
   backfills `messages.patient_id`.
3. Deploy backend (`feature/measured-at`).
4. Deploy dashboard (`feature/vitals-integrated`).
5. Set `MESSAGES_LOGIN_URL` (optional; falls back to `DIGEST_LOGIN_URL` then the API base) to the
   dashboard URL so the alert email links somewhere useful.
6. Then delete `fix/messages-e2e` (decision D4).

**Verify after deploy:** (a) send an SMS from a test patient's phone to the clinic number → it
appears in the Messages thread, raises the badge, and the care team gets ONE no-PHI email; a second
SMS same day → no second email. (b) Open the thread as one staff member → badge clears for all.
(c) As super-admin with no clinic selected → Messages shows the select-a-clinic state (409), badge
absent.

**Followups (not blocking Phase 1):**
- **`POST /api/messages/send` has no per-patient access control** (only `authRequired`) — a
  pre-existing gap the staff reply path now leans on. A clinician could POST a message to any
  `receiverId`. Phase 2 hardening: gate `send` with `canAccessPatient` when the sender is staff.
- **Real-time is polling-based** — `socketServer` message handlers are stubbed (commented out), so
  the badge polls (60s) and the list refreshes on thread open. Live push is a later nicety.
- **"Start a NEW conversation" tab** still uses `/api/doctor/assigned` (clinician-scoped), so a
  care_manager/admin sees no patients there to initiate a brand-new thread — they can still REPLY to
  any inbound. An org-wide patient picker for initiating threads is a follow-up (matters more for
  Phase 2 outbound).
- **Unmatched inbound numbers still dropped** (`notification_log.patient_id` NOT NULL) — unchanged;
  the catch-table option remains a separate SECURITY_FOLLOWUPS item.
- **P1-7 auto-acknowledgement** ("we'll reply within one business day; emergencies call 911") is
  recommended alongside this and not yet built.
