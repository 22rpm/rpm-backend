// controllers/rpmNote.controller.js
//
// GET /api/patients/:patientId/rpm-note?month=YYYY-MM — read-only pre-fill for
// the RPM monthly note. Org-scoped; computes only what we have and reports the
// CPT codes the data supports. Clinical judgment is never filled.
const noteService = require("../services/rpmNote.service");
const signService = require("../services/rpmNoteSign.service");

async function getRpmNote(req, res) {
  try {
    const note = await noteService.getRpmNote({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: req.query.month,
    });
    return res.status(200).json({ ok: true, note });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/rpm-note/sign
async function signRpmNote(req, res) {
  try {
    const b = req.body || {};
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
    const signed = await signService.signRpmNote({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: b.month,
      clinical: b.clinical,
      signatureName: b.signature_name,
      actor: { id: req.user.id, role: req.user.role_type },
      session: { ip, userAgent: req.headers["user-agent"] || null },
      isCorrection: b.is_correction === true,
      correctionReason: b.correction_reason,
    });
    return res.status(201).json({ ok: true, signed });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("signRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/rpm-note/signed?month=YYYY-MM
async function getSignedRpmNote(req, res) {
  try {
    const signed = await signService.getSignedHead({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: req.query.month,
    });
    return res.status(200).json({ ok: true, signed });
  } catch (err) {
    console.error("getSignedRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { getRpmNote, signRpmNote, getSignedRpmNote };
