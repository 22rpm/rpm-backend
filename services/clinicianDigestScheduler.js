// services/clinicianDigestScheduler.js
//
// Weekly (Monday) / monthly (1st) clinician overview digest — the NO-PHI email nudge
// ("your overview is ready, log in"). Its own module, its own env flag, independent of
// notificationScheduler (different audience + gate). CLINICIAN_OVERVIEW_DESIGN.md Part 1.
//
// OFF BY DEFAULT: runs only when CLINICIAN_DIGEST=on. (The design phrased the flag as
// "=off to disable"; we invert to off-by-default per the build instruction — a mail job must
// be explicitly turned on, after scripts/verifyMail.js confirms prod SMTP.)
//
// SAFETY POSTURE (the recurring silent-failure this design targets):
//  - verifyTransport() at startup — a broken SMTP config is logged loudly, not discovered as
//    a silent no-send.
//  - GET_LOCK single-instance guard (same as notificationScheduler) so two app instances
//    can't double-fire.
//  - Idempotency via digest_sent UNIQUE(clinician_id, period_type, period_start): INSERT
//    IGNORE claims the send; only a NEW claim sends, so a mid-run restart can't double-send.
//  - A send failure is COUNTED as an error (never swallowed) and the claim is left in place
//    (a missed nudge is a soft failure; a double-send is worse), surfaced via digest_run_log.
//  - digest_run_log + GET /api/admin/digest-status + a deadman piggybacked on the live
//    notificationScheduler (checkOverdue) so a dead job is NOTICED.

const db = require("../config/db");
const tzq = require("../config/billingTz");
const mail = require("./mail.service");

const TICK_MS = 15 * 60 * 1000; // every 15 minutes (matches notificationScheduler cadence)
const SEND_HOUR = Number(process.env.CLINICIAN_DIGEST_HOUR) || 7; // 07:00 clinic-local
const LOGIN_URL = process.env.DIGEST_LOGIN_URL || "https://api.twentytwohealth.com";

let timer = null;

function enabled() {
  return process.env.CLINICIAN_DIGEST === "on";
}

// Clinic-local date parts for "now" in an IANA tz.
function clinicNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t)?.value;
    return {
      date: `${g("year")}-${g("month")}-${g("day")}`,
      ym: `${g("year")}-${g("month")}`,
      weekday: g("weekday"), // "Mon", "Tue", ...
      dom: parseInt(g("day"), 10),
      hour: parseInt(g("hour"), 10),
    };
  } catch {
    return null;
  }
}

// Which periods are due for this org right now (clinic-local), at/after the send hour.
function duePeriods(now) {
  if (!now || now.hour < SEND_HOUR) return [];
  const periods = [];
  if (now.weekday === "Mon") periods.push({ type: "week", start: now.date });
  if (now.dom === 1) periods.push({ type: "month", start: `${now.ym}-01` });
  return periods;
}

// Clinicians in an org with >=1 ACTIVE assigned patient, a usable email, and not opted out.
// (A panel where every patient has zero readings still qualifies — "everyone is silent" is
// actionable; only a truly empty panel is excluded, which this JOIN already does.)
async function eligibleClinicians(orgId) {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id, u.email
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'clinician'
       JOIN patient_doctor_assignments pda ON pda.doctor_id = u.id
       JOIN users p ON p.id = pda.patient_id AND p.is_active = 1
       LEFT JOIN clinician_notification_settings s
         ON s.clinician_id = u.id AND s.type = 'overview_digest'
      WHERE u.organization_id = ?
        AND u.is_active = 1
        AND (s.enabled IS NULL OR s.enabled = 1)
        AND u.email IS NOT NULL AND u.email <> ''`,
    [orgId]
  );
  return rows;
}

// Claim (idempotent) then send. Returns "sent" | "skipped" | "error".
async function claimAndSend(clinicianId, email, periodType, periodStart) {
  const [res] = await db.query(
    `INSERT IGNORE INTO digest_sent (clinician_id, period_type, period_start) VALUES (?, ?, ?)`,
    [clinicianId, periodType, periodStart]
  );
  if (!res.affectedRows) return "skipped"; // already sent this period
  try {
    await mail.sendDigestEmail(email, {
      periodLabel: periodType === "week" ? "weekly" : "monthly",
      loginUrl: LOGIN_URL,
    });
    return "sent";
  } catch (err) {
    // Leave the claim in place (no double-send); surface loudly via the run log + logs.
    console.error(`clinician digest: send failed for clinician ${clinicianId}:`, err.message);
    return "error";
  }
}

async function tick() {
  if (!enabled()) return;
  let conn;
  let locked = false;
  try {
    conn = await db.getConnection();
    const [lrows] = await conn.query("SELECT GET_LOCK('clinician_digest', 0) AS ok");
    locked = Number(lrows[0] && lrows[0].ok) === 1;
    if (!locked) return;

    const [orgs] = await db.query("SELECT id, timezone FROM organizations");
    // Aggregate per distinct (type|start) so tz-boundary date differences log separately and
    // a no-op tick (everyone already sent) writes nothing.
    const runs = new Map();
    for (const o of orgs) {
      const tz = tzq.resolveClinicTz(o.timezone);
      const periods = duePeriods(clinicNow(tz));
      for (const per of periods) {
        const key = `${per.type}|${per.start}`;
        const agg = runs.get(key) || { type: per.type, start: per.start, emailed: 0, skipped: 0, errors: 0 };
        let clinicians;
        try {
          clinicians = await eligibleClinicians(o.id);
        } catch (err) {
          console.error(`clinician digest: eligibility query failed for org ${o.id}:`, err.message);
          agg.errors += 1;
          runs.set(key, agg);
          continue;
        }
        for (const c of clinicians) {
          const outcome = await claimAndSend(c.id, c.email, per.type, per.start);
          agg[outcome === "sent" ? "emailed" : outcome === "error" ? "errors" : "skipped"] += 1;
        }
        runs.set(key, agg);
      }
    }
    // One run-log row per period that actually did work (emailed or errored) — a no-op tick
    // (all already sent) is intentionally not logged, so the log reads as real runs.
    for (const agg of runs.values()) {
      if (agg.emailed > 0 || agg.errors > 0) {
        await db.query(
          `INSERT INTO digest_run_log
             (period_type, period_start, started_at, finished_at, clinicians_emailed, skipped, errors)
           VALUES (?, ?, NOW(), NOW(), ?, ?, ?)`,
          [agg.type, agg.start, agg.emailed, agg.skipped, agg.errors]
        );
        console.log(
          `clinician digest: ${agg.type} ${agg.start} — emailed ${agg.emailed}, skipped ${agg.skipped}, errors ${agg.errors}`
        );
      }
    }
  } catch (err) {
    console.error("clinician digest tick failed:", err.message);
  } finally {
    if (conn) {
      try {
        if (locked) await conn.query("SELECT RELEASE_LOCK('clinician_digest')");
      } catch {
        /* lock auto-releases on connection close */
      }
      conn.release();
    }
  }
}

// DEADMAN — called from the live notificationScheduler tick (known-alive, every 15 min) so a
// dead digest job is NOTICED, not silently missed. Returns an array of overdue descriptors.
// Only meaningful while enabled; last-success is the latest digest_run_log per period_type.
// KNOWN LIMITATION: a period with zero eligible clinicians writes no run-log row, so it won't
// advance last-success (a false "overdue" is possible on an empty roster). Acceptable for a
// first pass; refine by logging a no-op run marker once per period.
const GRACE_DAYS = { week: 2, month: 3 };
const INTERVAL_DAYS = { week: 7, month: 31 };

async function checkOverdue() {
  if (!enabled()) return [];
  const overdue = [];
  for (const type of ["week", "month"]) {
    const [rows] = await db.query(
      `SELECT MAX(period_start) AS last FROM digest_run_log WHERE period_type = ? AND clinicians_emailed > 0`,
      [type]
    );
    const last = rows[0] && rows[0].last;
    if (!last) continue; // never run yet — don't cry wolf before the first send
    const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
    if (ageDays > INTERVAL_DAYS[type] + GRACE_DAYS[type]) {
      overdue.push({ period_type: type, last_success: last, age_days: Math.floor(ageDays) });
    }
  }
  return overdue;
}

// Status for GET /api/admin/digest-status.
async function getStatus() {
  const out = { enabled: enabled(), send_hour_clinic_local: SEND_HOUR, periods: {} };
  for (const type of ["week", "month"]) {
    const [rows] = await db.query(
      `SELECT period_start, finished_at, clinicians_emailed, skipped, errors
         FROM digest_run_log WHERE period_type = ? ORDER BY started_at DESC LIMIT 1`,
      [type]
    );
    out.periods[type] = rows[0] || null;
  }
  out.overdue = await checkOverdue();
  return out;
}

function start() {
  if (!enabled()) {
    console.log("🔕 clinician digest scheduler disabled (set CLINICIAN_DIGEST=on to enable)");
    return;
  }
  if (timer) return;
  // Verify SMTP at startup — surface a broken transport loudly rather than no-sending.
  mail
    .verifyTransport()
    .then(() => console.log("clinician digest: SMTP verify OK"))
    .catch((e) => console.error("⚠️ clinician digest: SMTP verify FAILED —", e.message, "(digests will error until fixed)"));
  timer = setInterval(() => {
    tick().catch((e) => console.error("clinician digest:", e.message));
  }, TICK_MS);
  console.log(`📧 clinician digest scheduler started (every ${TICK_MS / 60000}m, send hour ${SEND_HOUR}:00 clinic-local)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, checkOverdue, getStatus, enabled };
