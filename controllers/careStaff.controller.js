// controllers/careStaff.controller.js
//
// GET /api/care/staff — id + name of the staff who have logged activity in the
// caller's organization (req.orgScope), for name attribution in the activity UI.
const careStaffService = require("../services/careStaff.service");

async function listStaff(req, res) {
  try {
    const staff = await careStaffService.listActivityAuthors(req.orgScope);
    return res.status(200).json({ ok: true, staff });
  } catch (err) {
    console.error("listStaff error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { listStaff };
