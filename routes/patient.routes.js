const express = require("express");
const { authRequired } = require("../middleware/auth");
const {
  getPatientBPReadingsController,
  getPatientLatestBPController,
} = require("../controllers/patient.controller");
const router = express.Router();
// Removed unauthenticated /test/patients/blood-pressure[/latest] IDOR routes — they returned
// any patient's BP readings by ?userId. Use the authRequired routes below. (SECURITY_FOLLOWUPS #15)
router.get(
  "/patients/blood-pressure",
  authRequired,
  getPatientBPReadingsController
);
router.get(
  "/patients/blood-pressure/latest",
  authRequired,
  getPatientLatestBPController
);
module.exports = router;
