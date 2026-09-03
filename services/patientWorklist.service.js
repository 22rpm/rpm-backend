// services/patientWorklist.service.js
//
// The staff worklist (§3.2 / Appendix B R6): every patient in the caller's
// organization, one row per patient, assembled from a CONSTANT number of
// batched queries (no N+1) and stitched in JS. A single mega-join is avoided
// because the array columns (conditions, care team) would fan the row set out.
//
// ACCESS BOUNDARY (fixed 2026-09): a clinician is HARD-LIMITED to their assigned
// patients here, server-side, via assignmentScope() — independent of `mine`.
// Previously `mine` was the ONLY thing restricting a clinician's list, which made
// it a UI-state filter over a real access boundary: a clinician who didn't send
// mine=true (the "All patients" toggle) got the whole clinic's roster. That is
// the assignment gate being bypassed by UI state — an access-control defect, not
// a filter quirk. Now: org-wide roles (super-admin/admin/care_manager) see the
// whole org and may use `mine` as an OPTIONAL filter for their own panel; a
// clinician always sees only assigned patients and `mine` is a no-op for them.
// Org scoping (req.orgScope) remains the outer boundary, applied by the caller.
const db = require("../config/db");
const tzq = require("../config/billingTz");
const { assignmentScope, isOrgWide } = require("./patientAccess");
const notif = require("./notification.service");

// "YYYY-MM" -> { start:'YYYY-MM-01', next: first day of next month, label }.
// Falls back to the current (UTC) month for missing/invalid input.
function monthWindow(month) {
  let y, m;
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    y = Number(month.slice(0, 4));
    m = Number(month.slice(5, 7)); // 1..12
  }
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date();
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    start: `${y}-${pad(m)}-01`,
    next: `${ny}-${pad(nm)}-01`,
    label: `${y}-${pad(m)}`,
  };
}

function groupBy(rows, key, mapFn) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(mapFn(r));
  }
  return m;
}

async function getWorklist({ orgScope, user, month, mine }) {
  const win = monthWindow(month); // calendar-month LABELS

  // Clinic-tz month window, matching rpmNote.service so the worklist's monthly
  // time totals cover the same clinic-local month as the note (TZ_FIX_DESIGN.md
  // PR 3). Fail loud if the named-tz tables are missing rather than silently
  // returning zero minutes.
  const [orgRows] = await db.query(
    "SELECT timezone FROM organizations WHERE id = ?",
    [orgScope]
  );
  const clinicTz = tzq.resolveClinicTz(orgRows[0] && orgRows[0].timezone);
  await tzq.assertClinicTz(db, clinicTz);
  const L = tzq.monthLabels(month);

  // 1) Base patient rows (org-scoped). The hard floor is role-based: a clinician
  // is restricted to assigned patients (assignmentScope), org-wide roles add
  // nothing. `mine` is layered ON TOP only as an optional filter for org-wide
  // roles wanting just their own panel — for a clinician it's redundant/no-op.
  const scope = assignmentScope(user, "u.id");
  const params = [orgScope, ...scope.params];
  let scopeClause = scope.clause;
  if (mine && isOrgWide(user)) {
    scopeClause +=
      " AND EXISTS (SELECT 1 FROM patient_doctor_assignments pda WHERE pda.patient_id = u.id AND pda.doctor_id = ?)";
    params.push(user.id);
  }
  const [rows] = await db.query(
    // DATE columns are formatted to plain 'YYYY-MM-DD' strings in SQL: mysql2
    // otherwise returns them as midnight-UTC Date objects that serialize to full
    // ISO timestamps and shift a day for any client west of UTC. last_login is a
    // real timestamp (has a time component) and stays as-is.
    `SELECT u.id, u.name, u.last_login,
            DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth,
            DATE_FORMAT(p.enrolled_at, '%Y-%m-%d') AS enrolled_at,
            p.program_status, p.comments,
            p.is_dialysis, p.dialysis_clinic,
            ip.name AS insurance_payer
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
       LEFT JOIN patient_profiles p ON p.user_id = u.id
       LEFT JOIN insurance_payers ip ON ip.id = p.insurance_payer_id
      WHERE u.organization_id = ?
      ${scopeClause}
      ORDER BY u.name`,
    params
  );

  if (rows.length === 0)
    return { month: win.label, mine: !!mine, patients: [] };

  const ids = rows.map((r) => r.id);

  // 2) Conditions
  const [conds] = await db.query(
    "SELECT patient_id, name FROM patient_conditions WHERE patient_id IN (?)",
    [ids]
  );
  // 3) Care team
  const [team] = await db.query(
    `SELECT pda.patient_id, u.id AS doctor_id, u.name
       FROM patient_doctor_assignments pda
       JOIN users u ON u.id = pda.doctor_id
      WHERE pda.patient_id IN (?)
      ORDER BY u.name`,
    [ids]
  );
  // 4) Monthly monitoring time — head-of-chain time_entries in the month window.
  const [mins] = await db.query(
    `SELECT t.patient_id, SUM(t.duration_seconds) AS secs
       FROM time_entries t
       LEFT JOIN time_entries s ON s.supersedes = t.id
      WHERE s.id IS NULL
        AND t.organization_id = ?
        AND t.patient_id IN (?)
        AND ${tzq.monthWhereSql("t.started_at")}
      GROUP BY t.patient_id`,
    [orgScope, ids, ...tzq.monthParams(L, clinicTz)]
  );
  // 5) Billing status for the month (billing_month is the first of the month).
  const [bills] = await db.query(
    `SELECT patient_id, status
       FROM patient_billing_status
      WHERE organization_id = ? AND billing_month = ? AND patient_id IN (?)`,
    [orgScope, win.start, ids]
  );
  // 6) Last interaction — newest head-of-chain call or note per patient, with
  // who. Calls order by started_at, notes by created_at. One query; the newest
  // per patient is the first row after ordering.
  const [inter] = await db.query(
    `SELECT x.patient_id, x.when_ts, x.type, u.name AS staff_name
       FROM (
         SELECT c.patient_id, c.started_at AS when_ts, 'call' AS type, c.staff_user_id
           FROM patient_calls c
           LEFT JOIN patient_calls cs ON cs.supersedes = c.id
          WHERE cs.id IS NULL AND c.organization_id = ? AND c.patient_id IN (?)
         UNION ALL
         SELECT n.patient_id, n.created_at AS when_ts, 'note' AS type, n.staff_user_id
           FROM clinical_notes n
           LEFT JOIN clinical_notes ns ON ns.supersedes = n.id
          WHERE ns.id IS NULL AND n.organization_id = ? AND n.patient_id IN (?)
       ) x
       JOIN users u ON u.id = x.staff_user_id
      ORDER BY x.patient_id, x.when_ts DESC`,
    [orgScope, ids, orgScope, ids]
  );

  const condMap = groupBy(conds, "patient_id", (r) => r.name);
  const teamMap = groupBy(team, "patient_id", (r) => ({
    id: r.doctor_id,
    name: r.name,
  }));
  const minMap = new Map(
    mins.map((r) => [r.patient_id, Math.floor(Number(r.secs || 0) / 60)])
  );
  const billMap = new Map(bills.map((r) => [r.patient_id, r.status]));

  // Scheduled calls: next upcoming + an overdue flag (still 'scheduled', past its time —
  // a patient nobody talked to). Plus the last RECORDED call (patient_calls only,
  // head-of-chain), distinct from last_interaction which also counts notes.
  const [sched] = await db.query(
    `SELECT patient_id,
            MIN(CASE WHEN status='scheduled' AND scheduled_at >= NOW() THEN scheduled_at END) AS next_scheduled,
            MAX(CASE WHEN status='scheduled' AND scheduled_at <  NOW() THEN 1 ELSE 0 END) AS overdue
       FROM scheduled_calls
      WHERE organization_id = ? AND patient_id IN (?)
      GROUP BY patient_id`,
    [orgScope, ids]
  );
  const [lastCall] = await db.query(
    `SELECT c.patient_id, MAX(c.started_at) AS last_call
       FROM patient_calls c
       LEFT JOIN patient_calls cs ON cs.supersedes = c.id
      WHERE cs.id IS NULL AND c.organization_id = ? AND c.patient_id IN (?)
      GROUP BY c.patient_id`,
    [orgScope, ids]
  );
  const schedMap = new Map(sched.map((r) => [r.patient_id, r]));
  const lastCallMap = new Map(lastCall.map((r) => [r.patient_id, r.last_call]));
  // Unacknowledged inbound SMS replies per patient — powers the "reply waiting"
  // badge on the list, so a reply isn't buried inside the Notifications tab.
  const replyMap = await notif.unreadInboundByPatient(ids);

  const lastMap = new Map();
  for (const r of inter) {
    if (!lastMap.has(r.patient_id))
      lastMap.set(r.patient_id, {
        date: r.when_ts,
        staff_name: r.staff_name,
        type: r.type,
      });
  }

  const patients = rows.map((r) => ({
    id: r.id,
    name: r.name,
    date_of_birth: r.date_of_birth,
    enrolled_at: r.enrolled_at,
    program_status: r.program_status,
    last_login: r.last_login,
    comments: r.comments,
    is_dialysis: !!r.is_dialysis,
    dialysis_clinic: r.dialysis_clinic || null,
    insurance_payer: r.insurance_payer || null,
    conditions: condMap.get(r.id) || [],
    care_team: teamMap.get(r.id) || [],
    total_minutes: minMap.get(r.id) || 0,
    billing_status: billMap.get(r.id) || null,
    last_interaction: lastMap.get(r.id) || null,
    last_call: lastCallMap.get(r.id) || null,
    next_scheduled_call: schedMap.get(r.id)?.next_scheduled || null,
    scheduled_overdue: !!(schedMap.get(r.id)?.overdue),
    reply_waiting: replyMap[r.id]?.count || 0,
    reply_oldest: replyMap[r.id]?.oldest || null,
  }));

  return { month: win.label, mine: !!mine, patients };
}

// Distinct dialysis clinic names in the org — powers the patient-list filter dropdown
// and the entry-form datalist (free text that self-normalizes toward existing values).
async function listDialysisClinics(orgScope) {
  const [rows] = await db.query(
    `SELECT DISTINCT p.dialysis_clinic AS clinic
       FROM patient_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.organization_id = ?
        AND p.dialysis_clinic IS NOT NULL AND p.dialysis_clinic <> ''
      ORDER BY p.dialysis_clinic`,
    [orgScope]
  );
  return rows.map((r) => r.clinic);
}

module.exports = { getWorklist, listDialysisClinics };
