// controllers/rpmNote.controller.js
//
// GET /api/patients/:patientId/rpm-note?month=YYYY-MM — read-only pre-fill for
// the RPM monthly note. Org-scoped; computes only what we have and reports the
// CPT codes the data supports. Clinical judgment is never filled.
const noteService = require("../services/rpmNote.service");

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

module.exports = { getRpmNote };
