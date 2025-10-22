const db = require("../config/db"); // your MySQL pool

// Service
const createDeviceDataService = async (userId, devId, devType, deviceData) => {
  console.log("🛠️ createDeviceDataService called with:", {
    userId,
    devId,
    devType,
    deviceData,
  });

  try {
    // 1. First check if device exists for this user
    console.log("🔍 Checking if device exists in devices table...");

    const [existingDevice] = await db.query(
      "SELECT id FROM devices WHERE dev_id = ? AND user_id = ?",
      [devId, userId]
    );

    // 2. If device doesn't exist, insert into devices table
    if (!existingDevice || existingDevice.length === 0) {
      console.log("📝 Device not found, inserting into devices table...");

      await db.query(
        "INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?, ?, ?)",
        [devId, userId, devType]
      );

      console.log("✅ Device added to devices table");
    } else {
      console.log(
        "ℹ️ Device already exists in devices table, skipping insertion"
      );
    }

    // 3. Always insert into dev_data table
    console.log("💾 Inserting device data into dev_data table...");

    const [result] = await db.query(
      "INSERT INTO dev_data (dev_id, user_id, dev_type, data) VALUES (?, ?, ?, ?)",
      [devId, userId, devType, JSON.stringify(deviceData)]
    );

    console.log("✅ Device data inserted successfully. Result:", result);

    const response = {
      insertId: result.insertId,
      devId,
      devType,
      userId,
      deviceData,
      deviceWasNew: !existingDevice || existingDevice.length === 0,
    };

    console.log("📤 Returning response from service:", response);

    return response;
  } catch (error) {
    console.error("❌ Error in createDeviceDataService:", error);
    throw error;
  }
};

const createBPDataService = async (user, bpData) => {
  const username = user.email || user.id; // depends on what you keep in token

  // Step 1: Find or register BP device for this user
  let deviceId;
  const [existing] = await db.query(
    "SELECT id FROM devices WHERE username = ? AND dev_type = ?",
    [username, "BP"]
  );

  if (existing.length > 0) {
    deviceId = existing[0].id;
  } else {
    const [insertRes] = await db.query(
      "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
      [username, "Blood Pressure Monitor", "BP"]
    );
    deviceId = insertRes.insertId;
  }

  // Step 2: Insert BP data into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [deviceId, JSON.stringify(bpData)]
  );

  return {
    insertId: result.insertId,
    devId: deviceId,
    bpData,
  };
};
const saveDeviceDataService = async (user, devId, data) => {
  const username = user.email || user.id; // Depends on what’s in the token

  // Validate device belongs to user
  const [devices] = await db.query(
    "SELECT id FROM devices WHERE id = ? AND username = ?",
    [devId, username]
  );

  if (devices.length === 0) {
    throw new Error("Device not found or does not belong to this user");
  }

  // Insert device data into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [devId, JSON.stringify(data)]
  );

  return {
    insertId: result.insertId,
    devId,
    data,
  };
};

const saveGenericDeviceDataService = async (user, devType, devName, data) => {
  const username = user.email || user.id; // Depends on what’s in the token

  // Validate devType
  if (!devType) {
    throw new Error("Device type (devType) is required");
  }

  // Find or create device
  let deviceId;
  const [existing] = await db.query(
    "SELECT id FROM devices WHERE username = ? AND dev_type = ?",
    [username, devType]
  );

  if (existing.length > 0) {
    deviceId = existing[0].id;
  } else {
    const deviceName = devName || `${devType} Device`; // Fallback name
    const [insertRes] = await db.query(
      "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
      [username, deviceName, devType]
    );
    deviceId = insertRes.insertId;
  }

  // Insert device data into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [deviceId, JSON.stringify(data)]
  );

  return {
    insertId: result.insertId,
    devId: deviceId,
    data,
  };
};
const getGenericDeviceDataService = async (
  user,
  devType,
  devName,
  limit,
  offset
) => {
  const username = user.email || user.id; // Depends on what’s in the token

  // Validate devType
  if (!devType) {
    throw new Error("Device type (devType) is required");
  }

  // Build WHERE clause for device query
  let whereClause = "username = ? AND dev_type = ?";
  let params = [username, devType];

  // Add devName filter if provided
  if (devName) {
    whereClause += " AND name = ?";
    params.push(devName);
  }

  // Find device
  const [devices] = await db.query(
    `SELECT id, name FROM devices WHERE ${whereClause}`,
    params
  );

  if (devices.length === 0) {
    throw new Error("No device found for the specified type and user");
  }

  const deviceId = devices[0].id;
  const deviceName = devices[0].name;

  // Get device data with pagination
  const [dataRows] = await db.query(
    `SELECT id, dev_id, data, created_at 
     FROM dev_data 
     WHERE dev_id = ? 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [deviceId, limit, offset]
  );

  // Get total count for pagination
  const [[countResult]] = await db.query(
    "SELECT COUNT(*) as total FROM dev_data WHERE dev_id = ?",
    [deviceId]
  );

  // Parse JSON data
  const parsedData = dataRows.map((row) => ({
    id: row.id,
    deviceId: row.dev_id,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
  }));

  return {
    deviceId,
    deviceType: devType,
    deviceName,
    totalRecords: countResult.total,
    limit,
    offset,
    records: parsedData,
    hasMore: offset + limit < countResult.total,
  };
};

const createDeviceService = async (username, name, dev_type) => {
  const [result] = await db.query(
    "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
    [username, name, dev_type]
  );

  return {
    id: result.insertId,
    username,
    name,
    dev_type,
  };
};

const getPatientBPReadingsService = async (patientId) => {
  // Get BP readings from dev_data table
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
     LIMIT 7`, // Limit to last 50 readings
    [patientId]
  );

  // Transform data to match frontend structure
  const formattedReadings = readings.map((reading) => {
    const data = JSON.parse(reading.data);
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

  return formattedReadings;
};

const getDeviceDataService = async (userId, deviceType, days) => {
  const serviceStartTime = Date.now();
  const serviceId = Math.random().toString(36).substring(2, 10);

  console.log(`🛠️ [SERVICE-${serviceId}] STARTING DATA FETCH`, {
    userId,
    deviceType,
    days,
    timestamp: new Date().toISOString(),
  });

  try {
    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateString = startDate.toISOString().split("T")[0];

    console.log(`🗄️ [SERVICE-${serviceId}] EXECUTING DATABASE QUERY`, {
      query:
        "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at DESC",
      params: {
        userId,
        deviceType,
        startDate: startDateString,
      },
    });

    const [rows] = await db.query(
      "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at DESC",
      [userId, deviceType, startDateString]
    );

    const serviceTime = Date.now() - serviceStartTime;

    console.log(`💾 [SERVICE-${serviceId}] DATABASE QUERY SUCCESSFUL`, {
      processingTime: `${serviceTime}ms`,
      recordsFound: rows.length,
      userId,
      deviceType,
      days,
    });

    // Parse JSON data and format response
    const formattedData = rows.map((row) => {
      let parsedData;
      try {
        parsedData =
          typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      } catch (parseError) {
        console.warn(`⚠️ [SERVICE-${serviceId}] DATA PARSE ERROR`, {
          rowId: row.id,
          error: parseError.message,
        });
        parsedData = { error: "Failed to parse data" };
      }

      return {
        id: row.id,
        devId: row.dev_id,
        devType: row.dev_type,
        userId: row.user_id,
        data: parsedData,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    console.log(`🎯 [SERVICE-${serviceId}] DATA FETCH COMPLETED`, {
      totalTime: `${serviceTime}ms`,
      recordsReturned: formattedData.length,
      dateRange: {
        from: startDateString,
        to: new Date().toISOString().split("T")[0],
      },
    });

    return formattedData;
  } catch (error) {
    const serviceErrorTime = Date.now() - serviceStartTime;

    console.error(`💥 [SERVICE-${serviceId}] DATA FETCH ERROR`, {
      processingTime: `${serviceErrorTime}ms`,
      error: {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
      },
      queryParams: {
        userId,
        deviceType,
        days,
      },
    });

    throw error;
  }
};

const getLatestDeviceDataService = async (userId, deviceType) => {
  const serviceStartTime = Date.now();
  const serviceId = Math.random().toString(36).substring(2, 10);

  console.log(`🛠️ [SERVICE-${serviceId}] FETCHING LATEST DEVICE DATA`, {
    userId,
    deviceType,
    timestamp: new Date().toISOString(),
  });

  try {
    console.log(`🗄️ [SERVICE-${serviceId}] EXECUTING LATEST DATA QUERY`, {
      query:
        "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? ORDER BY created_at DESC LIMIT 1",
      params: {
        userId,
        deviceType,
      },
    });

    const [rows] = await db.query(
      "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? ORDER BY created_at DESC LIMIT 1",
      [userId, deviceType]
    );

    const serviceTime = Date.now() - serviceStartTime;

    if (rows.length > 0) {
      const row = rows[0];

      console.log(`💾 [SERVICE-${serviceId}] LATEST DATA FOUND`, {
        processingTime: `${serviceTime}ms`,
        recordId: row.id,
        createdAt: row.created_at,
        deviceType: row.dev_type,
      });

      // Parse JSON data
      let parsedData;
      try {
        parsedData =
          typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      } catch (parseError) {
        console.warn(`⚠️ [SERVICE-${serviceId}] DATA PARSE ERROR`, {
          rowId: row.id,
          error: parseError.message,
        });
        parsedData = { error: "Failed to parse data" };
      }

      const formattedData = {
        id: row.id,
        devId: row.dev_id,
        devType: row.dev_type,
        userId: row.user_id,
        data: parsedData,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      console.log(`🎯 [SERVICE-${serviceId}] LATEST DATA RETURNED`, {
        totalTime: `${serviceTime}ms`,
        hasData: true,
      });

      return formattedData;
    } else {
      console.log(`ℹ️ [SERVICE-${serviceId}] NO DATA FOUND`, {
        processingTime: `${serviceTime}ms`,
        userId,
        deviceType,
      });

      return null;
    }
  } catch (error) {
    const serviceErrorTime = Date.now() - serviceStartTime;

    console.error(`💥 [SERVICE-${serviceId}] LATEST DATA FETCH ERROR`, {
      processingTime: `${serviceErrorTime}ms`,
      error: {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
      },
      queryParams: {
        userId,
        deviceType,
      },
    });

    throw error;
  }
};
module.exports = {
  getDeviceDataService,
  getLatestDeviceDataService,
  getPatientBPReadingsService,
  createDeviceService,
  createDeviceDataService,
  createBPDataService,
  saveGenericDeviceDataService,
  saveDeviceDataService,
  getGenericDeviceDataService,
};
