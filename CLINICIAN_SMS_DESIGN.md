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
consented exception** (§Q4, §Decisions); (2) the `sms_clinical_consent` wording → **DRAFT below,
pending owner sign-off before it ships** (§Consent wording).

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
5. **Merge/land `fix/messages-e2e` FIRST** and build SMS on top of its inbox — don't fork a parallel
   inbox. (Today that branch's clinician inbox + unread badge are unmerged; SMS two-way without it
   would create the exact second-silo problem in Q5.)

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

## Consent wording — `sms_clinical_consent` (DRAFT — owner sign-off required before it ships)
Patient-facing risk acknowledgment obtained before any free-text clinical SMS. **Not yet approved —
do not put in front of a patient until the owner signs off.** Plain language, ~8th-grade reading
level. `[Clinic]` = the practice name shown to the patient (e.g. "Quantix Health").

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

## Sensitive categories — do-not-text list (DRAFT to cut from)
Even *with* `sms_clinical_consent`, some content shouldn't go over SMS — it belongs in the secure app.
This is the owner's starting list to cut from; the enforcement mechanism (block vs warn) is open
question #3. Starred (★) categories carry **specific heightened legal protection** beyond general
HIPAA, so they warrant the firmest stance:
- ★ **Substance use disorder** — treatment, diagnosis, or history. (Federal **42 CFR Part 2** — stricter
  consent than HIPAA; consider disallowing free-text SMS entirely for Part 2–protected care.)
- **Mental / behavioral health** — psychiatric diagnoses, therapy, psychiatric meds, and especially any
  mention of self-harm or suicidal ideation (which is also an escalation event, not just a text).
- ★ **HIV/AIDS status and other STIs** — many states have specific confidentiality statutes.
- **Reproductive & sexual health** — pregnancy, abortion, contraception, fertility, miscarriage
  (elevated sensitivity, including cross-state exposure).
- ★ **Genetic information / test results** (GINA).
- **Sexual orientation & gender identity.**
- **Abuse / interpersonal violence / safety concerns** (child abuse, intimate-partner violence).
- **Minors' confidential services** — adolescent care a minor may control without a parent (varies by
  state; ties to open question #5).
- **Immigration status** or other data that could expose a patient to legal/social harm.

Most of these are unlikely to surface for a cardiac/kidney/diabetes RPM population, but the policy
should still name them so a clinician has a bright line.

**Enforcement recommendation:** do **not** rely on a hard keyword block — it gives false confidence
(misses coded language) and false positives (blocks "I am *not* depressed"), and a filter can't
understand meaning. Instead: (1) **policy** — never text these, use the app; (2) a **soft compose-time
acknowledgment** listing the categories that the clinician confirms before any free-text SMS send;
(3) lean on the **notification-only default**, which already routes sensitive content to the app; and
(4) optionally a **keyword soft-flag** as a nudge (warn, never block), labeled explicitly as a reminder,
not a guarantee. The one place to consider a hard stance is ★ SUD/Part 2 — possibly no free-text SMS at
all for those patients. Final call is open question #3.

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
- **[PENDING owner sign-off] — `sms_clinical_consent` wording** (DRAFT above; coverage window now
  filled).
- **[PENDING owner decision] — sensitive-category policy** — DRAFT list + enforcement recommendation
  now in §Sensitive categories; owner to cut/confirm and pick block-vs-warn (open question #3).

## Open questions — routed to Cleo/Kinza, but NOT blocking (see REVIEW_FOR_CLEO_AND_KINZA.md)
As of 2026-09-16 the review queue has been pending since Sept 9 and Cleo has not accessed her account.
These remain the right questions for a compliance reviewer, but Phase 0 will not wait indefinitely —
unanswered items fall to the owner (§Decisions of record).
1. Is consented limited-content clinical SMS acceptable, or notification-only for all PHI? *(Owner
   has provisionally DECIDED notification-only default + consented free-text exception — confirm.)*
2. Exact `sms_clinical_consent` language + risk acknowledgment; do we version it? *(DRAFT above.)*
3. Sensitive-category exclusions and how (if at all) we enforce them (block vs warn).
4. Retention/e-discovery: SMS content now lives in `messages` + `notification_log` — retention policy?
5. Minor/proxy patients: who consents, who may text.
