// controllers/patientWorklist.controller.js
//
// GET /api/patients/worklist?month=YYYY-MM&mine=true — the staff worklist for
// req.orgScope. `month` defaults to the current month; `mine=true` filters to
// the caller's own panel (a filter, not an authorization boundary).
const worklistService = require("../services/patientWorklist.service");
const billingSummaryService = require("../services/billingSummary.service");

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getWorklist(req, res) {
  try {
    const mine = req.query.mine === "true" || req.query.mine === "1";
    const result = await worklistService.getWorklist({
      orgScope: req.orgScope,
      user: req.user, // role_type + id — the hard access floor is role-based
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

// GET /api/patients/billing-summary?month=YYYY-MM — roster-wide RPM billing overview.
// Each row's numbers come from the note's own determination (getRpmNote), so the overview
// can never disagree with a patient's note.
async function getBillingSummary(req, res) {
  try {
    const result = await billingSummaryService.getBillingSummary({
      orgScope: req.orgScope,
      userId: req.user.id,
      role: req.user.role_type,
      month: /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : currentYm(),
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("getBillingSummary error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { getWorklist, getDialysisClinics, getBillingSummary };
