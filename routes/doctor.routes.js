const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const {
  getPatientVitalSignsController,
  getPatientDeviceDataController,
  getAssignedPatientsController,
  searchAssignedPatientsController,
  getUserWithLatestDeviceDataController,
} = require("../controllers/drController.js");
router.get(
  "/patients/:patientId/vital-signs",
  authRequired,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientVitalSignsController
);
router.get(
  "/patients/:patientId/device-data",
  authRequired,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientDeviceDataController
);
router.get(
  "/assigned",
  authRequired,
  resolveOrgScope,
  getAssignedPatientsController
);
router.get(
  "/search-patients",
  authRequired,
  resolveOrgScope,
  searchAssignedPatientsController
);
router.get(
  "/getSpecificPatientData/:userId",
  authRequired,
  resolveOrgScope,
  scopePatientParam("userId"),
  getUserWithLatestDeviceDataController
);

module.exports = router;
