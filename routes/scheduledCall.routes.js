// routes/scheduledCall.routes.js
//
// Call scheduling (#3). Scheduling (create/reschedule/cancel/no-show) is an org-admin
// action. Reading (calendar + overdue) and completion (linking a logged call) are open
// to clinical staff. All org-scoped via resolveOrgScope.

const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const {
  list,
  overdue,
  create,
  update,
  cancel,
  noShow,
  complete,
} = require("../controllers/scheduledCall.controller");

// Calling patients is clinical staff's job — clinicians, care_managers, and org admins
// all schedule and log. (Org boundary is still enforced by resolveOrgScope + the
// service: create checks canAccessPatient, so a clinician can only schedule for a patient
// they're assigned to; care_manager/admin are org-wide.)
const STAFF = ["clinician", "admin", "super-admin", "care_manager"];

// Read: calendar window + overdue list.
router.get("/", authRequired, resolveOrgScope, requireRole(...STAFF), list);
router.get("/overdue", authRequired, resolveOrgScope, requireRole(...STAFF), overdue);

// Schedule / reschedule / cancel / no-show — clinical staff.
router.post("/", authRequired, resolveOrgScope, requireRole(...STAFF), create);
router.patch("/:id", authRequired, resolveOrgScope, requireRole(...STAFF), update);
router.patch("/:id/cancel", authRequired, resolveOrgScope, requireRole(...STAFF), cancel);
router.patch("/:id/no-show", authRequired, resolveOrgScope, requireRole(...STAFF), noShow);

// Complete = link to the patient_calls row the call-logging flow created.
router.patch("/:id/complete", authRequired, resolveOrgScope, requireRole(...STAFF), complete);

module.exports = router;
