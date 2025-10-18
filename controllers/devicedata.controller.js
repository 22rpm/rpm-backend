const {
  createDeviceDataService,
  createBPDataService,
  saveDeviceDataService,
  saveGenericDeviceDataService,
  getGenericDeviceDataService,
  createDeviceService,
  getPatientBPReadingsService,
} = require("../services/deviceData.service");

const createDeviceDataController = async (req, res) => {
  try {
    const user = req.user; // set by authMiddleware
    const { devId, devType, data } = req.body; // now from request body

    // call service - passing user.id instead of username
    const result = await createDeviceDataService(user.id, devId, devType, data);

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
    const result = await saveGenericDeviceDataService(
      user,
      devType,
      devName,
      data
    );

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
    const result = await getGenericDeviceDataService(
      user,
      devType,
      devName,
      parseInt(limit),
      parseInt(offset)
    );

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

const createDeviceController = async (req, res) => {
  try {
    const user = req.user;
    const { name, dev_type } = req.body;

    const result = await createDeviceService(user.username, name, dev_type);

    res.status(201).json({
      success: true,
      message: "Device created successfully",
      data: result,
    });
  } catch (err) {
    console.error("❌ Error creating device:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};
const getPatientBPReadingsController = async (req, res) => {
  try {
    const patient = req.user; // logged-in patient
    const readings = await getPatientBPReadingsService(patient.id);

    res.status(200).json({
      success: true,
      data: readings,
      message: "Blood pressure readings fetched successfully",
    });
  } catch (err) {
    console.error("❌ Error fetching BP readings:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

module.exports = {
  getPatientBPReadingsController,
  createDeviceDataController,
  createDeviceController,
  createBPDataController,
  storeDeviceDataController,
  storeGenericDeviceDataController,
  getGenericDeviceDataController,
};
