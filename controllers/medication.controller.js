// controllers/medication.controller.js
//
// Patient side of the medications feature (step 3): a patient manages their OWN
// reported medications. Ownership + the unconfirmed invariant are enforced in the
// service; this layer is thin.

const medService = require("../services/medication.service");

async function createMyMedication(req, res) {
  try {
    const med = await medService.createMedication(req.user, req.body || {});
    return res.status(201).json({ ok: true, medication: med });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function listMyMedications(req, res) {
  try {
    const medications = await medService.listMyMedications(req.user);
    return res.status(200).json({ ok: true, medications });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function updateMyMedication(req, res) {
  try {
    const med = await medService.updateMyMedication(req.user, req.params.id, req.body || {});
    return res.status(200).json({ ok: true, medication: med });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function deleteMyMedication(req, res) {
  try {
    const result = await medService.deleteMyMedication(req.user, req.params.id);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// --- Clinician side (step 4) ---

// Staff read of a patient's medication list. Org-wide roles + assigned clinician
// (visibility via canAccessPatient). Not gated to clinician-only — care_manager/admin
// can SEE the list.
async function getPatientMedications(req, res) {
  try {
    const medications = await medService.listPatientMedications(
      req.user,
      req.orgScope,
      req.params.patientId
    );
    return res.status(200).json({ ok: true, medications });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function confirmMedication(req, res) {
  try {
    const medication = await medService.confirmMedication(req.user, req.orgScope, req.params.id, req);
    return res.status(200).json({ ok: true, medication });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function rejectMedication(req, res) {
  try {
    const medication = await medService.rejectMedication(
      req.user,
      req.orgScope,
      req.params.id,
      (req.body || {}).reason,
      req
    );
    return res.status(200).json({ ok: true, medication });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = {
  createMyMedication,
  listMyMedications,
  updateMyMedication,
  deleteMyMedication,
  getPatientMedications,
  confirmMedication,
  rejectMedication,
};
