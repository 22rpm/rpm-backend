const {
  createDeviceDataService,
  createBPDataService,
  saveDeviceDataService,
  saveGenericDeviceDataService,
  getGenericDeviceDataService,
  createDeviceService,
  getPatientBPReadingsService,
  getDeviceDataService,
  getLatestDeviceDataService,
} = require("../services/deviceData.service");

const createDeviceDataController = async (req, res) => {
  try {
    console.log("📥 Incoming request to createDeviceDataController");

    const user = req.user; // set by authMiddleware
    const { devId, devType, data } = req.body;

    console.log("👤 Authenticated User:", user);
    console.log("📦 Request Body:", { devId, devType, data });

    // call service - passing user.id instead of username
    const result = await createDeviceDataService(user.id, devId, devType, data);

    console.log("✅ Device data created successfully:", result);

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

const getDeviceDataController = async (req, res) => {
  const requestId = Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();

  console.log(`📥 [${requestId}] GET DEVICE DATA REQUEST STARTED`, {
    timestamp: new Date().toISOString(),
    user: req.user
      ? { id: req.user.id, username: req.user.username }
      : "no-user",
    query: req.query,
    headers: {
      "user-agent": req.get("user-agent"),
    },
  });

  try {
    const user = req.user;
    const { deviceType, days } = req.query;

    console.log(`🔍 [${requestId}] FETCH PARAMETERS`, {
      userId: user.id,
      deviceType,
      days,
      timestamp: new Date().toISOString(),
    });

    // Validation
    if (!deviceType) {
      console.warn(`⚠️ [${requestId}] MISSING DEVICE TYPE`);
      return res.status(400).json({
        success: false,
        message: "deviceType is required",
      });
    }

    if (!days) {
      console.warn(`⚠️ [${requestId}] MISSING DAYS PARAMETER`);
      return res.status(400).json({
        success: false,
        message: "days parameter is required",
      });
    }

    const daysInt = parseInt(days);
    if (isNaN(daysInt) || daysInt < 1) {
      console.warn(`⚠️ [${requestId}] INVALID DAYS PARAMETER`, {
        providedDays: days,
        parsedDays: daysInt,
      });

      return res.status(400).json({
        success: false,
        message: "days must be a positive number",
      });
    }

    console.log(`🚀 [${requestId}] FETCHING DEVICE DATA`, {
      userId: user.id,
      deviceType,
      days: daysInt,
    });

    const result = await getDeviceDataService(user.id, deviceType, daysInt);

    const processingTime = Date.now() - startTime;

    console.log(`✅ [${requestId}] DEVICE DATA FETCHED SUCCESSFULLY`, {
      processingTime: `${processingTime}ms`,
      userId: user.id,
      deviceType,
      days: daysInt,
      recordsFound: result.length,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Device data retrieved successfully for last ${daysInt} days`,
      data: {
        records: result,
        summary: {
          totalRecords: result.length,
          period: `${daysInt} days`,
          deviceType: deviceType,
          dateRange: {
            from: new Date(
              Date.now() - daysInt * 24 * 60 * 60 * 1000
            ).toISOString(),
            to: new Date().toISOString(),
          },
        },
      },
    });
  } catch (err) {
    const errorTime = Date.now() - startTime;

    console.error(`❌ [${requestId}] ERROR FETCHING DEVICE DATA`, {
      processingTime: `${errorTime}ms`,
      error: {
        message: err.message,
        stack: err.stack,
        code: err.code,
        sqlMessage: err.sqlMessage,
      },
      timestamp: new Date().toISOString(),
      query: req.query,
    });

    if (err.code) {
      console.error(`🗄️ [${requestId}] DATABASE ERROR DETAILS`, {
        errorCode: err.code,
        errno: err.errno,
        sqlState: err.sqlState,
        sqlMessage: err.sqlMessage,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  } finally {
    const totalTime = Date.now() - startTime;
    console.log(
      `⏱️ [${requestId}] GET REQUEST COMPLETED - Total time: ${totalTime}ms`
    );
  }
};


const getLatestDeviceDataController = async (req, res) => {
  const requestId = Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();

  console.log(`📥 [${requestId}] GET LATEST DEVICE DATA REQUEST STARTED`, {
    timestamp: new Date().toISOString(),
    user: req.user
      ? { id: req.user.id, username: req.user.username }
      : "no-user",
    query: req.query,
    headers: {
      "user-agent": req.get("user-agent"),
    },
  });

  try {
    const user = req.user;
    const { deviceType } = req.query;

    console.log(`🔍 [${requestId}] LATEST DATA PARAMETERS`, {
      userId: user.id,
      deviceType,
      timestamp: new Date().toISOString(),
    });

    // Validation
    if (!deviceType) {
      console.warn(`⚠️ [${requestId}] MISSING DEVICE TYPE FOR LATEST DATA`);
      return res.status(400).json({
        success: false,
        message: "deviceType is required",
      });
    }

    console.log(`🚀 [${requestId}] FETCHING LATEST DEVICE DATA`, {
      userId: user.id,
      deviceType,
    });

    const result = await getLatestDeviceDataService(user.id, deviceType);

    const processingTime = Date.now() - startTime;

    if (result) {
      console.log(`✅ [${requestId}] LATEST DEVICE DATA FETCHED SUCCESSFULLY`, {
        processingTime: `${processingTime}ms`,
        userId: user.id,
        deviceType,
        recordId: result.id,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json({
        success: true,
        message: "Latest device data retrieved successfully",
        data: result,
      });
    } else {
      console.log(`ℹ️ [${requestId}] NO LATEST DATA FOUND`, {
        processingTime: `${processingTime}ms`,
        userId: user.id,
        deviceType,
      });

      res.status(200).json({
        success: true,
        message: "No device data found",
        data: null,
      });
    }
  } catch (err) {
    const errorTime = Date.now() - startTime;

    console.error(`❌ [${requestId}] ERROR FETCHING LATEST DEVICE DATA`, {
      processingTime: `${errorTime}ms`,
      error: {
        message: err.message,
        stack: err.stack,
        code: err.code,
        sqlMessage: err.sqlMessage,
      },
      timestamp: new Date().toISOString(),
      query: req.query,
    });

    if (err.code) {
      console.error(`🗄️ [${requestId}] DATABASE ERROR DETAILS`, {
        errorCode: err.code,
        errno: err.errno,
        sqlState: err.sqlState,
        sqlMessage: err.sqlMessage,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  } finally {
    const totalTime = Date.now() - startTime;
    console.log(
      `⏱️ [${requestId}] LATEST DATA REQUEST COMPLETED - Total time: ${totalTime}ms`
    );
  }
};
module.exports = {
  getLatestDeviceDataController,
  getDeviceDataController,
  getPatientBPReadingsController,
  createDeviceDataController,
  createDeviceController,
  createBPDataController,
  storeDeviceDataController,
  storeGenericDeviceDataController,
  getGenericDeviceDataController,
};
