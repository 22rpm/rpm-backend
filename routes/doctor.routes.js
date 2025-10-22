const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const {
  getPatientVitalSignsController,
  getPatientDeviceDataController,
} = require("../controllers/drController.js");
router.get(
  "/patients/:patientId/vital-signs",
  authRequired,
  getPatientVitalSignsController
);
router.get(
  "/patients/:patientId/device-data",
  authRequired,
  getPatientDeviceDataController
);
module.exports = router;
