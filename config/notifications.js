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

const LIVE_TYPES = Object.values(TYPES).filter((t) => t.live).map((t) => t.key);

module.exports = { TYPES, LIVE_TYPES, SEND_WINDOW, HELP_BODY, OPT_OUT };
