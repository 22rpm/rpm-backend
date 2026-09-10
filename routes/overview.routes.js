// routes/overview.routes.js
//
// Clinician overview page data (CLINICIAN_OVERVIEW_DESIGN.md, Part 1). Read-only.
// GET /api/overview?period=week|month
//   - clinician: their assigned panel (patient_doctor_assignments)
//   - org-wide roles (super-admin / admin / care_manager): all active org patients
// The email scheduler is a SEPARATE, later deliverable — this endpoint stands alone so
// real numbers can be reviewed before any email points a clinician at them.

const express = require("express");
const { authRequired } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const { isOrgWide } = require("../services/patientAccess");
const { getClinicianOverviewService } = require("../services/clinicianOverview.service");

const router = express.Router();

router.get("/", authRequired, resolveOrgScope, async (req, res) => {
  try {
    const period = req.query.period === "week" ? "week" : "month";
    const result = await getClinicianOverviewService({
      userId: req.user.id,
      orgWide: isOrgWide(req.user),
      orgScope: req.orgScope,
      periodType: period,
    });
    res.json(result);
  } catch (error) {
    console.error("Error building clinician overview:", error);
    res.status(500).json({ ok: false, message: "Server error", error: error.message });
  }
});

module.exports = router;
