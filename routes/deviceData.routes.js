const express = require("express");

const router = express.Router();
const {
  createDeviceDataController,
  createBPDataController,
  storeDeviceDataController,
  storeGenericDeviceDataController,
  getDeviceDataController,
  getGenericDeviceDataController,
  createDeviceController,
  getPatientBPReadingsController,
  getLatestDeviceDataController,
  getPatientLatestBPController,
  getDevicesUsedController,
} = require("../controllers/devicedata.controller");
const { authRequired } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");

// POST /api/devices/:devId/data - Store device data for a specific device ID
router.post("/devices/data", authRequired, createDeviceDataController);
router.post("/devices", createDeviceController);

// POST /api/bp/data - Store blood pressure data
router.post("/bp/data", authRequired, createBPDataController);

// POST /api/devices/data - Store device data (specific device)
router.post("/devices/:devId/store", storeDeviceDataController);

// POST /api/devices/generic - Store generic device data (uses devType and optional devName)
router.post("/devices/generic", authRequired, storeGenericDeviceDataController);

// GET /api/devices/data - Retrieve generic device data (uses query params: devType, devName, limit, offset)
router.get("/devices/data", authRequired, getGenericDeviceDataController);
router.get(
  "/devices/getUserReadingData",
  authRequired,
  getDeviceDataController
);
router.get(
  "/devices-used/:userId",
  authRequired,
  resolveOrgScope,
  scopePatientParam("userId"),
  getDevicesUsedController
);

router.get("/devices/data/latest", authRequired, getLatestDeviceDataController); // Add this

// Removed unauthenticated /test/devices/data route — it let anyone INSERT arbitrary vitals for
// any userId (fed clinical alerting). The apps ingest via authRequired /devices/data above.
// (SECURITY_FOLLOWUPS #15)

module.exports = router;
