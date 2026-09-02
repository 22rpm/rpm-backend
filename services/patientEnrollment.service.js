// services/patientEnrollment.service.js
//
// Transactional patient enrollment (§3.1). One enrollment writes users, role,
// patient_profiles, and — when provided — patient_conditions, care team,
// patient_consents, patient_devices, and the 99453 rpm_device_setups. All or
// nothing: a half-enrolled patient is worse than a failed enrollment.
//
// The patient's password is a random, un-guessable secret (the column is NOT
// NULL) that nobody uses — patients authenticate by phone + SMS OTP (Option 1).
const db = require("../config/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { ICD10_CONDITIONS } = require("../config/icd10Conditions");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// Resolve an allergy input block into { substances, nkda, recorded }.
// - substances present -> those substances, nkda=false, recorded=true
// - nkda === true (and no substances) -> [], nkda=true, recorded=true (attested)
// - neither -> [], nkda=false, recorded=false ("not recorded", the safe default)
function normalizeAllergyInput(allergies) {
  const a = allergies || {};
  const substances = Array.isArray(a.substances)
    ? [...new Set(a.substances.map((s) => String(s).trim()).filter(Boolean))].slice(0, 50)
    : [];
  if (substances.length) return { substances, nkda: false, recorded: true };
  if (a.nkda === true) return { substances: [], nkda: true, recorded: true };
  return { substances: [], nkda: false, recorded: false };
}

async function generateUniqueUsername(conn) {
  for (let i = 0; i < 5; i++) {
    const candidate = "patient_" + crypto.randomBytes(4).toString("hex");
    const [rows] = await conn.query(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [candidate]
    );
    if (rows.length === 0) return candidate;
  }
  throw httpError(500, "Could not generate a unique username");
}

async function enrollPatient({
  actorId,
  organizationId,
  name,
  email,
  username,
  phoneNumber,
  dateOfBirth,
  enrolledAt,
  programStatus,
  insurancePayerId,
  secondaryInsurancePayerId,
  comments,
  mrn,
  isDialysis,
  dialysisClinic,
  conditions,
  allergies,
  smsConsent,
  careTeam,
  consent,
  device,
}) {
  // Allergy input -> a resolved shape. NKDA and a substance list are mutually
  // exclusive; a list wins (nkda forced false). `recorded` is true only when the
  // clinician actually asserted something (a list OR an explicit NKDA) — the
  // green "no known allergies" state must be a claim someone made, never a
  // default, so we only stamp reviewed_at/by when recorded.
  const alg = normalizeAllergyInput(allergies);
  // Hash a random password OUTSIDE the transaction (in-memory compute, can't
  // half-commit). Never returned to anyone.
  const randomPassword = crypto.randomBytes(24).toString("base64");
  const hashedPassword = await bcrypt.hash(randomPassword, 12);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // --- resolve/validate before writes (relational checks inside the txn) ---
    let finalUsername = username;
    if (!finalUsername) {
      finalUsername = await generateUniqueUsername(conn);
    } else {
      const [u] = await conn.query(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [finalUsername]
      );
      if (u.length) throw httpError(409, "Username already exists");
    }

    const [e] = await conn.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (e.length) throw httpError(409, "Email already exists");

    if (insurancePayerId != null) {
      const [p] = await conn.query(
        "SELECT id FROM insurance_payers WHERE id = ? AND is_active = 1",
        [insurancePayerId]
      );
      if (!p.length) throw httpError(400, "Unknown or inactive insurance_payer_id");
    }
    if (secondaryInsurancePayerId != null) {
      if (secondaryInsurancePayerId === insurancePayerId)
        throw httpError(400, "secondary insurance cannot be the same as primary");
      const [p2] = await conn.query(
        "SELECT id FROM insurance_payers WHERE id = ? AND is_active = 1",
        [secondaryInsurancePayerId]
      );
      if (!p2.length)
        throw httpError(400, "Unknown or inactive secondary_insurance_payer_id");
    }

    if (device) {
      const [dt] = await conn.query(
        "SELECT `key` FROM device_types WHERE `key` = ? AND is_active = 1",
        [device.device_type]
      );
      if (!dt.length) {
        throw httpError(
          400,
          `device_type '${device.device_type}' is not available for enrollment`
        );
      }
    }

    if (device && device.setup && !consent) {
      throw httpError(
        400,
        "Device setup (99453) requires consent; provide the consent block"
      );
    }

    if (careTeam && careTeam.length) {
      const [docs] = await conn.query(
        `SELECT u.id
           FROM users u JOIN role r ON r.user_id = u.id
          WHERE u.id IN (?) AND u.organization_id = ?
            AND r.role_type = 'clinician' AND u.is_active = 1`,
        [careTeam, organizationId]
      );
      const valid = new Set(docs.map((d) => Number(d.id)));
      const invalid = careTeam.filter((id) => !valid.has(Number(id)));
      if (invalid.length) {
        throw httpError(
          400,
          `Not clinicians in this organization: ${invalid.join(", ")}`
        );
      }
    }

    // --- writes ---
    const [ures] = await conn.query(
      `INSERT INTO users
         (username, name, email, password, phoneNumber, is_active, organization_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
      [finalUsername, name, email, hashedPassword, phoneNumber, organizationId]
    );
    const patientId = ures.insertId;

    await conn.query(
      `INSERT INTO role (username, user_id, role_type, created_at, updated_at)
       VALUES (?, ?, 'patient', NOW(), NOW())`,
      [finalUsername, patientId]
    );

    await conn.query(
      `INSERT INTO patient_profiles
         (user_id, date_of_birth, enrolled_at, program_status, insurance_payer_id,
          secondary_insurance_payer_id, comments, mrn, is_dialysis, dialysis_clinic,
          nkda, allergies_reviewed_at, allergies_reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${alg.recorded ? "NOW()" : "NULL"}, ?)`,
      [
        patientId,
        dateOfBirth,
        enrolledAt,
        programStatus,
        insurancePayerId,
        secondaryInsurancePayerId ?? null,
        comments,
        (mrn && String(mrn).trim()) || null,
        isDialysis ? 1 : 0,
        dialysisClinic || null,
        alg.nkda ? 1 : 0,
        alg.recorded ? actorId : null,
      ]
    );

    // Conditions carry an optional curated ICD-10 code (null = free text).
    let conditionsCount = 0;
    if (conditions && conditions.length) {
      await conn.query(
        "INSERT INTO patient_conditions (patient_id, name, icd10_code) VALUES ?",
        [conditions.map((c) => [patientId, c.name, c.icd10_code || null])]
      );
      conditionsCount = conditions.length;
    }

    // Drug allergies: substance rows (only when a list was given). NKDA + the
    // reviewed stamp were written on the profile above.
    let allergiesCount = 0;
    if (alg.substances.length) {
      await conn.query(
        "INSERT INTO patient_allergies (patient_id, substance, recorded_by) VALUES ?",
        [alg.substances.map((s) => [patientId, s, actorId])]
      );
      allergiesCount = alg.substances.length;
    }

    // Automated-SMS consent (separate from RPM consent). Only write a row when
    // consent is given; no row = no consent = the send gate's safe default.
    if (smsConsent) {
      await conn.query(
        `INSERT INTO patient_comm_prefs (patient_id, sms_consent, sms_consent_at, sms_consent_by)
         VALUES (?, 1, NOW(), ?)`,
        [patientId, actorId]
      );
    }

    let careTeamCount = 0;
    if (careTeam && careTeam.length) {
      await conn.query(
        "INSERT INTO patient_doctor_assignments (patient_id, doctor_id, assigned_by) VALUES ?",
        [careTeam.map((docId) => [patientId, docId, actorId])]
      );
      careTeamCount = careTeam.length;
    }

    let consentId = null;
    if (consent) {
      const [cres] = await conn.query(
        `INSERT INTO patient_consents
           (patient_id, organization_id, status, consent_date, method, obtained_by, supervising_provider_id)
         VALUES (?, ?, 'obtained', ?, ?, ?, ?)`,
        [
          patientId,
          organizationId,
          consent.consent_date,
          consent.method,
          actorId,
          consent.supervising_provider_id,
        ]
      );
      consentId = cres.insertId;
    }

    let deviceCreated = false;
    if (device) {
      await conn.query(
        `INSERT INTO patient_devices
           (patient_id, organization_id, device_type, serial_number, assigned_at, assigned_by, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [
          patientId,
          organizationId,
          device.device_type,
          device.serial_number,
          device.assigned_at,
          actorId,
        ]
      );
      deviceCreated = true;
    }

    let setupCreated = false;
    if (device && device.setup && consentId) {
      await conn.query(
        `INSERT INTO rpm_device_setups
           (patient_id, organization_id, device_type, setup_date, performed_by, consent_id, billed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
          patientId,
          organizationId,
          device.device_type,
          // setup_date drives the 99453 date of service; defaulted to the
          // enrollment date by the controller, editable per device.
          device.setup_date || enrolledAt,
          actorId,
          consentId,
        ]
      );
      setupCreated = true;
    }

    await conn.commit();
    return {
      patientId,
      username: finalUsername,
      conditionsCount,
      allergiesCount,
      nkda: alg.nkda,
      careTeamCount,
      consentCreated: !!consent,
      deviceCreated,
      setupCreated,
    };
  } catch (err) {
    await conn.rollback();
    if (err && err.code === "ER_DUP_ENTRY") {
      throw httpError(409, "Email or username already exists");
    }
    throw err;
  } finally {
    conn.release();
  }
}

// Read-only lookups the enrollment form needs, in one round trip.
//
// payers and device_types are GLOBAL lookups (not org-scoped) — active rows only.
// clinicians IS the org-scoped roster for the care-team picker: active clinicians
// in `orgScope`. This is deliberately NOT organization.getDoctorsByOrganization,
// which trusts a client-passed org id and skips resolveOrgScope (cross-org read —
// see SECURITY_FOLLOWUPS). Here the org comes from req.orgScope, never the client.
async function getEnrollmentOptions(orgScope) {
  const [payers] = await db.query(
    "SELECT id, name FROM insurance_payers WHERE is_active = 1 ORDER BY sort_order, name"
  );
  const [deviceTypes] = await db.query(
    "SELECT `key`, label FROM device_types WHERE is_active = 1 ORDER BY sort_order, label"
  );
  const [clinicians] = await db.query(
    `SELECT u.id, u.name
       FROM users u
       JOIN role r ON r.user_id = u.id
      WHERE u.organization_id = ?
        AND r.role_type = 'clinician'
        AND u.is_active = 1
      ORDER BY u.name`,
    [orgScope]
  );
  // icd10_conditions is the curated static shortlist (config, not a table) — the
  // pickable diagnoses for the conditions field, grouped by category client-side.
  return {
    payers,
    device_types: deviceTypes,
    clinicians,
    icd10_conditions: ICD10_CONDITIONS,
  };
}

module.exports = { enrollPatient, getEnrollmentOptions };
