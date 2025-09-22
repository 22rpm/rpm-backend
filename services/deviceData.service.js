const db = require("../config/db"); // your MySQL pool

const createDeviceDataService = async (username, devId, bpData) => {
  // ensure device belongs to user
  const [devices] = await db.query(
    "SELECT id FROM devices WHERE id = ? AND username = ?",
    [devId, username]
  );

  if (devices.length === 0) {
    throw new Error("Device not found or does not belong to this user");
  }

  // insert reading into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [devId, JSON.stringify(bpData)]
  );

  return {
    insertId: result.insertId,
    devId,
    bpData,
  };
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
const getGenericDeviceDataService = async (user, devType, devName, limit, offset) => {
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
  const parsedData = dataRows.map(row => ({
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
module.exports = { createDeviceDataService, createBPDataService ,saveGenericDeviceDataService,saveDeviceDataService,getGenericDeviceDataService};
