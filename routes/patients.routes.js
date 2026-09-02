// routes/patients.routes.js
//
// Staff-facing patient management (plural — distinct from the patient-app
// `/api/patient` singular). Enrollment now; the worklist will live here later.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const {
  enrollPatient,
  getEnrollmentOptions,
} = require("../controllers/patientEnrollment.controller");
const { getWorklist, getDialysisClinics, getBillingSummary } = require("../controllers/patientWorklist.controller");
const {
  getPatientForEdit,
  updatePatient,
  recordAllergies,
  getPatientConsent,
  recordConsent,
} = require("../controllers/patientEdit.controller");
const {
  getRpmNote,
  signRpmNote,
  getSignedRpmNote,
} = require("../controllers/rpmNote.controller");
const {
  getPatientComms,
  setPatientComms,
  sendNow,
  getPatientNotificationLog,
} = require("../controllers/notification.controller");

// Clinical staff who can SEE/act on patients. care_manager is org-wide clinical staff
// (a monitor who also calls patients), so it belongs here for visibility + edit — the
// per-patient boundary is still enforced by scopePatientParam/canAccessPatient (org-wide
// for care_manager, assignment-scoped for a clinician). NOTE the deliberate exceptions
// that are NOT this set: enroll (create patient), consent (attestation), and note-sign
// are gated separately below.
const staffRoles = requireRole("clinician", "admin", "super-admin", "care_manager");

// POST /api/patients — enroll a patient into the caller's organization
// (super-admin passes ?organizationId=). Not patient-linked (creating a new
// patient), so resolveOrgScope without scopePatientParam.
router.post(
  "/",
  authRequired,
  requireRole("clinician", "admin", "super-admin"),
  resolveOrgScope,
  enrollPatient
);

// GET /api/patients/enrollment-options — lookups for the enrollment form:
// active payers + active device types (global) and the org-scoped clinician
// roster. Same auth + scope as the POST (super-admin passes ?organizationId=).
// Read-only reference lookups (active payers, device types, org clinician roster) used by
// BOTH the enroll form and the patient EDIT form. No PHI. Open to all clinical staff —
// care_manager edits patients (they do the calls and learn when a phone/clinic changed),
// so they need these lookups. The enroll POST below stays gated (creating patients is not
// a care_manager task).
router.get(
  "/enrollment-options",
  authRequired,
  requireRole("clinician", "admin", "super-admin", "care_manager"),
  resolveOrgScope,
  getEnrollmentOptions
);

// GET /api/patients/dialysis-clinics — distinct clinic names in the org, for the
// patient-list filter dropdown and the entry-form datalist.
router.get(
  "/dialysis-clinics",
  authRequired,
  requireRole("clinician", "admin", "super-admin", "care_manager"),
  resolveOrgScope,
  getDialysisClinics
);

// GET /api/patients/worklist?month=YYYY-MM&mine=true — the staff worklist for
// the caller's org (§3.2). month defaults to the current month; mine filters to
// the caller's panel (a filter, not an authorization boundary — a clinician may
// still request the whole clinic). Super-admin passes ?organizationId=.
router.get(
  "/worklist",
  authRequired,
  requireRole("clinician", "admin", "super-admin", "care_manager"),
  resolveOrgScope,
  getWorklist
);

// GET /api/patients/billing-summary?month=YYYY-MM — roster-wide RPM billing overview.
// Numbers come from the note's own determination per patient (see the service).
router.get(
  "/billing-summary",
  authRequired,
  requireRole("clinician", "admin", "super-admin", "care_manager"),
  resolveOrgScope,
  getBillingSummary
);

// Patient-scoped routes come LAST so the static paths above (/enrollment-options,
// /worklist) are matched first and not swallowed by the :patientId param.
// scopePatientParam 404s a patient outside the caller's org.
//
// GET /api/patients/:patientId — editable detail to prefill the edit form.
router.get(
  "/:patientId",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientForEdit
);

// GET /api/patients/:patientId/consent — read-only latest-wins consent record for
// the vitals-header consent view. Org-scoped like GET /:patientId above.
router.get(
  "/:patientId/consent",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientConsent
);

// POST /api/patients/:patientId/consent — append a consent EVENT (latest-wins).
// Tighter than the other patient writes: CLINICIAN (or super-admin) only, not
// org admin — consent is a billing prerequisite and the attester must be
// authorized. obtained_by is recorded as the logged-in user in the service.
router.post(
  "/:patientId/consent",
  authRequired,
  requireRole("clinician", "super-admin"),
  resolveOrgScope,
  scopePatientParam("patientId"),
  recordConsent
);

// PATCH /api/patients/:patientId — upsert profile + conditions + care team.
// Creates patient_profiles when absent. enrolled_at changes are audited.
router.patch(
  "/:patientId",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  updatePatient
);

// POST /api/patients/:patientId/allergies — record drug-allergy status
// (substances + NKDA). staffRoles (clinician + care_manager + admin/super-admin):
// allergies are clinical info the care team records, not a clinician-only
// attestation like consent or note-signing. The recorder is req.user.id.
router.post(
  "/:patientId/allergies",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  recordAllergies
);

// GET/PUT /api/patients/:patientId/comm-prefs — automated-notification consent
// (separate from RPM consent) + the per-type toggles. staffRoles: a care_manager
// who does the calls can manage these; the send pipeline still gates on consent.
router.get(
  "/:patientId/comm-prefs",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientComms
);
router.put(
  "/:patientId/comm-prefs",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  setPatientComms
);

// GET /api/patients/:patientId/notifications — the patient's notification log
// (the Notifications tab). POST .../send — fire a template on demand (send-now).
router.get(
  "/:patientId/notifications",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientNotificationLog
);
router.post(
  "/:patientId/notifications/send",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  sendNow
);

// GET /api/patients/:patientId/rpm-note?month=YYYY-MM — read-only pre-fill for
// the RPM monthly note. Computes what we have; never fills clinical judgment.
router.get(
  "/:patientId/rpm-note",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getRpmNote
);

// GET /api/patients/:patientId/rpm-note/signed?month=YYYY-MM — current signed
// head for the month (or null). Read-only.
router.get(
  "/:patientId/rpm-note/signed",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getSignedRpmNote
);

// POST /api/patients/:patientId/rpm-note/sign — sign the note into the
// append-only rpm_notes ledger (server-computed snapshot; hash-anchored).
// SIGNING is clinician-only (physician/QHP) — the signature is the clinical
// attestation that makes the note billable. NOT staffRoles: admin, super-admin,
// and (future) care_manager can view and generate the note but must not sign.
// Enforced again in the service (rpmNoteSign) so the ledger can't be signed by a
// non-clinician even if this route is ever rewired.
router.post(
  "/:patientId/rpm-note/sign",
  authRequired,
  requireRole("clinician"),
  resolveOrgScope,
  scopePatientParam("patientId"),
  signRpmNote
);

module.exports = router;
