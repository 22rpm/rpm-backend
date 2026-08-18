// services/careStaff.service.js
//
// Staff-name lookup for attribution in the care-activity UI. Rather than list an
// org's whole roster, this returns the distinct authors who actually appear in
// that org's activity — the staff_user_ids present in time_entries,
// patient_calls, and clinical_notes for the org — joined to users for the name.
//
// This is what resolves super-admins: a super-admin has organization_id NULL,
// but a row they authored carries organization_id = <the org they logged into>,
// so they show up as an author of that org's activity. Returns id + name only
// (no PHI); scoped by the caller's req.orgScope.
const db = require("../config/db");

async function listActivityAuthors(organizationId) {
  const [rows] = await db.query(
    `SELECT u.id, u.name
       FROM users u
      WHERE u.id IN (
        SELECT staff_user_id FROM time_entries   WHERE organization_id = ?
        UNION
        SELECT staff_user_id FROM patient_calls  WHERE organization_id = ?
        UNION
        SELECT staff_user_id FROM clinical_notes WHERE organization_id = ?
      )
      ORDER BY u.name`,
    [organizationId, organizationId, organizationId]
  );
  return rows;
}

module.exports = { listActivityAuthors };
