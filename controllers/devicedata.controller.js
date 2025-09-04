const { createDeviceDataService, createBPDataService } = require("../services/deviceData.service");

const createDeviceDataController = async (req, res) => {
  try {
    const user = req.user; // set by authMiddleware
    const { devId } = req.params;
    const bpData = req.body; // data from React Native BP.js

    // call service
    const result = await createDeviceDataService(user.username, devId, bpData);

    res.status(201).json({
      success: true,
      message: "Blood pressure data stored successfully",
      data: result,
    });
  } catch (err) {
    console.error("❌ Error storing device data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const createBPDataController = async (req, res) => {
  try {
    const user = req.user; // from authRequired → { id, email, role }
    const bpData = req.body; // systolic, diastolic, bpm, result, date, time

    const result = await createBPDataService(user, bpData);

    res.status(201).json({
      success: true,
      message: "Blood pressure data stored successfully",
      data: result,
    });
  } catch (err) {
    console.error("❌ Error storing BP data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};
module.exports = { createDeviceDataController , createBPDataController};
