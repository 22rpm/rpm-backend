const express = require("express");
const router = express.Router();
const {
  createDeviceDataController,
  createBPDataController,
  storeDeviceDataController,
  storeGenericDeviceDataController,
    
  getGenericDeviceDataController
} = require("../controllers/devicedata.controller");
const { authRequired } = require("../middleware/auth");

// POST /api/devices/:devId/data - Store device data for a specific device ID
router.post("/devices/:devId/data", authRequired, createDeviceDataController);

// POST /api/bp/data - Store blood pressure data
router.post("/bp/data", authRequired, createBPDataController);

// POST /api/devices/data - Store device data (specific device)
router.post("/devices/:devId/store", storeDeviceDataController);

// POST /api/devices/generic - Store generic device data (uses devType and optional devName)
router.post("/devices/generic", authRequired, storeGenericDeviceDataController);

// GET /api/devices/data - Retrieve generic device data (uses query params: devType, devName, limit, offset)
router.get("/devices/data", authRequired, getGenericDeviceDataController);

module.exports = router;