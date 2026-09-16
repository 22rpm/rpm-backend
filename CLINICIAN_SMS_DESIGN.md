# Two-way clinician↔patient SMS — design (SCOPE, not built)

**Status:** DESIGN. **Date:** 2026-09-16. Compliance items (§Q4, §Q3) are **blocking prerequisites**
routed to Cleo/Kinza — no code before they're settled.

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

**Decision / recommendation:**
- **Get a Twilio BAA** (Twilio signs one and offers HIPAA-eligible messaging). It covers Twilio's
  handling; be honest that it does **not** secure the carrier/device last mile — consent covers that.
- **Default to notification-only** for clinical content. The secure in-app thread is where real
  clinical discussion happens.
- **Allow free-text clinical SMS as a consented exception** (Q3), with: minimum-necessary content, a
  **PHI warning banner in the compose box**, an optional **sensitive-term soft-warning** before send,
  and full logging. This is the path that satisfies the user's stated goal without pretending SMS is
  secure.
- **Never** put PHI in the *outbound reminder/nudge* templates (they already avoid it — keep it so).

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
- **Phase 0 — compliance gate (BLOCKING, Cleo/Kinza):** Twilio BAA signed; `sms_clinical_consent`
  language + risk-acknowledgment wording; sensitive-category policy; sign-off that consented
  limited-content clinical SMS is acceptable, or that we go notification-only. **No code until this
  clears.**
- **Phase 1 — unify + surface inbound:** land `fix/messages-e2e`; add `channel` to `messages`; make
  the `sms-inbound` webhook append a `messages` row so patient replies appear in the unified thread/
  inbox (today they only raise a badge). Low-risk, immediately useful.
- **Phase 2 — outbound free-text SMS:** `sms_clinical_consent` flag + UI; `sendClinicalMessage`
  endpoint (gated, attribution, `messages`+`notification_log`+Twilio, delivery wired back); compose
  box in the thread with the PHI warning + consent state shown.
- **Phase 3 — polish:** conversation assignment, sensitive-term soft warnings, per-patient preferred
  channel; per-clinician numbers only if 1:1 identity is later required.

## Open questions for Cleo/Kinza (compliance) — see REVIEW_FOR_CLEO_AND_KINZA.md
1. Is consented limited-content clinical SMS acceptable, or is the org notification-only for all PHI?
2. Exact `sms_clinical_consent` language + risk acknowledgment; do we version it?
3. Sensitive-category exclusions and how (if at all) we enforce them (block vs warn).
4. Retention/e-discovery: SMS content now lives in `messages` + `notification_log` — retention policy?
5. Minor/proxy patients: who consents, who may text.
