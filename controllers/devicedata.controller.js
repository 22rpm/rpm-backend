const { createDeviceDataService, createBPDataService ,saveDeviceDataService,saveGenericDeviceDataService,getGenericDeviceDataService} = require("../services/deviceData.service");

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


const storeDeviceDataController = async (req, res) => {
  try {
    const user = req.user; // Set by authMiddleware
    const { devId } = req.params; // Device ID from URL
    const { data } = req.body; // Device data (e.g., { systolic: 120, diastolic: 80 })

    // Call service for specific device
    const result = await saveDeviceDataService(user, devId, data);

    res.status(201).json({
      success: true,
      message: "Device data stored successfully",
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

const storeGenericDeviceDataController = async (req, res) => {
  try {
    const user = req.user; // Set by authMiddleware
    const { devType, devName, data } = req.body; // devType and devName (optional) for device, plus data

    // Call service for generic device handling
    const result = await saveGenericDeviceDataService(user, devType, devName, data);

    res.status(201).json({
      success: true,
      message: "Device data stored successfully",
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

const getGenericDeviceDataController = async (req, res) => {
  try {
    const user = req.user; // Set by authMiddleware
    const { devType, devName, limit = 10, offset = 0 } = req.query; // Query params for device type, optional name, and pagination

    // Call service to get device data
    const result = await getGenericDeviceDataService(user, devType, devName, parseInt(limit), parseInt(offset));

    res.status(200).json({
      success: true,
      message: "Device data retrieved successfully",
      data: result,
    });
  } catch (err) {
    console.error("❌ Error retrieving device data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};
module.exports = { createDeviceDataController , createBPDataController,storeDeviceDataController,storeGenericDeviceDataController,getGenericDeviceDataController};
