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
const {
  normalizeConditions,
  validateConditions,
} = require("../config/icd10Conditions");

const PROGRAM_STATUSES = ["active", "pending", "discharged"];
const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    b.secondary_insurance_payer_id != null &&
    !Number.isInteger(Number(b.secondary_insurance_payer_id))
  )
    errors.push("secondary_insurance_payer_id must be an integer");
  if (b.mrn != null && String(b.mrn).trim().length > 64)
    errors.push("mrn must be 64 characters or fewer");
  // email/phone are the login identifiers. Validate email FORMAT only when a
  // non-empty value is given; "" is allowed (clears it). The "at least one
  // identifier" rule is enforced in the service, which knows the current values
  // (keep-if-absent means the controller can't see them).
  if (b.email != null && b.email !== "" && !EMAIL_RE.test(String(b.email).trim()))
    errors.push("email is not valid");
  if (b.phoneNumber != null && String(b.phoneNumber).trim().length > 32)
    errors.push("phone number must be 32 characters or fewer");
  const condErr = validateConditions(b.conditions);
  if (condErr) errors.push(condErr);
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
      // Identity (users table). Raw pass-through (like mrn): undefined = keep
      // existing; a value = set (phone "" clears to null; email "" is rejected above).
      email: b.email !== undefined ? String(b.email).trim() : undefined,
      phoneNumber: b.phoneNumber !== undefined ? String(b.phoneNumber) : undefined,
      date_of_birth: b.date_of_birth || null,
      enrolled_at: b.enrolled_at || null,
      program_status: b.program_status || "active",
      insurance_payer_id:
        b.insurance_payer_id != null ? Number(b.insurance_payer_id) : null,
      secondary_insurance_payer_id:
        b.secondary_insurance_payer_id != null
          ? Number(b.secondary_insurance_payer_id)
          : null,
      comments: b.comments || null,
      // Pass mrn through RAW (not `|| null`) so the service can tell "absent,
      // keep existing" (undefined) from "explicit clear" (""). See the service.
      mrn: b.mrn,
      // Raw pass-through (like mrn): undefined = keep existing, else set/clear.
      is_dialysis: b.is_dialysis,
      dialysis_clinic: b.dialysis_clinic,
      conditions: normalizeConditions(b.conditions),
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
    const sections = ["profile", "conditions", "care_team"];
    if (result.emailChanged || result.phoneChanged) sections.push("identity");
    audit.recordAsync({
      req,
      action: audit.ACTIONS.PATIENT_UPDATE,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      metadata: {
        sections,
        email_changed: !!result.emailChanged,
        phone_changed: !!result.phoneChanged,
      },
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

// POST /api/patients/:patientId/allergies — record drug-allergy status (the
// profile banner's write path). Body: { substances: string[], nkda: boolean }.
// This is the ONLY way a patient leaves "not recorded" — so "no known drug
// allergies" is always a claim someone actively made, never a default.
async function recordAllergies(req, res) {
  try {
    const b = req.body || {};
    const errors = [];
    if (b.substances != null) {
      if (
        !Array.isArray(b.substances) ||
        b.substances.some((s) => typeof s !== "string")
      )
        errors.push("substances must be an array of strings");
    }
    if (b.nkda != null && typeof b.nkda !== "boolean")
      errors.push("nkda must be a boolean");
    const hasList =
      Array.isArray(b.substances) && b.substances.some((s) => String(s).trim());
    if (b.nkda === true && hasList)
      errors.push(
        "cannot record 'no known drug allergies' together with a list of allergies"
      );
    if (errors.length)
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });

    const patientId = Number(req.params.patientId);
    const result = await editService.recordAllergies({
      patientId,
      orgScope: req.orgScope,
      actorId: req.user.id, // the recorder — never client input
      substances: Array.isArray(b.substances) ? b.substances : [],
      nkda: b.nkda === true,
    });

    audit.recordAsync({
      req,
      action: audit.ACTIONS.PATIENT_UPDATE,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      metadata: { sections: ["allergies"], allergy_status: result.allergy_status },
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("recordAllergies error:", err);
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

// POST /api/patients/:patientId/consent — append a consent EVENT (latest-wins).
// Clinician-gated by the route middleware; obtained_by is set from req.user.id
// in the service, never from the request body.
async function recordConsent(req, res) {
  try {
    const b = req.body || {};
    const errors = [];
    if (!["obtained", "withdrawn"].includes(b.status))
      errors.push("status must be 'obtained' or 'withdrawn'");
    if (!b.consent_date || !isValidDate(b.consent_date))
      errors.push("consent_date is required and must be a valid date");
    if (!["verbal", "written"].includes(b.method))
      errors.push("method must be 'verbal' or 'written'");
    if (
      b.supervising_provider_id != null &&
      !Number.isInteger(Number(b.supervising_provider_id))
    )
      errors.push("supervising_provider_id must be an integer");
    if (errors.length)
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });

    const patientId = Number(req.params.patientId);
    const consent = await editService.recordConsent({
      patientId,
      orgScope: req.orgScope,
      actorId: req.user.id, // the authenticated clinician — never client input
      status: b.status,
      consentDate: b.consent_date,
      method: b.method,
      supervisingProviderId:
        b.supervising_provider_id != null
          ? Number(b.supervising_provider_id)
          : null,
      notes: b.notes != null ? String(b.notes).slice(0, 500) : null,
    });

    audit.recordAsync({
      req,
      action: audit.ACTIONS.PATIENT_CONSENT_RECORDED,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      metadata: {
        consent_id: consent.id,
        status: consent.status,
        method: consent.method,
        consent_date: consent.consent_date,
        obtained_by: consent.obtained_by,
        supervising_provider_id: consent.supervising_provider_id,
      },
    });

    return res.status(201).json({ ok: true, consent });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("recordConsent error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = {
  getPatientForEdit,
  updatePatient,
  recordAllergies,
  getPatientConsent,
  recordConsent,
};
