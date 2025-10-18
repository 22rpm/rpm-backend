const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const {
  getPatientVitalSignsController,
} = require("../controllers/drController.js");
router.get(
  "/patients/:patientId/vital-signs",
  authRequired,
  getPatientVitalSignsController
);

module.exports = router;
