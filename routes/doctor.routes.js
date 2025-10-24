const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const {
  getPatientVitalSignsController,
  getPatientDeviceDataController,
  getAssignedPatientsController,
  searchAssignedPatientsController,
  getUserWithLatestBPDataController,
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
router.get("/assigned", authRequired, getAssignedPatientsController);
router.get("/search-patients", authRequired, searchAssignedPatientsController);
router.get("/getSpecificPatientData/:userId", authRequired, getUserWithLatestBPDataController);

module.exports = router;
