const express = require("express");
const db = require("../config/db"); // your MySQL pool

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
router.get("/devices-used/:userId", authRequired, getDevicesUsedController);

router.get("/devices/data/latest", authRequired, getLatestDeviceDataController); // Add this

// TEST ROUTE - No authentication required
router.post("/test/devices/data", async (req, res) => {
  try {
    const { userId, devId, devType, data } = req.body;

    // Validation
    if (!userId || !devType || !data) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, devType, data",
      });
    }

    // SERVICE LOGIC (directly in route for testing)
    // Insert into dev_data table
    const [result] = await db.query(
      "INSERT INTO dev_data (user_id, dev_id, dev_type, data) VALUES (?, ?, ?, ?)",
      [userId, devId, devType, JSON.stringify(data)]
    );

    // Success response
    res.status(201).json({
      success: true,
      message: "Test device data stored successfully",
      data: {
        insertId: result.insertId,
        userId,
        devId,
        devType,
        data,
      },
    });
  } catch (err) {
    console.error("❌ Error storing test device data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
});

// TEST ROUTES - No authentication required

module.exports = router;
