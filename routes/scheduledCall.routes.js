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

const STAFF = ["clinician", "admin", "super-admin", "care_manager"];
const ADMIN = ["admin", "super-admin"];

// Read: calendar window + overdue list.
router.get("/", authRequired, resolveOrgScope, requireRole(...STAFF), list);
router.get("/overdue", authRequired, resolveOrgScope, requireRole(...STAFF), overdue);

// Schedule / reschedule / cancel / no-show — org admin.
router.post("/", authRequired, resolveOrgScope, requireRole(...ADMIN), create);
router.patch("/:id", authRequired, resolveOrgScope, requireRole(...ADMIN), update);
router.patch("/:id/cancel", authRequired, resolveOrgScope, requireRole(...ADMIN), cancel);
router.patch("/:id/no-show", authRequired, resolveOrgScope, requireRole(...ADMIN), noShow);

// Complete = link to the patient_calls row the call-logging flow created. Clinical staff.
router.patch("/:id/complete", authRequired, resolveOrgScope, requireRole(...STAFF), complete);

module.exports = router;
