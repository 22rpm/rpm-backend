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
    console.log("💾 Inserting device data into database...");

    const [result] = await db.query(
      "INSERT INTO dev_data (dev_id, user_id, dev_type, data) VALUES (?, ?, ?, ?)",
      [devId, userId, devType, JSON.stringify(deviceData)]
    );

    console.log("✅ Database insert successful. Result:", result);

    const response = {
      insertId: result.insertId,
      devId,
      devType,
      userId,
      deviceData,
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

module.exports = {
  getPatientBPReadingsService,
  createDeviceService,
  createDeviceDataService,
  createBPDataService,
  saveGenericDeviceDataService,
  saveDeviceDataService,
  getGenericDeviceDataService,
};
