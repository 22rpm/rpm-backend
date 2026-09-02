// services/notificationScheduler.js
//
// The tick loop that fires due automated notifications. No cron dependency — a
// plain interval that checks, per org, whether the current CLINIC-LOCAL time is
// inside the send window before sending anything.
//
// SEND WINDOW: 9am–6pm CLINIC-local (config/notifications SEND_WINDOW). A reminder
// at 3am is what makes an elderly patient turn notifications off. LIMITATION: this
// uses the CLINIC timezone, not the patient's (patient tz isn't reliably known —
// see the tz work). Best available proxy, not a guarantee.
//
// SINGLE-INSTANCE: a MySQL GET_LOCK advisory lock guards the tick so a second app
// instance can't double-fire. Per-patient/per-day idempotency in notification_log
// is the backstop.

const db = require("../config/db");
const tzq = require("../config/billingTz");
const notif = require("./notification.service");
const { SEND_WINDOW } = require("../config/notifications");

const TICK_MS = 15 * 60 * 1000; // every 15 minutes
const CALL_PROMPT_WINDOW_DAYS = 3; // remind when a call is within N days
const CALL_PROMPT_DEDUPE_DAYS = 7; // at most one call prompt per week

let timer = null;

// Current hour (0-23) in a given IANA timezone.
function clinicHour(tz) {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    return parseInt(h, 10);
  } catch {
    return null;
  }
}

function inWindow(tz) {
  const h = clinicHour(tz);
  if (h == null) return false;
  return h >= SEND_WINDOW.startHour && h < SEND_WINDOW.endHour;
}

async function orgsInWindow() {
  const [orgs] = await db.query("SELECT id, timezone FROM organizations");
  return orgs
    .map((o) => ({ id: o.id, tz: tzq.resolveClinicTz(o.timezone) }))
    .filter((o) => inWindow(o.tz));
}

async function runReadingReminders(orgId) {
  const [cands] = await db.query(
    `SELECT u.id, COALESCE(s.cadence_days, 3) AS cadence
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
       JOIN patient_notification_settings s
         ON s.patient_id = u.id AND s.type = 'reading_reminder' AND s.enabled = 1
       JOIN patient_comm_prefs p
         ON p.patient_id = u.id AND p.sms_consent = 1 AND p.opted_out = 0
      WHERE u.organization_id = ? AND u.is_active = 1`,
    [orgId]
  );
  for (const c of cands) {
    const cadence = Number(c.cadence) || 3;
    // Not due yet if we already reminded within the cadence window.
    if (await notif.sentTypeWithinDays(c.id, "reading_reminder", cadence)) continue;
    // Deduped against COMPLIANCE: if they've transmitted recently, don't nag —
    // and log the skip so the dedupe is visible.
    if (await notif.hasRecentReading(c.id, cadence)) {
      await notif.recordSkip({ patientId: c.id, organizationId: orgId, type: "reading_reminder", reason: "compliant" });
      continue;
    }
    await notif.sendNotification({ patientId: c.id, type: "reading_reminder" });
  }
}

async function runCallPrompts(orgId) {
  const [cands] = await db.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN patient_notification_settings s
         ON s.patient_id = u.id AND s.type = 'call_prompt' AND s.enabled = 1
       JOIN patient_comm_prefs p
         ON p.patient_id = u.id AND p.sms_consent = 1 AND p.opted_out = 0
       JOIN scheduled_calls sc
         ON sc.patient_id = u.id AND sc.status = 'scheduled'
        AND sc.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL ? DAY
      WHERE u.organization_id = ? AND u.is_active = 1`,
    [CALL_PROMPT_WINDOW_DAYS, orgId]
  );
  for (const c of cands) {
    if (await notif.sentTypeWithinDays(c.id, "call_prompt", CALL_PROMPT_DEDUPE_DAYS)) continue;
    await notif.sendNotification({ patientId: c.id, type: "call_prompt" });
  }
}

async function tick() {
  // Single-instance guard: an advisory lock so a second app instance can't
  // double-fire. GET_LOCK/RELEASE_LOCK are SESSION-scoped, so they must run on the
  // SAME connection — hold one dedicated connection for the lock's lifetime (the
  // per-org work queries still use the pool).
  let conn;
  let locked = false;
  try {
    conn = await db.getConnection();
    const [lrows] = await conn.query("SELECT GET_LOCK('notif_scheduler', 0) AS ok");
    locked = Number(lrows[0] && lrows[0].ok) === 1;
    if (!locked) return;

    const orgs = await orgsInWindow();
    for (const org of orgs) {
      try {
        await runReadingReminders(org.id);
        await runCallPrompts(org.id);
      } catch (err) {
        console.error(`notification scheduler: org ${org.id} tick failed:`, err.message);
      }
    }
  } catch (err) {
    console.error("notification scheduler tick failed:", err.message);
  } finally {
    if (conn) {
      try {
        if (locked) await conn.query("SELECT RELEASE_LOCK('notif_scheduler')");
      } catch {
        /* lock auto-releases when the connection closes */
      }
      conn.release();
    }
  }
}

function start() {
  if (process.env.NOTIFICATIONS_SCHEDULER === "off") {
    console.log("🔕 notification scheduler disabled (NOTIFICATIONS_SCHEDULER=off)");
    return;
  }
  if (timer) return;
  // A short delay after boot, then every TICK_MS.
  timer = setInterval(() => {
    tick().catch((e) => console.error("notification scheduler:", e.message));
  }, TICK_MS);
  console.log(`🔔 notification scheduler started (every ${TICK_MS / 60000}m, send window ${SEND_WINDOW.startHour}:00–${SEND_WINDOW.endHour}:00 clinic-local)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, runReadingReminders, runCallPrompts };
