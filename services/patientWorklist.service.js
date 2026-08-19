// services/patientWorklist.service.js
//
// The staff worklist (§3.2 / Appendix B R6): every patient in the caller's
// organization, one row per patient, assembled from a CONSTANT number of
// batched queries (no N+1) and stitched in JS. A single mega-join is avoided
// because the array columns (conditions, care team) would fan the row set out.
//
// `mine` is a FILTER — patients whose care team includes the caller — never a
// permission boundary. A clinician may still request the whole clinic (§3.2);
// org scoping (req.orgScope) is the only boundary and is applied by the caller.
const db = require("../config/db");

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

async function getWorklist({ orgScope, userId, month, mine }) {
  const win = monthWindow(month);

  // 1) Base patient rows (org-scoped). `mine` only adds an EXISTS filter.
  const params = [orgScope];
  let mineClause = "";
  if (mine) {
    mineClause =
      "AND EXISTS (SELECT 1 FROM patient_doctor_assignments pda WHERE pda.patient_id = u.id AND pda.doctor_id = ?)";
    params.push(userId);
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
            ip.name AS insurance_payer
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
       LEFT JOIN patient_profiles p ON p.user_id = u.id
       LEFT JOIN insurance_payers ip ON ip.id = p.insurance_payer_id
      WHERE u.organization_id = ?
      ${mineClause}
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
        AND t.started_at >= ? AND t.started_at < ?
      GROUP BY t.patient_id`,
    [orgScope, ids, win.start, win.next]
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
    insurance_payer: r.insurance_payer || null,
    conditions: condMap.get(r.id) || [],
    care_team: teamMap.get(r.id) || [],
    total_minutes: minMap.get(r.id) || 0,
    billing_status: billMap.get(r.id) || null,
    last_interaction: lastMap.get(r.id) || null,
  }));

  return { month: win.label, mine: !!mine, patients };
}

module.exports = { getWorklist };
