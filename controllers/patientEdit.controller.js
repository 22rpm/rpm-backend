// controllers/patientEdit.controller.js
//
// GET  /api/patients/:patientId          — editable detail (prefill)
// PATCH /api/patients/:patientId          — upsert profile + conditions + care team
//
// Profile/clinical fields only. Identity fields (name/email/phone/username) live
// in the users table with their own UNIQUE constraints and stay in user
// management. Devices and consent are append-only ledgers handled elsewhere.
const editService = require("../services/patientEdit.service");
const audit = require("../services/audit.service");

const PROGRAM_STATUSES = ["active", "pending", "discharged"];
const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());

function validate(b) {
  const errors = [];
  if (b.program_status != null && !PROGRAM_STATUSES.includes(b.program_status))
    errors.push("program_status must be one of: " + PROGRAM_STATUSES.join(", "));
  if (b.date_of_birth != null && b.date_of_birth !== "") {
    if (!isValidDate(b.date_of_birth))
      errors.push("date_of_birth is not a valid date");
    else if (new Date(b.date_of_birth) > new Date())
      errors.push("date_of_birth cannot be in the future");
  }
  if (
    b.enrolled_at != null &&
    b.enrolled_at !== "" &&
    !isValidDate(b.enrolled_at)
  )
    errors.push("enrolled_at is not a valid date");
  if (
    b.insurance_payer_id != null &&
    !Number.isInteger(Number(b.insurance_payer_id))
  )
    errors.push("insurance_payer_id must be an integer");
  if (
    b.conditions != null &&
    (!Array.isArray(b.conditions) ||
      b.conditions.some((c) => typeof c !== "string" || !c.trim()))
  )
    errors.push("conditions must be an array of non-empty strings");
  if (!Array.isArray(b.care_team) || b.care_team.length === 0)
    errors.push("care_team is required — assign at least one clinician");
  else if (b.care_team.some((id) => !Number.isInteger(Number(id))))
    errors.push("care_team must be an array of user ids");
  return errors;
}

async function getPatientForEdit(req, res) {
  try {
    const detail = await editService.getPatientForEdit(
      Number(req.params.patientId),
      req.orgScope
    );
    return res.status(200).json({ ok: true, patient: detail });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getPatientForEdit error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function updatePatient(req, res) {
  try {
    const b = req.body || {};
    const errors = validate(b);
    if (errors.length)
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });

    const patientId = Number(req.params.patientId);
    const data = {
      date_of_birth: b.date_of_birth || null,
      enrolled_at: b.enrolled_at || null,
      program_status: b.program_status || "active",
      insurance_payer_id:
        b.insurance_payer_id != null ? Number(b.insurance_payer_id) : null,
      comments: b.comments || null,
      conditions: Array.isArray(b.conditions)
        ? b.conditions.map((c) => c.trim()).filter(Boolean)
        : [],
      care_team: b.care_team.map((id) => Number(id)),
    };

    const result = await editService.updatePatient({
      patientId,
      orgScope: req.orgScope,
      actorId: req.user.id,
      data,
    });

    // Audit AFTER commit. organizationId is the patient's clinic (req.orgScope),
    // NOT req.user.org_id — which is NULL for a super-admin and would misattribute
    // the entry. Values in metadata are ids/flags and (for enrolment) the dates
    // the change exists to record.
    audit.recordAsync({
      req,
      action: audit.ACTIONS.PATIENT_UPDATE,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      metadata: { sections: ["profile", "conditions", "care_team"] },
    });
    if (result.enrolledAtChanged) {
      audit.recordAsync({
        req,
        action: audit.ACTIONS.PATIENT_ENROLLMENT_CHANGE,
        entityType: "patient",
        entityId: patientId,
        organizationId: req.orgScope,
        metadata: { from: result.from, to: result.to },
      });
    }

    return res
      .status(200)
      .json({ ok: true, enrolled_at_changed: result.enrolledAtChanged });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("updatePatient error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/consent — read-only latest-wins consent record for
// the vitals-header consent view. Org-scoped (matches getPatientForEdit, the header
// endpoint it sits beside). `consent: null` means no consent on record.
async function getPatientConsent(req, res) {
  try {
    const consent = await editService.getLatestConsent(
      Number(req.params.patientId),
      req.orgScope
    );
    return res.status(200).json({ ok: true, consent });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getPatientConsent error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { getPatientForEdit, updatePatient, getPatientConsent };
