const express = require("express");
const db = require("../config/db"); // your MySQL pool
const { authRequired } = require("../middleware/auth");
const {
  getPatientBPReadingsController,
  getPatientLatestBPController,
} = require("../controllers/patient.controller");
const router = express.Router();
router.get("/test/patients/blood-pressure", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required in query parameters",
      });
    }

    const [readings] = await db.query(
      `SELECT 
        id,
        data,
        created_at as timestamp,
        DATE(created_at) as date,
        TIME(created_at) as time
       FROM dev_data 
       WHERE user_id = ? AND dev_type = 'bp'
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    const formattedReadings = readings.map((reading) => {
      let data;
      try {
        data =
          typeof reading.data === "string"
            ? JSON.parse(reading.data)
            : reading.data;
      } catch (e) {
        console.error("Error parsing data:", e, "Raw:", reading.data);
        data = {};
      }

      return {
        id: reading.id,
        systolic: data.systolic || 0,
        diastolic: data.diastolic || 0,
        bpm: data.pulse || data.heartRate || 0,
        mean: data.meanPressure || data.map || null,
        timestamp: reading.timestamp,
        date: reading.date,
        time: reading.time,
      };
    });

    res.status(200).json({
      success: true,
      data: formattedReadings,
      message: "Blood pressure readings fetched successfully",
    });
  } catch (err) {
    console.error("❌ Error fetching BP readings:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
});

router.get("/test/patients/blood-pressure/latest", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required in query parameters",
      });
    }

    // Get latest BP reading
    const [readings] = await db.query(
      `SELECT 
        id,
        data,
        created_at as timestamp
       FROM dev_data 
       WHERE user_id = ? AND dev_type = 'bp'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (readings.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No BP readings found",
      });
    }

    const reading = readings[0];

    // ✅ Fix: handle both JSON strings and objects safely
    let data;
    try {
      data =
        typeof reading.data === "string"
          ? JSON.parse(reading.data)
          : reading.data;
    } catch (e) {
      console.error("Error parsing data:", e, "Raw data:", reading.data);
      data = {};
    }

    // ✅ Auto-calculate mean (MAP) if missing
    const mean =
      data.meanPressure ||
      data.map ||
      (data.systolic && data.diastolic
        ? (data.systolic + 2 * data.diastolic) / 3
        : null);

    const latestReading = {
      id: reading.id,
      systolic: data.systolic || 0,
      diastolic: data.diastolic || 0,
      bpm: data.pulse || data.heartRate || 0,
      mean,
      timestamp: reading.timestamp,
    };

    res.status(200).json({
      success: true,
      data: latestReading,
      message: "Latest blood pressure reading fetched successfully",
    });
  } catch (err) {
    console.error("❌ Error fetching latest BP reading:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
});
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
