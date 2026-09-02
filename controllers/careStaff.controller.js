// controllers/careStaff.controller.js
//
// GET /api/care/staff — id + name of the staff who have logged activity in the
// caller's organization (req.orgScope), for name attribution in the activity UI.
const careStaffService = require("../services/careStaff.service");
const { CALL_OUTCOMES } = require("../config/callOutcomes");

// GET /api/care/call-outcomes — the constrained outcome list for logging a call. Config,
// no PHI, no org scope. Lives in the call-logging domain (not enrollment) so all clinical
// staff who can log a call — care_manager included — can reach it. (Previously LogCallForm
// pulled these from /patients/enrollment-options, which care_manager can't reach, leaving
// the outcome dropdown empty.)
async function getCallOutcomes(req, res) {
  return res.status(200).json({ ok: true, call_outcomes: CALL_OUTCOMES });
}

async function listStaff(req, res) {
  try {
    const staff = await careStaffService.listActivityAuthors(req.orgScope);
    return res.status(200).json({ ok: true, staff });
  } catch (err) {
    console.error("listStaff error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { listStaff, getCallOutcomes };
