// controllers/patientWorklist.controller.js
//
// GET /api/patients/worklist?month=YYYY-MM&mine=true — the staff worklist for
// req.orgScope. `month` defaults to the current month; `mine=true` filters to
// the caller's own panel (a filter, not an authorization boundary).
const worklistService = require("../services/patientWorklist.service");

async function getWorklist(req, res) {
  try {
    const mine = req.query.mine === "true" || req.query.mine === "1";
    const result = await worklistService.getWorklist({
      orgScope: req.orgScope,
      userId: req.user.id,
      month: req.query.month,
      mine,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("getWorklist error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function getDialysisClinics(req, res) {
  try {
    const clinics = await worklistService.listDialysisClinics(req.orgScope);
    return res.status(200).json({ ok: true, clinics });
  } catch (err) {
    console.error("getDialysisClinics error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { getWorklist, getDialysisClinics };
