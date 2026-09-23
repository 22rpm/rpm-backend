// config/notifications.js
//
// Automated patient-notification types + message copy, in one file.
//
// COPY RULES (see NOTIFICATIONS_DESIGN):
//  - Identify the CLINIC, never an individual clinician — these are automated
//    system messages nobody read before sending.
//  - Always carry an opt-out instruction ("Reply STOP to opt out").
//  - Never solicit a reply: patient replies land in the (currently unmonitored)
//    Messages feature, so the copy must not imply someone is reading.
//
// SCOPE: reading_reminder + call_prompt are LIVE. birthday is DEFINED but HELD
// (least clinical value, most consent exposure) — the scheduler does not send it
// yet. auto-ack is not here at all (blocked on Messages being merged + monitored).

const OPT_OUT = "Reply STOP to opt out.";

// Send window, in CLINIC-LOCAL time. A reminder at 3am is what makes an elderly
// patient turn notifications off entirely. LIMITATION: we use the CLINIC timezone,
// not the patient's — patient timezone isn't reliably known (see the tz work). A
// patient in a different zone from their clinic may get a message outside their own
// 9–6 window; clinic-local is the best available proxy, not a guarantee.
const SEND_WINDOW = { startHour: 9, endHour: 18 }; // [9:00, 18:00)

const TYPES = {
  reading_reminder: {
    key: "reading_reminder",
    label: "Reading reminders",
    defaultCadenceDays: 3,
    live: true,
    // Skipped when the patient already transmitted within the cadence window
    // (deduped against compliance, not against the in-app banner).
    body: ({ clinicName }) =>
      `${clinicName}: This is a reminder to take your health reading today. ${OPT_OUT}`,
  },
  call_prompt: {
    key: "call_prompt",
    label: "Monthly call prompt",
    live: true,
    // NOT a booking link — no patient-facing booking surface exists. A prompt to
    // EXPECT the call.
    body: ({ clinicName }) =>
      `${clinicName}: Your care team will call you this month for your monthly check-in. ${OPT_OUT}`,
  },
  birthday: {
    key: "birthday",
    label: "Birthday message",
    live: false, // HELD — do not send yet (consent exposure); revisit later.
    body: ({ clinicName }) => `${clinicName}: Wishing you a happy birthday! ${OPT_OUT}`,
  },
};

// The reply a patient gets to HELP (STOP/START are handled by Twilio's own copy,
// but we answer HELP with clinic contact info).
const HELP_BODY = ({ clinicName, clinicPhone }) =>
  `${clinicName}: For help, call ${clinicPhone || "your clinic"}. Reply STOP to opt out.`;

// Auto-acknowledgement to a patient who texts the clinic (CLINICIAN_SMS_DESIGN P1-7).
// NO PHI. Sets the response expectation (the coverage window) and the emergency backstop.
// PATIENT-SMS-COPY: reviewed & signed off by Dr. Aamir Jamal 2026-09-23. GSM-7 ONLY
// (no em-dash, curly quotes, or emoji) so it stays 2 segments, not UCS-2. Reconciled with
// the sms_clinical_consent wording: readings/symptoms are fine over text; record number,
// lab results, and medication details are not (either direction).
const AUTO_ACK_BODY = ({ clinicName }) =>
  `${clinicName || "Your care team"}: Thanks for your message. A team member replies within one business day (Mon-Fri, 9am-5pm Pacific), not 24/7. Readings and symptoms are fine to text. Please do not text your record number, lab results, or medication details - call us. Emergency? Call 911.`;

// Notification-only nudge — NO PHI. The default clinical path: tells the patient to open
// the app, carries no content. Same sender identity as the auto-ack (clinic name only, no
// person/credential), so the patient sees ONE consistent sender across all our SMS. This
// is what a clinician sends to a patient who has no clinical-SMS consent, or who is
// SUD/Part 2 hard-disabled — the nudge still works when free-text is blocked.
const NUDGE_BODY = ({ clinicName }) =>
  `${clinicName || "Your care team"}: You have a new message from your care team. Please open the app to read it.`;

// Version of the APPROVED sms_clinical_consent wording (CLINICIAN_SMS_DESIGN.md). Stamped
// SERVER-SIDE on every consent record — never from the client — so a later wording change
// is distinguishable from what a given patient actually agreed to.
// v2-2026-09-23: narrowed scope (readings/symptoms only; record number, lab results, and
// medication details excluded) + org named; clinically signed off by Dr. Aamir Jamal.
// v1-2026-09-21 was the owner-approved broader wording ("readings, symptoms, or medications").
const SMS_CLINICAL_CONSENT_VERSION = "v2-2026-09-23";

// How clinical-SMS consent was obtained — a CODED set, never free text, so a diagnosis
// can never be typed into it. Staff records consent on the patient's behalf, so these
// are the only two ways it happens. Matches the consent_method enum column.
const SMS_CLINICAL_CONSENT_METHODS = ["verbal_phone", "in_person"];

const LIVE_TYPES = Object.values(TYPES).filter((t) => t.live).map((t) => t.key);

module.exports = {
  TYPES,
  LIVE_TYPES,
  SEND_WINDOW,
  HELP_BODY,
  AUTO_ACK_BODY,
  NUDGE_BODY,
  OPT_OUT,
  SMS_CLINICAL_CONSENT_VERSION,
  SMS_CLINICAL_CONSENT_METHODS,
};
