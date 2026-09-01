// services/medication.service.js
//
// Patient-REPORTED medications (medications step 3 — patient entry). A patient reports
// what they take; a clinician confirms it later (step 4). This service is the patient
// side: create / list / edit / delete one's OWN reported medications.
//
// Invariants enforced here (see MEDICATIONS_DESIGN.md):
//   - Everything a patient enters is `unconfirmed`. A patient can NEVER set status,
//     confirm, or reject — those are clinician-only (step 4).
//   - Editing an entry always returns it to `unconfirmed` and clears any prior
//     confirmation/rejection, so a confirmed record cannot silently drift after a
//     patient changes it. This is the mutable-table equivalent of note immutability.
//   - `note_to_pharmacy` is clinic-to-pharmacy and clinician-only: never accepted from
//     a patient, never returned to the patient app.
//   - `rxcui` may be null (free text / degraded cache). Null is a first-class state,
//     surfaced to the clinician as `matched:false`; it is never an error here.

const db = require("../config/db");
const { canAccessPatient } = require("./patientAccess");
const audit = require("./audit.service");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// Trim to null: "" / whitespace / undefined -> null; otherwise trimmed string capped.
function clean(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// Shape a row for the PATIENT app. Excludes clinic-only fields (note_to_pharmacy) and
// internal ids (confirmed_by). Includes reject_reason so the patient can see why an
// entry needs fixing, and `matched` so "not matched to a drug database" is explicit.
function toPatientView(r) {
  return {
    id: r.id,
    drug_name: r.drug_name,
    rxcui: r.rxcui || null,
    matched: r.rxcui != null,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    admin_instructions: r.admin_instructions,
    pharmacy_name: r.pharmacy_name,
    pharmacy_phone: r.pharmacy_phone,
    source: r.source,
    status: r.status, // unconfirmed | confirmed | rejected
    reject_reason: r.reject_reason,
    confirmed_at: r.confirmed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function getOwnedRow(patientId, id) {
  const [rows] = await db.query(`SELECT * FROM patient_medications WHERE id = ?`, [id]);
  const row = rows[0];
  // 404 (not 403) for someone else's row: don't reveal that the id exists.
  if (!row || row.patient_id !== patientId) throw httpError(404, "Medication not found");
  return row;
}

// The patient reports their own medication. patient_id = reporter = the caller.
async function createMedication(user, input) {
  const drug_name = clean(input.drug_name, 255);
  if (!drug_name) throw httpError(400, "drug_name is required");

  // Authoritative org from the users table — not the token — for a data-integrity
  // field (guards against a token that lost org_id; see SECURITY_FOLLOWUPS #9).
  const [[u]] = await db.query(`SELECT organization_id FROM users WHERE id = ?`, [user.id]);
  if (!u || u.organization_id == null) throw httpError(409, "No organization on file for this user");

  const source = input.source === "photo" ? "photo" : "typed";

  const [result] = await db.query(
    `INSERT INTO patient_medications
       (patient_id, organization_id, reported_by, drug_name, rxcui, dose, route,
        frequency, admin_instructions, pharmacy_name, pharmacy_phone, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unconfirmed')`,
    [
      user.id,
      u.organization_id,
      user.id,
      drug_name,
      clean(input.rxcui, 32),
      clean(input.dose, 120),
      clean(input.route, 120),
      clean(input.frequency, 255),
      clean(input.admin_instructions, 500),
      clean(input.pharmacy_name, 255),
      clean(input.pharmacy_phone, 40),
      source,
      // note_to_pharmacy intentionally NOT accepted from the patient.
    ]
  );
  const row = await getOwnedRow(user.id, result.insertId);
  return toPatientView(row);
}

async function listMyMedications(user) {
  const [rows] = await db.query(
    `SELECT * FROM patient_medications
      WHERE patient_id = ?
      ORDER BY created_at DESC, id DESC`,
    [user.id]
  );
  return rows.map(toPatientView);
}

// Patient edits their OWN entry. Any edit returns it to `unconfirmed` and clears
// confirmation/rejection — a patient-modified entry is always pending re-review.
async function updateMyMedication(user, id, input) {
  const row = await getOwnedRow(user.id, id);

  const next = {
    drug_name: input.drug_name !== undefined ? clean(input.drug_name, 255) : row.drug_name,
    rxcui: input.rxcui !== undefined ? clean(input.rxcui, 32) : row.rxcui,
    dose: input.dose !== undefined ? clean(input.dose, 120) : row.dose,
    route: input.route !== undefined ? clean(input.route, 120) : row.route,
    frequency: input.frequency !== undefined ? clean(input.frequency, 255) : row.frequency,
    admin_instructions:
      input.admin_instructions !== undefined ? clean(input.admin_instructions, 500) : row.admin_instructions,
    pharmacy_name: input.pharmacy_name !== undefined ? clean(input.pharmacy_name, 255) : row.pharmacy_name,
    pharmacy_phone: input.pharmacy_phone !== undefined ? clean(input.pharmacy_phone, 40) : row.pharmacy_phone,
  };
  if (!next.drug_name) throw httpError(400, "drug_name is required");

  // Invalidation signal: if this row was CONFIRMED, preserve who/when confirmed into
  // previously_confirmed_* before clearing, so the clinician sees their confirmation
  // was invalidated (revalidation_needed) rather than a silent revert. If the row was
  // already unconfirmed (possibly with an earlier invalidation still pending), leave
  // previously_confirmed_* untouched — a second edit must not erase the first
  // invalidation.
  const wasConfirmed = row.status === "confirmed";

  await db.query(
    `UPDATE patient_medications SET
       drug_name = ?, rxcui = ?, dose = ?, route = ?, frequency = ?,
       admin_instructions = ?, pharmacy_name = ?, pharmacy_phone = ?,
       status = 'unconfirmed', confirmed_by = NULL, confirmed_at = NULL, reject_reason = NULL,
       previously_confirmed_by = CASE WHEN ? THEN ? ELSE previously_confirmed_by END,
       previously_confirmed_at = CASE WHEN ? THEN ? ELSE previously_confirmed_at END,
       updated_at = ?
     WHERE id = ? AND patient_id = ?`,
    [
      next.drug_name, next.rxcui, next.dose, next.route, next.frequency,
      next.admin_instructions, next.pharmacy_name, next.pharmacy_phone,
      wasConfirmed, row.confirmed_by,
      wasConfirmed, row.confirmed_at,
      new Date(), id, user.id,
    ]
  );
  const updated = await getOwnedRow(user.id, id);
  return toPatientView(updated);
}

async function deleteMyMedication(user, id) {
  await getOwnedRow(user.id, id); // ownership check (404 otherwise)
  await db.query(`DELETE FROM patient_medications WHERE id = ? AND patient_id = ?`, [id, user.id]);
  return { deleted: true, id: Number(id) };
}

// ===========================================================================
// Clinician side (step 4). Visibility follows canAccessPatient (org-wide roles see
// all patients in the org; a clinician sees only their assigned patients). CONFIRM /
// REJECT are clinician-only — enforced by requireRole("clinician") at the route AND
// re-checked here by canAccessPatient (which, for a clinician, requires assignment).
// A care_manager/admin can READ the list but the route gate blocks them from
// confirm/reject: confirming what a patient is taking is a clinical judgment, the same
// class of act as signing the note.
// ===========================================================================

// Shape a row for a STAFF viewer. Includes note_to_pharmacy (clinic-facing, just not
// patient-facing) and the confirmation audit fields + names. `revalidation_needed`
// flags an entry a clinician had confirmed that the patient has since edited.
function toClinicianView(r) {
  const revalidationNeeded = r.status === "unconfirmed" && r.previously_confirmed_at != null;
  return {
    id: r.id,
    patient_id: r.patient_id,
    drug_name: r.drug_name,
    rxcui: r.rxcui || null,
    matched: r.rxcui != null,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    admin_instructions: r.admin_instructions,
    pharmacy_name: r.pharmacy_name,
    pharmacy_phone: r.pharmacy_phone,
    note_to_pharmacy: r.note_to_pharmacy,
    source: r.source,
    status: r.status,
    confirmed_by: r.confirmed_by,
    confirmed_by_name: r.confirmed_by_name || null,
    confirmed_at: r.confirmed_at,
    reject_reason: r.reject_reason,
    revalidation_needed: revalidationNeeded,
    previously_confirmed_by: revalidationNeeded ? r.previously_confirmed_by : null,
    previously_confirmed_by_name: revalidationNeeded ? r.previously_confirmed_by_name || null : null,
    previously_confirmed_at: revalidationNeeded ? r.previously_confirmed_at : null,
    // When it last changed — pairs with previously_confirmed_at to show the clinician
    // "you confirmed on X; patient changed it on Y".
    updated_at: r.updated_at,
    created_at: r.created_at,
  };
}

const CLINICIAN_SELECT = `
  SELECT m.*,
         cu.name AS confirmed_by_name,
         pu.name AS previously_confirmed_by_name
    FROM patient_medications m
    LEFT JOIN users cu ON cu.id = m.confirmed_by
    LEFT JOIN users pu ON pu.id = m.previously_confirmed_by
`;

// The patient's medication list for a staff viewer. canAccessPatient self-enforces the
// org boundary and (for a clinician) the assignment requirement.
async function listPatientMedications(actor, orgScope, patientId) {
  const allowed = await canAccessPatient(actor, orgScope, patientId);
  if (!allowed) throw httpError(404, "Patient not found");
  const [rows] = await db.query(
    `${CLINICIAN_SELECT} WHERE m.patient_id = ? ORDER BY m.created_at DESC, m.id DESC`,
    [patientId]
  );
  return rows.map(toClinicianView);
}

async function getStaffRow(id) {
  const [rows] = await db.query(`${CLINICIAN_SELECT} WHERE m.id = ?`, [id]);
  return rows[0] || null;
}

// Clinician confirms an entry. Route already gated to requireRole("clinician"); here we
// re-check patient access (org + assignment) via the row's patient.
async function confirmMedication(actor, orgScope, id, req) {
  const row = await getStaffRow(id);
  if (!row) throw httpError(404, "Medication not found");
  const allowed = await canAccessPatient(actor, orgScope, row.patient_id);
  if (!allowed) throw httpError(404, "Medication not found");

  await db.query(
    `UPDATE patient_medications SET
       status = 'confirmed', confirmed_by = ?, confirmed_at = ?, reject_reason = NULL,
       previously_confirmed_by = NULL, previously_confirmed_at = NULL, updated_at = ?
     WHERE id = ?`,
    [actor.id, new Date(), new Date(), id]
  );
  await audit.record({
    req,
    action: audit.ACTIONS.MEDICATION_CONFIRM,
    entityType: "patient_medication",
    entityId: id,
    metadata: { patient_id: row.patient_id, drug_name: row.drug_name, was_revalidation: row.previously_confirmed_at != null },
  });
  return toClinicianView(await getStaffRow(id));
}

// Clinician rejects an entry. reject_reason is required and shown to the patient so they
// know what to fix. The rejecting clinician + timestamp are captured in the audit log;
// confirmed_by stays NULL (a rejected row is never "confirmed by" anyone).
async function rejectMedication(actor, orgScope, id, reason, req) {
  const r = clean(reason, 500);
  if (!r) throw httpError(400, "A reject reason is required");
  const row = await getStaffRow(id);
  if (!row) throw httpError(404, "Medication not found");
  const allowed = await canAccessPatient(actor, orgScope, row.patient_id);
  if (!allowed) throw httpError(404, "Medication not found");

  await db.query(
    `UPDATE patient_medications SET
       status = 'rejected', reject_reason = ?, confirmed_by = NULL, confirmed_at = NULL,
       previously_confirmed_by = NULL, previously_confirmed_at = NULL, updated_at = ?
     WHERE id = ?`,
    [r, new Date(), id]
  );
  await audit.record({
    req,
    action: audit.ACTIONS.MEDICATION_REJECT,
    entityType: "patient_medication",
    entityId: id,
    metadata: { patient_id: row.patient_id, drug_name: row.drug_name, reason: r },
  });
  return toClinicianView(await getStaffRow(id));
}

module.exports = {
  createMedication,
  listMyMedications,
  updateMyMedication,
  deleteMyMedication,
  listPatientMedications,
  confirmMedication,
  rejectMedication,
};
