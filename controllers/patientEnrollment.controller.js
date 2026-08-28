// controllers/patientEnrollment.controller.js
//
// POST /api/patients — enroll a patient (§3.1). Format/enum validation here;
// relational validation (care team, payer, device type) happens inside the
// service transaction. organization_id = req.orgScope and all actor ids =
// req.user.id — never from the body. Email is required for now (the users.email
// nullability migration is deferred — see EMAIL_NULLABILITY_AUDIT.md).
const enrollmentService = require("../services/patientEnrollment.service");
const { CALL_OUTCOMES } = require("../config/callOutcomes");

const PROGRAM_STATUSES = ["active", "pending", "discharged"];
const CONSENT_METHODS = ["verbal", "written"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());
const todayISO = () => new Date().toISOString().slice(0, 10);

function validate(body) {
  const errors = [];
  const b = body || {};

  if (typeof b.name !== "string" || !b.name.trim()) errors.push("name is required");
  if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim()))
    errors.push("a valid email is required");

  if (b.username != null && (typeof b.username !== "string" || !b.username.trim()))
    errors.push("username must be a non-empty string");

  if (b.program_status != null && !PROGRAM_STATUSES.includes(b.program_status))
    errors.push("program_status must be one of: " + PROGRAM_STATUSES.join(", "));

  if (b.date_of_birth != null) {
    if (!isValidDate(b.date_of_birth)) errors.push("date_of_birth is not a valid date");
    else if (new Date(b.date_of_birth) > new Date())
      errors.push("date_of_birth cannot be in the future");
  }
  if (b.enrolled_at != null && !isValidDate(b.enrolled_at))
    errors.push("enrolled_at is not a valid date");
  if (b.mrn != null && String(b.mrn).trim().length > 64)
    errors.push("mrn must be 64 characters or fewer");

  if (b.insurance_payer_id != null && !Number.isInteger(Number(b.insurance_payer_id)))
    errors.push("insurance_payer_id must be an integer");

  if (b.conditions != null) {
    if (
      !Array.isArray(b.conditions) ||
      b.conditions.some((c) => typeof c !== "string" || !c.trim())
    )
      errors.push("conditions must be an array of non-empty strings");
  }

  if (b.care_team != null) {
    if (
      !Array.isArray(b.care_team) ||
      b.care_team.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)
    )
      errors.push("care_team must be an array of user ids");
  }

  if (b.consent != null) {
    if (typeof b.consent !== "object") errors.push("consent must be an object");
    else {
      if (!CONSENT_METHODS.includes(b.consent.method))
        errors.push("consent.method must be one of: " + CONSENT_METHODS.join(", "));
      if (!b.consent.consent_date || !isValidDate(b.consent.consent_date))
        errors.push("consent.consent_date is required and must be a valid date");
    }
  }

  if (b.device != null) {
    if (typeof b.device !== "object") errors.push("device must be an object");
    else {
      if (typeof b.device.device_type !== "string" || !b.device.device_type.trim())
        errors.push("device.device_type is required");
      if (typeof b.device.serial_number !== "string" || !b.device.serial_number.trim())
        errors.push("device.serial_number is required");
      if (b.device.assigned_at != null && !isValidDate(b.device.assigned_at))
        errors.push("device.assigned_at is not a valid date");
      if (b.device.setup_date != null && !isValidDate(b.device.setup_date))
        errors.push("device.setup_date is not a valid date");
      if (b.device.setup === true && b.consent == null)
        errors.push("device.setup requires the consent block (99453 needs consent)");
    }
  }

  return errors;
}

async function enrollPatient(req, res) {
  try {
    const errors = validate(req.body);
    if (errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });
    }

    const b = req.body;
    const enrolledAt = b.enrolled_at || todayISO();
    const programStatus = b.program_status || "active";

    const result = await enrollmentService.enrollPatient({
      actorId: req.user.id, // server-side
      organizationId: req.orgScope, // server-side
      name: b.name.trim(),
      email: b.email.trim(),
      username: b.username ? b.username.trim() : null,
      phoneNumber: b.phoneNumber ? String(b.phoneNumber).trim() : null,
      dateOfBirth: b.date_of_birth || null,
      enrolledAt,
      programStatus,
      insurancePayerId: b.insurance_payer_id != null ? Number(b.insurance_payer_id) : null,
      comments: b.comments != null ? String(b.comments) : null,
      mrn: b.mrn != null ? String(b.mrn) : null,
      conditions: Array.isArray(b.conditions) ? b.conditions.map((c) => c.trim()) : [],
      careTeam: Array.isArray(b.care_team) ? b.care_team.map(Number) : [],
      consent: b.consent
        ? {
            method: b.consent.method,
            consent_date: b.consent.consent_date,
            supervising_provider_id:
              b.consent.supervising_provider_id != null
                ? Number(b.consent.supervising_provider_id)
                : null,
          }
        : null,
      device: b.device
        ? {
            device_type: b.device.device_type.trim(),
            serial_number: b.device.serial_number.trim(),
            assigned_at: b.device.assigned_at || todayISO(),
            // 99453 setup date = the setup/education event. Defaults to the
            // enrollment date (same appointment in the common case), editable;
            // a device added later carries its own date. Falls back to
            // assigned_at then today if enrollment date is somehow absent.
            setup_date:
              b.device.setup_date || enrolledAt || b.device.assigned_at || todayISO(),
            setup: b.device.setup === true,
          }
        : null,
    });

    return res.status(201).json({
      ok: true,
      patient: {
        id: result.patientId,
        name: b.name.trim(),
        username: result.username,
        email: b.email.trim(),
        phoneNumber: b.phoneNumber || null,
        organization_id: req.orgScope,
        program_status: programStatus,
        enrolled_at: enrolledAt,
      },
      created: {
        conditions: result.conditionsCount,
        care_team: result.careTeamCount,
        consent: result.consentCreated,
        device: result.deviceCreated,
        device_setup_99453: result.setupCreated,
      },
    });
  } catch (err) {
    if (err && err.httpStatus) {
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    }
    console.error("enrollPatient error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/enrollment-options — form lookups: payers + device types
// (global, active), the org-scoped clinician roster, and the constrained
// call-outcome set. (The name now under-describes it — it serves general form
// lookups, not only enrollment; kept rather than renamed. See CARE_ACTIVITY_NOTES.)
// call_outcomes comes straight from config/callOutcomes.js so the six values live
// in ONE file across both repos — the CHECK constraint is case-sensitive, so a
// drifted hardcoded copy in the frontend would produce 400s.
async function getEnrollmentOptions(req, res) {
  try {
    const { payers, device_types, clinicians } =
      await enrollmentService.getEnrollmentOptions(req.orgScope);
    return res.status(200).json({
      ok: true,
      payers,
      device_types,
      clinicians,
      call_outcomes: CALL_OUTCOMES,
    });
  } catch (err) {
    console.error("getEnrollmentOptions error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { enrollPatient, getEnrollmentOptions };
