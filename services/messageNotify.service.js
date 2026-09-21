// services/messageNotify.service.js
//
// No-PHI email alert on an INBOUND patient message (SMS or in-app), with a
// once-per-patient-per-day cadence (CLINICIAN_SMS_DESIGN.md, Phase 1, B5).
//
// Why it exists: a patient replied 4 times on Sept 17 and nobody saw it for 4
// days. The first inbound message from a patient each day pushes an email to the
// care team so an unread message can't sit silently.
//
// ROUTING, not visibility: recipients are resolved by ASSIGNMENT + explicit
// care-team roles — deliberately NOT through patientAccess (that's the visibility
// axis; see its header). Recipients:
//   - the patient's ASSIGNED clinician(s)
//   - the org's care_managers and admins
//   - ALL super-admins (every org — the owner is the last-resort backstop and must
//     never be blind because a different clinic was selected; CLINICIAN_SMS_DESIGN
//     decision D3: scoped VIEW, all-org EMAIL)
//
// The email carries NO PHI (no name, content, or number) — see mail.sendPatientMessageAlert.
//
// Cadence: UNIQUE(patient_id, notified_on) on message_notify_log is the lock. The
// first inbound of a Pacific day claims the row and sends; later ones that day find
// a duplicate and send nothing. "Pacific" matches the clinic coverage clock (M–F 9–5 PT).

const db = require("../config/db");
const mail = require("./mail.service");

const LOGIN_URL =
  process.env.MESSAGES_LOGIN_URL ||
  process.env.DIGEST_LOGIN_URL ||
  "https://api.twentytwohealth.com";

// 'YYYY-MM-DD' for the America/Los_Angeles calendar day (en-CA renders ISO order).
function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function resolveRecipientEmails(patientId, organizationId) {
  const emails = new Set();
  const add = (rows) => {
    for (const r of rows) {
      if (r.email) emails.add(String(r.email).trim().toLowerCase());
    }
  };

  // Assigned clinician(s) for THIS patient.
  const [assigned] = await db.query(
    `SELECT DISTINCT u.email
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'clinician'
       JOIN patient_doctor_assignments pda ON pda.doctor_id = u.id
      WHERE pda.patient_id = ? AND u.is_active = 1 AND u.email IS NOT NULL`,
    [patientId]
  );
  add(assigned);

  // Org care_managers + admins.
  if (organizationId != null) {
    const [orgStaff] = await db.query(
      `SELECT DISTINCT u.email
         FROM users u
         JOIN role r ON r.user_id = u.id
        WHERE u.organization_id = ?
          AND r.role_type IN ('care_manager', 'admin')
          AND u.is_active = 1 AND u.email IS NOT NULL`,
      [organizationId]
    );
    add(orgStaff);
  }

  // All super-admins (every org — D3).
  const [supers] = await db.query(
    `SELECT DISTINCT u.email
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'super-admin'
      WHERE u.is_active = 1 AND u.email IS NOT NULL`
  );
  add(supers);

  return [...emails];
}

async function orgName(organizationId) {
  if (organizationId == null) return null;
  const [rows] = await db.query(
    "SELECT name FROM organizations WHERE id = ? LIMIT 1",
    [organizationId]
  );
  return rows[0]?.name || null;
}

// Fire-and-forget entry point. NEVER throws to the caller — a notify failure must
// not break the inbound webhook or the message insert.
async function notifyInboundMessage({ patientId, organizationId }) {
  try {
    if (!patientId) return;

    // organizationId is optional — callers that already have it (the SMS webhook)
    // pass it; the in-app path lets us resolve it from the patient.
    if (organizationId === undefined) {
      const [prow] = await db.query(
        "SELECT organization_id FROM users WHERE id = ? LIMIT 1",
        [patientId]
      );
      organizationId = prow[0]?.organization_id ?? null;
    }

    const day = pacificDay();

    // Claim today's slot. The UNIQUE index makes this the concurrency lock:
    // exactly one inbound per patient per day gets past here.
    try {
      await db.query(
        "INSERT INTO message_notify_log (patient_id, notified_on) VALUES (?, ?)",
        [patientId, day]
      );
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return; // already notified for this patient today
      }
      throw e;
    }

    const [recipients, name] = await Promise.all([
      resolveRecipientEmails(patientId, organizationId),
      orgName(organizationId),
    ]);

    if (!recipients.length) {
      // Nobody to tell — release the slot so a later inbound (e.g. after an
      // assignment is added today) can retry.
      await db.query(
        "DELETE FROM message_notify_log WHERE patient_id = ? AND notified_on = ?",
        [patientId, day]
      );
      console.warn(
        `messageNotify: no recipients for patient ${patientId} (org ${organizationId}) — slot released`
      );
      return;
    }

    let sent = 0;
    for (const to of recipients) {
      try {
        await mail.sendPatientMessageAlert(to, { orgName: name, loginUrl: LOGIN_URL });
        sent += 1;
      } catch (err) {
        console.error(`messageNotify: send failed to ${to}:`, err.message);
      }
    }

    if (sent === 0) {
      // Total failure — don't burn the day; release so the next inbound retries.
      await db.query(
        "DELETE FROM message_notify_log WHERE patient_id = ? AND notified_on = ?",
        [patientId, day]
      );
      console.error(
        `messageNotify: ALL sends failed for patient ${patientId} — slot released for retry`
      );
    }
  } catch (err) {
    console.error("messageNotify.notifyInboundMessage error:", err.message);
  }
}

module.exports = { notifyInboundMessage, pacificDay, resolveRecipientEmails };
