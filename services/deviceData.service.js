// const db = require("../config/db"); // your MySQL pool
// const { getIO, userSockets } = require("../socket/socketServer");

// // Service

// const calculateBPStatus = (systolic, diastolic) => {
//   const sys = parseInt(systolic);
//   const dia = parseInt(diastolic);

//   if (sys < 90 || dia < 60) {
//     return "Low";
//   } else if (sys <= 120 && dia <= 80) {
//     return "High";
//   } else {
//     return "High";
//   }
// };
// const createDeviceDataService = async (userId, devId, devType, deviceData) => {
//   console.log("🛠️ createDeviceDataService called with:", {
//     userId,
//     devId,
//     devType,
//     deviceData,
//   });

//   try {
//     // 1. First check if device exists for this user
//     console.log("🔍 Checking if device exists in devices table...");

//     const [existingDevice] = await db.query(
//       "SELECT id FROM devices WHERE dev_id = ? AND user_id = ?",
//       [devId, userId]
//     );

//     // 2. If device doesn't exist, insert into devices table
//     if (!existingDevice || existingDevice.length === 0) {
//       console.log("📝 Device not found, inserting into devices table...");

//       await db.query(
//         "INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?, ?, ?)",
//         [devId, userId, devType]
//       );

//       console.log("✅ Device added to devices table");
//     } else {
//       console.log(
//         "ℹ️ Device already exists in devices table, skipping insertion"
//       );
//     }

//     // 3. Calculate BP status for BP devices (simplified)
//     let processedData = { ...deviceData };

//     if (devType === "bp" && deviceData.systolic && deviceData.diastolic) {
//       const bpStatus = calculateBPStatus(
//         deviceData.systolic,
//         deviceData.diastolic
//       );
//       processedData = {
//         ...deviceData,
//         bpStatus: bpStatus,
//       };
//       console.log(
//         `📊 Calculated BP Status: ${bpStatus} for BP ${deviceData.systolic}/${deviceData.diastolic}`
//       );
//     }

//     // 4. Always insert into dev_data table
//     console.log("💾 Inserting device data into dev_data table...");

//     const [result] = await db.query(
//       "INSERT INTO dev_data (dev_id, user_id, dev_type, data) VALUES (?, ?, ?, ?)",
//       [devId, userId, devType, JSON.stringify(processedData)]
//     );

//     console.log("✅ Device data inserted successfully. Result:", result);

//     const response = {
//       insertId: result.insertId,
//       devId,
//       devType,
//       userId,
//       deviceData: processedData,
//       deviceWasNew: !existingDevice || existingDevice.length === 0,
//     };

//     console.log("📤 Returning response from service:", response);

//     return response;
//   } catch (error) {
//     console.error("❌ Error in createDeviceDataService:", error);
//     throw error;
//   }
// };

// const createBPDataService = async (user, bpData) => {
//   const username = user.email || user.id; // depends on what you keep in token

//   // Step 1: Find or register BP device for this user
//   let deviceId;
//   const [existing] = await db.query(
//     "SELECT id FROM devices WHERE username = ? AND dev_type = ?",
//     [username, "BP"]
//   );

//   if (existing.length > 0) {
//     deviceId = existing[0].id;
//   } else {
//     const [insertRes] = await db.query(
//       "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
//       [username, "Blood Pressure Monitor", "BP"]
//     );
//     deviceId = insertRes.insertId;
//   }

//   // Step 2: Insert BP data into dev_data
//   const [result] = await db.query(
//     "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
//     [deviceId, JSON.stringify(bpData)]
//   );

//   return {
//     insertId: result.insertId,
//     devId: deviceId,
//     bpData,
//   };
// };
// const saveDeviceDataService = async (user, devId, data) => {
//   const username = user.email || user.id; // Depends on what’s in the token

//   // Validate device belongs to user
//   const [devices] = await db.query(
//     "SELECT id FROM devices WHERE id = ? AND username = ?",
//     [devId, username]
//   );

//   if (devices.length === 0) {
//     throw new Error("Device not found or does not belong to this user");
//   }

//   // Insert device data into dev_data
//   const [result] = await db.query(
//     "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
//     [devId, JSON.stringify(data)]
//   );

//   return {
//     insertId: result.insertId,
//     devId,
//     data,
//   };
// };

// const saveGenericDeviceDataService = async (user, devType, devName, data) => {
//   const username = user.email || user.id; // Depends on what’s in the token

//   // Validate devType
//   if (!devType) {
//     throw new Error("Device type (devType) is required");
//   }

//   // Find or create device
//   let deviceId;
//   const [existing] = await db.query(
//     "SELECT id FROM devices WHERE username = ? AND dev_type = ?",
//     [username, devType]
//   );

//   if (existing.length > 0) {
//     deviceId = existing[0].id;
//   } else {
//     const deviceName = devName || `${devType} Device`; // Fallback name
//     const [insertRes] = await db.query(
//       "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
//       [username, deviceName, devType]
//     );
//     deviceId = insertRes.insertId;
//   }

//   // Insert device data into dev_data
//   const [result] = await db.query(
//     "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
//     [deviceId, JSON.stringify(data)]
//   );

//   return {
//     insertId: result.insertId,
//     devId: deviceId,
//     data,
//   };
// };
// const getGenericDeviceDataService = async (
//   user,
//   devType,
//   devName,
//   limit,
//   offset
// ) => {
//   const username = user.email || user.id; // Depends on what’s in the token

//   // Validate devType
//   if (!devType) {
//     throw new Error("Device type (devType) is required");
//   }

//   // Build WHERE clause for device query
//   let whereClause = "username = ? AND dev_type = ?";
//   let params = [username, devType];

//   // Add devName filter if provided
//   if (devName) {
//     whereClause += " AND name = ?";
//     params.push(devName);
//   }

//   // Find device
//   const [devices] = await db.query(
//     `SELECT id, name FROM devices WHERE ${whereClause}`,
//     params
//   );

//   if (devices.length === 0) {
//     throw new Error("No device found for the specified type and user");
//   }

//   const deviceId = devices[0].id;
//   const deviceName = devices[0].name;

//   // Get device data with pagination
//   const [dataRows] = await db.query(
//     `SELECT id, dev_id, data, created_at
//      FROM dev_data
//      WHERE dev_id = ?
//      ORDER BY created_at DESC
//      LIMIT ? OFFSET ?`,
//     [deviceId, limit, offset]
//   );

//   // Get total count for pagination
//   const [[countResult]] = await db.query(
//     "SELECT COUNT(*) as total FROM dev_data WHERE dev_id = ?",
//     [deviceId]
//   );

//   // Parse JSON data
//   const parsedData = dataRows.map((row) => ({
//     id: row.id,
//     deviceId: row.dev_id,
//     data: JSON.parse(row.data),
//     createdAt: row.created_at,
//   }));

//   return {
//     deviceId,
//     deviceType: devType,
//     deviceName,
//     totalRecords: countResult.total,
//     limit,
//     offset,
//     records: parsedData,
//     hasMore: offset + limit < countResult.total,
//   };
// };

// const createDeviceService = async (username, name, dev_type) => {
//   const [result] = await db.query(
//     "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
//     [username, name, dev_type]
//   );

//   return {
//     id: result.insertId,
//     username,
//     name,
//     dev_type,
//   };
// };

// const getPatientBPReadingsService = async (patientId) => {
//   // Get BP readings from dev_data table
//   const [readings] = await db.query(
//     `SELECT
//       id,
//       data,
//       created_at as timestamp,
//       DATE(created_at) as date,
//       TIME(created_at) as time
//      FROM dev_data
//      WHERE user_id = ? AND dev_type = 'bp'
//      ORDER BY created_at DESC
//      LIMIT 7`, // Limit to last 50 readings
//     [patientId]
//   );

//   // Transform data to match frontend structure
//   const formattedReadings = readings.map((reading) => {
//     const data = JSON.parse(reading.data);
//     return {
//       id: reading.id,
//       systolic: data.systolic || 0,
//       diastolic: data.diastolic || 0,
//       bpm: data.pulse || data.heartRate || 0,
//       mean: data.meanPressure || data.map || null,
//       timestamp: reading.timestamp,
//       date: reading.date,
//       time: reading.time,
//     };
//   });

//   return formattedReadings;
// };

// const getDeviceDataService = async (userId, deviceType, days) => {
//   const serviceStartTime = Date.now();
//   const serviceId = Math.random().toString(36).substring(2, 10);

//   console.log(`🛠️ [SERVICE-${serviceId}] STARTING DATA FETCH`, {
//     userId,
//     deviceType,
//     days,
//     timestamp: new Date().toISOString(),
//   });

//   try {
//     // Calculate date range
//     const startDate = new Date();
//     startDate.setDate(startDate.getDate() - days);
//     const startDateString = startDate.toISOString().split("T")[0];

//     console.log(`🗄️ [SERVICE-${serviceId}] EXECUTING DATABASE QUERY`, {
//       query:
//         "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at ASC",
//       params: {
//         userId,
//         deviceType,
//         startDate: startDateString,
//       },
//     });

//     const [rows] = await db.query(
//       "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at ASC",
//       [userId, deviceType, startDateString]
//     );

//     const serviceTime = Date.now() - serviceStartTime;

//     console.log(`💾 [SERVICE-${serviceId}] DATABASE QUERY SUCCESSFUL`, {
//       processingTime: `${serviceTime}ms`,
//       recordsFound: rows.length,
//       userId,
//       deviceType,
//       days,
//     });

//     // Parse JSON data and format response
//     const formattedData = rows.map((row) => {
//       let parsedData;
//       try {
//         parsedData =
//           typeof row.data === "string" ? JSON.parse(row.data) : row.data;
//       } catch (parseError) {
//         console.warn(`⚠️ [SERVICE-${serviceId}] DATA PARSE ERROR`, {
//           rowId: row.id,
//           error: parseError.message,
//         });
//         parsedData = { error: "Failed to parse data" };
//       }

//       return {
//         id: row.id,
//         devId: row.dev_id,
//         devType: row.dev_type,
//         userId: row.user_id,
//         data: parsedData,
//         createdAt: row.created_at,
//         updatedAt: row.updated_at,
//       };
//     });

//     console.log(`🎯 [SERVICE-${serviceId}] DATA FETCH COMPLETED`, {
//       totalTime: `${serviceTime}ms`,
//       recordsReturned: formattedData.length,
//       dateRange: {
//         from: startDateString,
//         to: new Date().toISOString().split("T")[0],
//       },
//     });

//     return formattedData;
//   } catch (error) {
//     const serviceErrorTime = Date.now() - serviceStartTime;

//     console.error(`💥 [SERVICE-${serviceId}] DATA FETCH ERROR`, {
//       processingTime: `${serviceErrorTime}ms`,
//       error: {
//         message: error.message,
//         code: error.code,
//         errno: error.errno,
//         sqlState: error.sqlState,
//         sqlMessage: error.sqlMessage,
//       },
//       queryParams: {
//         userId,
//         deviceType,
//         days,
//       },
//     });

//     throw error;
//   }
// };

// const getLatestDeviceDataService = async (userId, deviceType) => {
//   const serviceStartTime = Date.now();
//   const serviceId = Math.random().toString(36).substring(2, 10);

//   console.log(`🛠️ [SERVICE-${serviceId}] FETCHING LATEST DEVICE DATA`, {
//     userId,
//     deviceType,
//     timestamp: new Date().toISOString(),
//   });

//   try {
//     console.log(`🗄️ [SERVICE-${serviceId}] EXECUTING LATEST DATA QUERY`, {
//       query:
//         "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? ORDER BY created_at DESC LIMIT 1",
//       params: {
//         userId,
//         deviceType,
//       },
//     });

//     const [rows] = await db.query(
//       "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? ORDER BY created_at DESC LIMIT 1",
//       [userId, deviceType]
//     );

//     const serviceTime = Date.now() - serviceStartTime;

//     if (rows.length > 0) {
//       const row = rows[0];

//       console.log(`💾 [SERVICE-${serviceId}] LATEST DATA FOUND`, {
//         processingTime: `${serviceTime}ms`,
//         recordId: row.id,
//         createdAt: row.created_at,
//         deviceType: row.dev_type,
//       });

//       // Parse JSON data
//       let parsedData;
//       try {
//         parsedData =
//           typeof row.data === "string" ? JSON.parse(row.data) : row.data;
//       } catch (parseError) {
//         console.warn(`⚠️ [SERVICE-${serviceId}] DATA PARSE ERROR`, {
//           rowId: row.id,
//           error: parseError.message,
//         });
//         parsedData = { error: "Failed to parse data" };
//       }

//       const formattedData = {
//         id: row.id,
//         devId: row.dev_id,
//         devType: row.dev_type,
//         userId: row.user_id,
//         data: parsedData,
//         createdAt: row.created_at,
//         updatedAt: row.updated_at,
//       };

//       console.log(`🎯 [SERVICE-${serviceId}] LATEST DATA RETURNED`, {
//         totalTime: `${serviceTime}ms`,
//         hasData: true,
//       });

//       return formattedData;
//     } else {
//       console.log(`ℹ️ [SERVICE-${serviceId}] NO DATA FOUND`, {
//         processingTime: `${serviceTime}ms`,
//         userId,
//         deviceType,
//       });

//       return null;
//     }
//   } catch (error) {
//     const serviceErrorTime = Date.now() - serviceStartTime;

//     console.error(`💥 [SERVICE-${serviceId}] LATEST DATA FETCH ERROR`, {
//       processingTime: `${serviceErrorTime}ms`,
//       error: {
//         message: error.message,
//         code: error.code,
//         errno: error.errno,
//         sqlState: error.sqlState,
//         sqlMessage: error.sqlMessage,
//       },
//       queryParams: {
//         userId,
//         deviceType,
//       },
//     });

//     throw error;
//   }
// };

// const triggerBPAlert = async (patientId, bpStatus, systolic, diastolic) => {
//   console.log("🚨 Triggering BP Alert for patient:", patientId);

//   try {
//     // 1. Get patient's assigned doctors/clinicians
//     const assignedDoctors = await db("patient_doctors")
//       .select("doctor_id")
//       .where("patient_id", patientId)
//       .andWhere("status", "active");

//     if (!assignedDoctors || assignedDoctors.length === 0) {
//       console.log("ℹ️ No assigned doctors found for patient:", patientId);
//       return;
//     }

//     const dr_ids = assignedDoctors.map((doc) => doc.doctor_id);
//     console.log("👨‍⚕️ Assigned doctors for alerts:", dr_ids);

//     // 2. Map BP status to alert type
//     const alertTypeMap = {
//       Low: "low",
//       High: "high",
//     };

//     const alertType = alertTypeMap[bpStatus];
//     if (!alertType) {
//       console.log("ℹ️ No alert needed for Normal BP status");
//       return;
//     }

//     // 3. Create alert description
//     const alertDesc = `Blood Pressure ${bpStatus}: ${systolic}/${diastolic} mmHg`;

//     // 4. Validate clinicians exist and are active
//     const validClinicians = await db("users")
//       .select("users.id", "users.name", "users.email", "role.role_type")
//       .join("role", "users.id", "role.user_id")
//       .whereIn("users.id", dr_ids)
//       .where("role.role_type", "clinician")
//       .where("users.is_active", true);

//     console.log("✅ Valid clinicians found:", validClinicians.length);

//     if (validClinicians.length === 0) {
//       console.log("❌ No valid clinicians found for alert");
//       return;
//     }

//     const validClinicianIds = validClinicians.map((d) => d.id);

//     // 5. Get patient details
//     const patientDetails = await db("users")
//       .select("id", "name", "email", "phoneNumber", "organization_id")
//       .where("id", patientId)
//       .first();

//     console.log("👤 Patient details for alert:", patientDetails);

//     // 6. Create alert and assignments in transaction
//     const result = await db.transaction(async (trx) => {
//       // Insert alert
//       const [alertId] = await trx("alerts")
//         .insert({
//           user_id: patientId,
//           desc: alertDesc,
//           type: alertType,
//         })
//         .returning("id");

//       console.log("📝 Alert inserted with ID:", alertId);

//       // Insert assignments for each clinician
//       const assignments = validClinicianIds.map((clinician_id) => ({
//         alert_id: alertId,
//         doctor_id: clinician_id,
//         read_status: false,
//         read_at: null,
//       }));

//       await trx("alert_assignments").insert(assignments);

//       // Fetch the complete alert with patient details
//       const newAlert = await trx("alerts")
//         .select(
//           "alerts.*",
//           "patients.name as patient_name",
//           "patients.email as patient_email",
//           "patients.phoneNumber as patient_phone",
//           "patients.organization_id as patient_organization_id"
//         )
//         .leftJoin("users as patients", "alerts.user_id", "patients.id")
//         .where("alerts.id", alertId)
//         .first();

//       return { alertId, newAlert, patientDetails };
//     });

//     // 7. Send WebSocket notifications
//     const io = getIO();
//     console.log(
//       "📡 Sending WebSocket notifications to clinicians:",
//       validClinicianIds
//     );

//     let notificationsSent = 0;

//     for (const clinician_id of validClinicianIds) {
//       const clinicianSocketId = userSockets.get(clinician_id.toString());

//       if (clinicianSocketId) {
//         // Get updated unread count for this clinician
//         const unreadCount = await db("alert_assignments")
//           .where("doctor_id", clinician_id)
//           .andWhere("read_status", false)
//           .count("id as count")
//           .first();

//         io.to(clinicianSocketId).emit("new_alert", {
//           alert: {
//             ...result.newAlert,
//             read_status: false,
//             assignment_id: clinician_id,
//           },
//           patient: {
//             id: patientDetails.id,
//             name: patientDetails.name,
//             email: patientDetails.email,
//             phoneNumber: patientDetails.phoneNumber,
//             organization_id: patientDetails.organization_id,
//           },
//           unread_count: parseInt(unreadCount?.count) || 0,
//           timestamp: new Date(),
//         });

//         console.log(`   ✅ Notification sent to clinician ${clinician_id}`);
//         notificationsSent++;
//       } else {
//         console.log(
//           `   ❌ Clinician ${clinician_id} not connected - no active socket`
//         );
//       }
//     }

//     console.log(
//       `✅ BP Alert created successfully. Notifications sent to ${notificationsSent}/${validClinicianIds.length} clinicians`
//     );
//   } catch (error) {
//     console.error("❌ Error in triggerBPAlert:", error);
//     throw error; // Re-throw to handle in controller
//   }
// };
// module.exports = {
//   triggerBPAlert,
//   getDeviceDataService,
//   getLatestDeviceDataService,
//   getPatientBPReadingsService,
//   createDeviceService,
//   createDeviceDataService,
//   createBPDataService,
//   saveGenericDeviceDataService,
//   saveDeviceDataService,
//   getGenericDeviceDataService,
// };

const db = require("../config/db"); // your MySQL pool
const {
  getIO,
  userSockets,
  getConnectedUsers,
  isUserConnected,
  getUserSocketId,
} = require("../socket/socketServer");

// Service

const calculateBPStatus = (systolic, diastolic) => {
  const sys = parseInt(systolic);
  const dia = parseInt(diastolic);

  if (sys < 90 || dia < 60) {
    return "Low";
  } else if (sys <= 139 && dia <= 89) {
    return "High";
  } else {
    return "High";
  }
};

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

    // 3. Calculate BP status for BP devices (simplified)
    let processedData = { ...deviceData };

    if (devType === "bp" && deviceData.systolic && deviceData.diastolic) {
      const bpStatus = calculateBPStatus(
        deviceData.systolic,
        deviceData.diastolic
      );
      processedData = {
        ...deviceData,
        bpStatus: bpStatus,
      };
      console.log(
        `📊 Calculated BP Status: ${bpStatus} for BP ${deviceData.systolic}/${deviceData.diastolic}`
      );
    }

    // 4. Always insert into dev_data table
    console.log("💾 Inserting device data into dev_data table...");

    const [result] = await db.query(
      "INSERT INTO dev_data (dev_id, user_id, dev_type, data) VALUES (?, ?, ?, ?)",
      [devId, userId, devType, JSON.stringify(processedData)]
    );

    console.log("✅ Device data inserted successfully. Result:", result);

    const response = {
      insertId: result.insertId,
      devId,
      devType,
      userId,
      deviceData: processedData,
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
  const username = user.email || user.id; // Depends on what's in the token

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
  const username = user.email || user.id; // Depends on what's in the token

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
  const username = user.email || user.id; // Depends on what's in the token

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
        "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at ASC",
      params: {
        userId,
        deviceType,
        startDate: startDateString,
      },
    });

    const [rows] = await db.query(
      "SELECT * FROM dev_data WHERE user_id = ? AND dev_type = ? AND created_at >= ? ORDER BY created_at ASC",
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

const triggerBPAlert = async (patient_id, bpStatus, systolic, diastolic) => {
  console.log("=".repeat(60));
  console.log("🩺 BP ALERT TRIGGERED");
  console.log("=".repeat(60));
  console.log("   Patient ID:", patient_id);
  console.log("   BP Status:", bpStatus);
  console.log("   Reading:", `${systolic}/${diastolic}`);

  try {
    // 1. Get the doctors assigned to this patient
    const assignedDoctors = await knex("patient_doctor_assignments")
      .select("doctor_id")
      .where("patient_id", patient_id)
      .where("is_active", true);

    if (!assignedDoctors || assignedDoctors.length === 0) {
      console.log("⚠️ No active doctors assigned to patient:", patient_id);
      return { ok: false, message: "No doctors assigned to this patient" };
    }

    const doctor_ids = assignedDoctors.map(
      (assignment) => assignment.doctor_id
    );

    console.log("   Assigned Doctor IDs:", doctor_ids);

    // 2. Prepare alert details
    const alertType = `BP_${bpStatus.toUpperCase()}`;
    const alertDesc = `Blood Pressure Alert: ${bpStatus} (${systolic}/${diastolic} mmHg)`;

    // 3. Get connection status
    const connectedUsersBefore = getConnectedUsers();
    console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

    // Verify doctors exist and are active
    const validDoctors = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", doctor_ids)
      .whereIn("role.role_type", ["clinician", "doctor"])
      .where("users.is_active", true);

    console.log("✅ Valid doctors found:", validDoctors.length);

    if (validDoctors.length === 0) {
      console.log("❌ No valid doctors found");
      return { ok: false, message: "No valid doctors found" };
    }

    // Get patient details
    const patientDetails = await knex("users")
      .select("id", "name", "email", "phoneNumber", "organization_id")
      .where("id", patient_id)
      .first();

    if (!patientDetails) {
      console.log("❌ Patient not found");
      return { ok: false, message: "Patient not found" };
    }

    console.log("👤 Patient details:", patientDetails.name);

    // Start transaction
    const transactionResult = await knex.transaction(async (trx) => {
      // Insert alert
      const [alertId] = await trx("alerts").insert({
        user_id: patient_id,
        desc: alertDesc,
        type: alertType,
        created_at: new Date(),
      });

      console.log("📝 Alert inserted with ID:", alertId);

      // Create alert assignments
      const assignments = doctor_ids.map((doctor_id) => ({
        alert_id: alertId,
        doctor_id: doctor_id,
        read_status: false,
        read_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      await trx("alert_assignments").insert(assignments);
      console.log("✅ Alert assignments created for doctors:", doctor_ids);

      // Fetch complete alert details
      const newAlert = await trx("alerts")
        .select(
          "alerts.*",
          "patients.name as patient_name",
          "patients.email as patient_email",
          "patients.phoneNumber as patient_phone",
          "patients.organization_id as patient_organization_id"
        )
        .leftJoin("users as patients", "alerts.user_id", "patients.id")
        .where("alerts.id", alertId)
        .first();

      return { alertId, newAlert, patientDetails };
    });

    // Send WebSocket notifications
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to doctors:", doctor_ids);

    let notificationsSent = 0;
    const notificationResults = [];

    for (const doctor_id of doctor_ids) {
      const doctorSocketId = getUserSocketId(doctor_id);
      const isConnected = isUserConnected(doctor_id);

      console.log(`   👨‍⚕️ Doctor ${doctor_id}:`, {
        socketId: doctorSocketId,
        isConnected: isConnected,
      });

      // Get unread count
      const unreadCount = await knex("alert_assignments")
        .where("doctor_id", doctor_id)
        .andWhere("read_status", false)
        .count("id as count")
        .first();

      const alertData = {
        alert: {
          ...transactionResult.newAlert,
          read_status: false,
          assignment_id: doctor_id,
        },
        patient: patientDetails,
        unread_count: parseInt(unreadCount?.count) || 0,
        timestamp: new Date(),
        server_time: new Date().toISOString(),
        bp_reading: `${systolic}/${diastolic}`,
        bp_status: bpStatus,
      };

      let sent = false;

      // Try multiple methods to send alert
      if (isConnected && doctorSocketId) {
        // Method 1: Send to user's personal room
        io.to(`user_${doctor_id}`).emit("new_alert", alertData);
        console.log(`   ✅ Method 1: Sent to room user_${doctor_id}`);
        sent = true;

        // Method 2: Send to specific socket
        io.to(doctorSocketId).emit("new_alert", alertData);
        console.log(`   ✅ Method 2: Sent to socket ${doctorSocketId}`);
      }

      // Method 3: Broadcast to all clinicians room (fallback)
      io.to("all_clinicians").emit("new_alert_broadcast", {
        ...alertData,
        broadcast: true,
        intended_for: doctor_id,
      });
      console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

      if (sent) {
        notificationsSent++;
      }

      notificationResults.push({
        doctor_id,
        connected: isConnected,
        socket_id: doctorSocketId,
        notification_sent: sent,
      });
    }

    // Get connection status AFTER processing
    const connectedUsersAfter = getConnectedUsers();
    console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

    console.log("✅ BP Alert completed successfully");

    return {
      ok: true,
      message: `BP alert created. Notifications sent to ${notificationsSent}/${doctor_ids.length} doctors`,
      alert: transactionResult.newAlert,
      notifications: {
        sent: notificationsSent,
        total: doctor_ids.length,
        details: notificationResults,
      },
    };
  } catch (error) {
    console.error("❌ Error in triggerBPAlert:", error);
    throw error;
  }
};
const getDevicesUsedService = async (patientId) => {
  // Query devices table directly - get unique devices per user (group by dev_id to avoid duplicates)
  const [devicesRows] = await db.query(
    `SELECT dev_id, dev_type, 
            MIN(created_at) as first_seen,
            MAX(updated_at) as last_seen
     FROM devices 
     WHERE user_id = ?
     GROUP BY dev_id, dev_type
     ORDER BY last_seen DESC`,
    [patientId]
  );

  if (devicesRows && devicesRows.length > 0) {
    // Map to shape frontend expects - use dev_type as device name
    return devicesRows.map((d) => ({
      id: d.dev_id,
      name: d.dev_type || `Device ${d.dev_id}`, // dev_type is the device name
      type: d.dev_type || "device",
      devId: d.dev_id,
      firstSeen: d.first_seen,
      lastSeen: d.last_seen,
    }));
  }

  // Return empty array if no devices found
  return [];
};

module.exports = {
  getDevicesUsedService,
  triggerBPAlert,
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
