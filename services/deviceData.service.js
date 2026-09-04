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
const twilioService = require("../services/twillio.service");

// Service

const calculateBPStatus = (systolic, diastolic) => {
  const sys = parseInt(systolic);
  const dia = parseInt(diastolic);

  // Low BP
  if (sys < 90 || dia < 60) {
    return "Low";
  }
  // Normal BP
  else if (sys <= 120 && dia <= 80) {
    return "Normal";
  }
  // High BP
  else if (sys > 120 || dia > 80) {
    return "High";
  }
  // Default fallback
  else {
    return "Normal";
  }
};
// Convert a client-supplied measurement time (epoch SECONDS, the device
// measuring_timestamp) to a UTC 'YYYY-MM-DD HH:MM:SS' string for dev_data.measured_at,
// or null if absent/implausible. Stored as UTC so it buckets like created_at
// (the count does CONVERT_TZ(col,'+00:00',tz)). NULL falls back to created_at via
// COALESCE. Sanity-bounded so a bad device clock can't misdate billing.
function toUtcMeasuredAtOrNull(epochSeconds) {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n)) return null;
  const ms = n * 1000;
  const min = Date.UTC(2020, 0, 1);
  const max = Date.now() + 24 * 60 * 60 * 1000; // now + 1 day of slack
  if (ms < min || ms > max) return null;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

const createDeviceDataService = async (
  userId,
  devId,
  devType,
  deviceData = {},
  opts = {}
) => {
  console.log("🛠 createDeviceDataService", {
    userId,
    devId,
    devType,
    deviceData,
  });

  // helper reused from your test-alert logic
  const determineTypeForClinician = (vitals) => {
    if (!vitals) return null;
    const sVal = Number.parseInt(vitals.systolic, 10);
    const dVal = Number.parseInt(vitals.diastolic, 10);
    if (Number.isNaN(sVal) && Number.isNaN(dVal)) return null;

    const sExtremeHigh = !Number.isNaN(sVal) && sVal > 140;
    const sModerateHigh = !Number.isNaN(sVal) && sVal >= 130 && sVal <= 140;
    const sExtremeLow = !Number.isNaN(sVal) && sVal < 90;
    const sModerateLow = !Number.isNaN(sVal) && sVal >= 90 && sVal <= 99;

    const dExtremeHigh = !Number.isNaN(dVal) && dVal > 99;
    const dModerateHigh = !Number.isNaN(dVal) && dVal >= 90 && dVal <= 99;
    const dExtremeLow = !Number.isNaN(dVal) && dVal < 60;
    const dModerateLow = !Number.isNaN(dVal) && dVal >= 60 && dVal <= 69;

    const anyHighBand =
      sExtremeHigh || sModerateHigh || dExtremeHigh || dModerateHigh;
    const anyLowBand =
      sExtremeLow || sModerateLow || dExtremeLow || dModerateLow;

    if ((sExtremeHigh || sModerateHigh) && (dExtremeLow || dModerateLow))
      return "abnormal";
    if ((dExtremeHigh || dModerateHigh) && (sExtremeLow || sModerateLow))
      return "abnormal";

    if (sExtremeHigh || dExtremeHigh || sExtremeLow || dExtremeLow)
      return "high";
    if (anyHighBand || anyLowBand) return "low";

    return null;
  };

  // minimal BP status calculator (keeps your previous behavior)
  // Classify a BP reading. Boundaries are standard clinical ranges (AHA/ACC):
  // >=180/>=120 crisis, >=140/>=90 stage-2 hypertension, <90/<60 low. Previously
  // these used strict `>` with a 99 diastolic cutoff (`sVal > 140 || dVal > 99`),
  // which classified 140/95 — clearly Stage 2 — as "Normal", and NaN defaulted to
  // "Normal". A malformed reading is an ERROR state, never Normal: it must
  // surface, not silently pass as a normal reading.
  //
  // NOTE: This label still gates alerting below via `bpStatus !== "Normal"` (the
  // original design). That is a STOPGAP, not the intended end state: the alert
  // path has three overlapping threshold mechanisms (this label; the hardcoded
  // bands in determineTypeForClinician; and doctor_alert_settings, which is read
  // but never applied — see SECURITY_FOLLOWUPS). Those need to collapse into one
  // configurable evaluator; the clinical thresholds are the medical director's to
  // set. An earlier version of this hotfix added a hardcoded >=160/>=100 gate,
  // but that both introduced a third threshold and suppressed alerts in the
  // 141-159 band, so it was reverted.
  const calculateBPStatus = (s, d) => {
    const sVal = Number(s);
    const dVal = Number(d);
    if (!Number.isFinite(sVal) || !Number.isFinite(dVal)) return "Error";

    if (sVal >= 180 || dVal >= 120) return "Emergency";
    if (sVal >= 140 || dVal >= 90) return "High";
    if (sVal < 90 || dVal < 60) return "Low";
    return "Normal";
  };

  let connection;
  try {
    // 1) ensure device exists
    const [existingDevice] = await db.query(
      "SELECT id FROM devices WHERE dev_id = ? AND user_id = ?",
      [devId, userId]
    );

    if (!existingDevice || existingDevice.length === 0) {
      await db.query(
        "INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?, ?, ?)",
        [devId, userId, devType]
      );
    }

    // 2) compute BP status if needed
    let processedData = { ...deviceData };
    if (
      devType === "bp" &&
      deviceData.systolic != null &&
      deviceData.diastolic != null
    ) {
      const bpStatus = calculateBPStatus(
        deviceData.systolic,
        deviceData.diastolic
      );
      processedData = { ...deviceData, bpStatus };
      console.log(
        "📊 Calculated BP status =",
        bpStatus,
        `for ${deviceData.systolic}/${deviceData.diastolic}`
      );
    }

    // 3) insert dev_data. measured_at = the reading's true measurement time (device
    // clock), from the client's data.measured_at; null (COALESCE -> created_at in the
    // count) when absent/implausible or from an app version predating the client change.
    const measuredAt = toUtcMeasuredAtOrNull(deviceData && deviceData.measured_at);
    const [insertResult] = await db.query(
      "INSERT INTO dev_data (dev_id, user_id, dev_type, data, measured_at) VALUES (?, ?, ?, ?, ?)",
      [devId, userId, devType, JSON.stringify(processedData), measuredAt]
    );

    const serviceResponse = {
      insertId: insertResult.insertId,
      devId,
      devType,
      userId,
      deviceData: processedData,
      deviceWasNew: !existingDevice || existingDevice.length === 0,
      alertCreated: false,
    };

    // 4) If BP device and bpStatus is an abnormal CLINICAL state -> run alert
    // logic. With the corrected classifier this fires on >=140/>=90 (Stage 2),
    // Emergency, and Low — so 140/95 alerts and the 141-159 band is no longer
    // suppressed. This is the ORIGINAL design (alert when abnormal), not a new
    // threshold; per-condition thresholds are pending the consolidation.
    //
    // "Error" (a malformed reading) is deliberately EXCLUDED: it is a data-quality
    // state, not a clinical one. It's still persisted as bpStatus:"Error" (so it
    // surfaces in the data instead of silently passing as "Normal"), but it must
    // NOT fire a clinical BP alert — that would render as e.g. "BP alert
    // (severity: low) - abc/95", telling a clinician the patient had a mild
    // low-BP event when the cuff malfunctioned. A distinct device/data-quality
    // alert is a fast-follow (see SECURITY_FOLLOWUPS).
    if (
      devType === "bp" &&
      processedData.bpStatus &&
      processedData.bpStatus !== "Normal" &&
      processedData.bpStatus !== "Error"
    ) {
      console.log(
        "🚨 BP alert logic triggered:",
        `${deviceData.systolic}/${deviceData.diastolic}`,
        `[classified ${processedData.bpStatus}]`
      );

      // open connection to run transactional alert insertions and to fetch clinicians
      connection = await db.getConnection();

      // ✅ Get patient details including organization_id
      const [patientRows] = await connection.query(
        "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
        [userId]
      );
      const patientDetails = patientRows[0];

      if (!patientDetails) {
        throw new Error("Patient not found");
      }

      // ✅ Get organization admins
      const [adminRows] = await connection.query(
        `SELECT users.id, users.name, users.email 
         FROM users 
         JOIN role ON users.id = role.user_id 
         WHERE users.organization_id = ? 
         AND role.role_type = 'admin' 
         AND users.is_active = true`,
        [patientDetails.organization_id]
      );

      const organizationAdmins = adminRows.map((admin) => admin.id);
      console.log("👨‍💼 Organization admins found:", organizationAdmins);

      // Build list of candidate clinicians:
      // Priority: opts.dr_ids (if provided) -> try to fetch patient-doctor assignments -> fallback to clinicians in same organization
      let clinicianRows = [];
      const drIdsFromOpts =
        Array.isArray(opts.dr_ids) && opts.dr_ids.length ? opts.dr_ids : null;

      if (drIdsFromOpts) {
        const [rows] = await connection.query(
          `SELECT u.id, u.name, u.email, u.phoneNumber, role.role_type,
                  das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
           FROM users u
           JOIN role ON u.id = role.user_id
           LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
           WHERE u.id IN (?) AND role.role_type = 'clinician' AND u.is_active = true`,
          [drIdsFromOpts]
        );
        clinicianRows = rows;
      } else {
        // Recipients = the patient's ASSIGNED clinician(s): a BP alert pages the
        // physician responsible for that patient, not the whole org. This joined
        // `patient_doctor` — a table that does NOT exist — so it threw every time
        // and the catch silently fell back to org-wide, paging every clinician in
        // the org for every patient. Corrected to patient_doctor_assignments (the
        // real, authoritative table). See ALERT_FOLLOWUPS #1.
        let rowsAssigned = [];
        try {
          [rowsAssigned] = await connection.query(
            `SELECT u.id, u.name, u.email, u.phoneNumber, role.role_type,
                    das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
             FROM users u
             JOIN role ON u.id = role.user_id
             LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
             JOIN patient_doctor_assignments pd ON pd.doctor_id = u.id
             WHERE pd.patient_id = ? AND role.role_type = 'clinician' AND u.is_active = true`,
            [userId]
          );
        } catch (e) {
          rowsAssigned = []; // fall through to the org fallback below
        }

        if (rowsAssigned.length) {
          clinicianRows = rowsAssigned;
        } else {
          // ORPHAN CASE — the patient has no assigned physician (ORG_CONTEXT #6),
          // OR the assignment query errored. Fall through to org-wide
          // DELIBERATELY: a safety alert must reach someone, never zero
          // recipients. Org clinicians first, then all active clinicians.
          const [patientRows] = await connection.query(
            "SELECT id, organization_id FROM users WHERE id = ?",
            [userId]
          );
          const patient = patientRows[0];
          if (patient && patient.organization_id) {
            const [rowsOrg] = await connection.query(
              `SELECT u.id, u.name, u.email, u.phoneNumber, role.role_type,
                      das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
               FROM users u
               JOIN role ON u.id = role.user_id
               LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
               WHERE u.organization_id = ? AND role.role_type = 'clinician' AND u.is_active = true`,
              [patient.organization_id]
            );
            clinicianRows = rowsOrg;
          } else {
            // final fallback: all active clinicians
            const [rowsAll] = await connection.query(
              `SELECT u.id, u.name, u.email, u.phoneNumber, role.role_type,
                      das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
               FROM users u
               JOIN role ON u.id = role.user_id
               LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
               WHERE role.role_type = 'clinician' AND u.is_active = true`
            );
            clinicianRows = rowsAll;
          }
        }
      }

      console.log("🎯 Candidate clinicians count:", clinicianRows.length);

      // ✅ Use the first clinician as primary assigned doctor
      const primaryDoctorId =
        clinicianRows.length > 0 ? clinicianRows[0].id : null;
      const primaryDoctor = clinicianRows.length > 0 ? clinicianRows[0] : null;

      console.log("🎯 Primary assigned doctor:", primaryDoctor);

      // filter clinicians based on their settings and derived vitals
      const cliniciansToAlert = [];
      const clinicianTypeMap = {};
      const vitals = {
        systolic: processedData.systolic,
        diastolic: processedData.diastolic,
      };
      clinicianRows.forEach((clin) => {
        // determineTypeForClinician uses measured bands
        const derived = determineTypeForClinician(vitals);
        if (derived) {
          cliniciansToAlert.push(clin);
          clinicianTypeMap[clin.id] = derived;
        } else {
          // fallback: if clinician has no specific thresholds saved, include them
          const hasSettings =
            clin.systolic_high ||
            clin.systolic_low ||
            clin.diastolic_high ||
            clin.diastolic_low;
          if (!hasSettings) {
            cliniciansToAlert.push(clin);
            clinicianTypeMap[clin.id] = "low"; // conservative default
          }
        }
      });

      console.log("📣 Final cliniciansToAlert:", cliniciansToAlert.length);

      // ✅ Combine doctor IDs and admin IDs (remove duplicates)
      const clinicianIds = cliniciansToAlert.map((c) => c.id);
      const allRecipientIds = [
        ...new Set([...clinicianIds, ...organizationAdmins]),
      ];
      console.log("📨 All recipients (doctors + admins):", allRecipientIds);

      if (allRecipientIds.length === 0) {
        // nothing to alert for
        serviceResponse.alertCreated = false;
        serviceResponse.filtered = true;
        return serviceResponse;
      }

      // choose overall alert type by priority
      const priority = { abnormal: 3, high: 2, low: 1 };
      let overallType = null;
      for (const clin of cliniciansToAlert) {
        const t = clinicianTypeMap[clin.id] || "low";
        if (!overallType) overallType = t;
        else if (priority[t] > priority[overallType]) overallType = t;
      }
      if (!overallType) overallType = "low";

      // Insert alert + assignments in transaction
      await connection.beginTransaction();
      try {
        const [alertResult] = await connection.query(
          "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
          [
            userId,
            `BP alert (severity: ${overallType}) - ${processedData.systolic}/${processedData.diastolic}`,
            overallType,
            new Date(),
          ]
        );
        const alertId = alertResult.insertId;

        // ✅ Create assignments for ALL recipients (doctors + admins)
        const assignments = allRecipientIds.map((recipient_id) => [
          alertId,
          recipient_id,
          false, // read_status
          null, // read_at
          new Date(), // created_at
          new Date(), // updated_at
        ]);

        await connection.query(
          `INSERT INTO alert_assignments (alert_id, doctor_id, read_status, read_at, created_at, updated_at) VALUES ?`,
          [assignments]
        );

        const [newAlertRows] = await connection.query(
          `SELECT alerts.*, 
                  patients.name as patient_name, 
                  patients.email as patient_email, 
                  patients.phoneNumber as patient_phone, 
                  patients.organization_id as patient_organization_id 
           FROM alerts 
           LEFT JOIN users as patients ON alerts.user_id = patients.id 
           WHERE alerts.id = ?`,
          [alertId]
        );
        const newAlert = newAlertRows[0];

        await connection.commit();

        // ✅ WebSocket notifications for all recipients
        const io = getIO();
        const notificationResults = [];
        let notificationsSent = 0;

        for (const recipient_id of allRecipientIds) {
          const recipientSocketId = getUserSocketId(recipient_id);
          const isConnected = isUserConnected(recipient_id);

          const [unreadCountRows] = await connection.query(
            "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
            [recipient_id]
          );
          const unreadCount = unreadCountRows[0]?.count || 0;

          // ✅ Include primary doctor information
          const alertData = {
            alert: {
              ...newAlert,
              read_status: false,
              assignment_id: recipient_id,
              primary_assigned_doctor_id: primaryDoctorId,
              primary_assigned_doctor_name:
                primaryDoctor?.name || "Unknown Doctor",
              primary_assigned_doctor_email: primaryDoctor?.email || "N/A",
              derived_type: clinicianTypeMap[recipient_id] || overallType,
            },
            patient: patientDetails,
            assigned_doctor: primaryDoctor
              ? {
                  id: primaryDoctor.id,
                  name: primaryDoctor.name,
                  email: primaryDoctor.email,
                  phone: primaryDoctor.phoneNumber,
                }
              : null,
            unread_count: parseInt(unreadCount) || 0,
            timestamp: new Date(),
            server_time: new Date().toISOString(),
            vital_data: vitals,
          };

          let sent = false;

          // Try multiple methods to send alert
          if (isConnected && recipientSocketId) {
            // Method 1: Send to user's personal room
            io.to(`user_${recipient_id}`).emit("new_alert", alertData);
            console.log(`   ✅ Method 1: Sent to room user_${recipient_id}`);
            sent = true;

            // Method 2: Send to specific socket
            io.to(recipientSocketId).emit("new_alert", alertData);
            console.log(`   ✅ Method 2: Sent to socket ${recipientSocketId}`);
          }

          // ✅ Send to admins room for admin recipients
          if (organizationAdmins.includes(recipient_id)) {
            io.to("all_admins").emit("admin_alert", {
              ...alertData,
              is_admin_alert: true,
            });
            console.log(
              `   ✅ Method 3: Sent to admins room for admin ${recipient_id}`
            );
          }

          if (sent) {
            notificationsSent++;
          }

          notificationResults.push({
            recipient_id,
            role: organizationAdmins.includes(recipient_id)
              ? "admin"
              : "clinician",
            connected: isConnected,
            socket_id: recipientSocketId,
            notification_sent: sent,
          });
        }

        // ✅ TWILIO SMS NOTIFICATIONS FOR CLINICIANS
        console.log("=".repeat(50));
        console.log("📱 STARTING SMS NOTIFICATIONS FOR CLINICIANS");
        console.log("=".repeat(50));

        const smsResults = [];
        const smsPromises = [];

        // Get patient name for SMS message
        const patientName = patientDetails.name || "Patient";

        // Send SMS to all clinicians (not admins)
        for (const clinician of cliniciansToAlert) {
          // Only send SMS if clinician has a phone number
          if (clinician.phoneNumber) {
            const formattedPhone = twilioService.formatPhoneNumber(
              clinician.phoneNumber
            );

            if (formattedPhone) {
              // Create personalized SMS message
              const smsMessage = `🚨 ALERT: Your patient ${patientName} has a ${overallType.toUpperCase()} BP reading: ${
                processedData.systolic
              }/${
                processedData.diastolic
              }. Please check the portal for details and contact them if necessary.`;

              console.log(
                `   📲 Sending SMS to Dr. ${clinician.name} (${formattedPhone})`
              );

              // Create SMS promise
              const smsPromise = twilioService
                .sendSMS(formattedPhone, smsMessage)
                .then((smsResult) => ({
                  recipient_id: clinician.id,
                  recipient_name: clinician.name,
                  phone: formattedPhone,
                  role: "clinician",
                  sms_success: smsResult.success,
                  message_id: smsResult.messageId,
                  error: smsResult.error,
                }))
                .catch((error) => ({
                  recipient_id: clinician.id,
                  recipient_name: clinician.name,
                  phone: formattedPhone,
                  role: "clinician",
                  sms_success: false,
                  error: error.message,
                }));

              smsPromises.push(smsPromise);
            } else {
              console.log(
                `   ⚠️  Invalid phone number for Dr. ${clinician.name}: ${clinician.phoneNumber}`
              );
              smsResults.push({
                recipient_id: clinician.id,
                recipient_name: clinician.name,
                phone: clinician.phoneNumber,
                role: "clinician",
                sms_success: false,
                error: "Invalid phone number format",
              });
            }
          } else {
            console.log(
              `   ⚠️  No phone number available for Dr. ${clinician.name}`
            );
            smsResults.push({
              recipient_id: clinician.id,
              recipient_name: clinician.name,
              phone: null,
              role: "clinician",
              sms_success: false,
              error: "No phone number available",
            });
          }
        }

        // Wait for all SMS promises to complete
        if (smsPromises.length > 0) {
          const smsPromiseResults = await Promise.allSettled(smsPromises);

          // Extract results from promises
          smsPromiseResults.forEach((result) => {
            if (result.status === "fulfilled") {
              smsResults.push(result.value);
            }
          });
        }

        console.log("✅ SMS notifications completed");

        // Calculate SMS success stats
        const successfulSMS = smsResults.filter((r) => r.sms_success).length;
        const totalSMSAttempts = smsResults.length;

        console.log(
          `📊 SMS Results: ${successfulSMS}/${totalSMSAttempts} successful`
        );

        // ✅ Update service response with all notification data
        serviceResponse.alertCreated = true;
        serviceResponse.alert = newAlert;
        serviceResponse.primary_assigned_doctor = primaryDoctor;
        serviceResponse.recipients = {
          doctors: clinicianIds,
          admins: organizationAdmins,
          primary_doctor: primaryDoctorId,
          total: allRecipientIds.length,
        };
        serviceResponse.notifications = {
          websocket: {
            sent: notificationsSent,
            total: allRecipientIds.length,
            details: notificationResults,
          },
          sms: {
            sent: successfulSMS,
            total: totalSMSAttempts,
            details: smsResults,
          },
        };

        return serviceResponse;
      } catch (txErr) {
        await connection.rollback();
        console.error("❌ BP alert transaction rolled back:", txErr);
        throw txErr;
      }
    } // end BP alert block

    return serviceResponse;
  } catch (error) {
    console.error("❌ createDeviceDataService error:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};
// const createDeviceDataService = async (
//   userId,
//   devId,
//   devType,
//   deviceData = {},
//   opts = {}
// ) => {
//   console.log("🛠 createDeviceDataService", {
//     userId,
//     devId,
//     devType,
//     deviceData,
//   });

//   // helper reused from your test-alert logic
//   const determineTypeForClinician = (vitals) => {
//     if (!vitals) return null;
//     const sVal = Number.parseInt(vitals.systolic, 10);
//     const dVal = Number.parseInt(vitals.diastolic, 10);
//     if (Number.isNaN(sVal) && Number.isNaN(dVal)) return null;

//     const sExtremeHigh = !Number.isNaN(sVal) && sVal > 140;
//     const sModerateHigh = !Number.isNaN(sVal) && sVal >= 130 && sVal <= 140;
//     const sExtremeLow = !Number.isNaN(sVal) && sVal < 90;
//     const sModerateLow = !Number.isNaN(sVal) && sVal >= 90 && sVal <= 99;

//     const dExtremeHigh = !Number.isNaN(dVal) && dVal > 99;
//     const dModerateHigh = !Number.isNaN(dVal) && dVal >= 90 && dVal <= 99;
//     const dExtremeLow = !Number.isNaN(dVal) && dVal < 60;
//     const dModerateLow = !Number.isNaN(dVal) && dVal >= 60 && dVal <= 69;

//     const anyHighBand =
//       sExtremeHigh || sModerateHigh || dExtremeHigh || dModerateHigh;
//     const anyLowBand =
//       sExtremeLow || sModerateLow || dExtremeLow || dModerateLow;

//     if ((sExtremeHigh || sModerateHigh) && (dExtremeLow || dModerateLow))
//       return "abnormal";
//     if ((dExtremeHigh || dModerateHigh) && (sExtremeLow || sModerateLow))
//       return "abnormal";

//     if (sExtremeHigh || dExtremeHigh || sExtremeLow || dExtremeLow)
//       return "high";
//     if (anyHighBand || anyLowBand) return "low";

//     return null;
//   };

//   // minimal BP status calculator (keeps your previous behavior)
//   const calculateBPStatus = (s, d) => {
//     const sVal = Number(s);
//     const dVal = Number(d);
//     if (Number.isNaN(sVal) || Number.isNaN(dVal)) return "Normal";

//     if (sVal > 180 || dVal > 120) return "Emergency";
//     if (sVal > 140 || dVal > 99) return "High";
//     if (sVal < 90 || dVal < 60) return "Low";
//     return "Normal";
//   };

//   let connection;
//   try {
//     // 1) ensure device exists
//     const [existingDevice] = await db.query(
//       "SELECT id FROM devices WHERE dev_id = ? AND user_id = ?",
//       [devId, userId]
//     );

//     if (!existingDevice || existingDevice.length === 0) {
//       await db.query(
//         "INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?, ?, ?)",
//         [devId, userId, devType]
//       );
//     }

//     // 2) compute BP status if needed
//     let processedData = { ...deviceData };
//     if (
//       devType === "bp" &&
//       deviceData.systolic != null &&
//       deviceData.diastolic != null
//     ) {
//       const bpStatus = calculateBPStatus(
//         deviceData.systolic,
//         deviceData.diastolic
//       );
//       processedData = { ...deviceData, bpStatus };
//       console.log(
//         "📊 Calculated BP status =",
//         bpStatus,
//         `for ${deviceData.systolic}/${deviceData.diastolic}`
//       );
//     }

//     // 3) insert dev_data
//     const [insertResult] = await db.query(
//       "INSERT INTO dev_data (dev_id, user_id, dev_type, data) VALUES (?, ?, ?, ?)",
//       [devId, userId, devType, JSON.stringify(processedData)]
//     );

//     const serviceResponse = {
//       insertId: insertResult.insertId,
//       devId,
//       devType,
//       userId,
//       deviceData: processedData,
//       deviceWasNew: !existingDevice || existingDevice.length === 0,
//       alertCreated: false,
//     };

//     // 4) If BP device and bpStatus is not Normal -> run test-alert logic
//     if (
//       devType === "bp" &&
//       processedData.bpStatus &&
//       processedData.bpStatus !== "Normal"
//     ) {
//       console.log(
//         "🚨 BP Alert logic triggered from device data:",
//         processedData.bpStatus
//       );

//       // open connection to run transactional alert insertions and to fetch clinicians
//       connection = await db.getConnection();

//       // ✅ NEW: Get patient details including organization_id
//       const [patientRows] = await connection.query(
//         "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
//         [userId]
//       );
//       const patientDetails = patientRows[0];

//       if (!patientDetails) {
//         throw new Error("Patient not found");
//       }

//       // ✅ NEW: Get organization admins (same as test-alert route)
//       const [adminRows] = await connection.query(
//         `SELECT users.id, users.name, users.email
//          FROM users
//          JOIN role ON users.id = role.user_id
//          WHERE users.organization_id = ?
//          AND role.role_type = 'admin'
//          AND users.is_active = true`,
//         [patientDetails.organization_id]
//       );

//       const organizationAdmins = adminRows.map((admin) => admin.id);
//       console.log("👨‍💼 Organization admins found:", organizationAdmins);

//       // Build list of candidate clinicians:
//       // Priority: opts.dr_ids (if provided) -> try to fetch patient-doctor assignments -> fallback to clinicians in same organization
//       let clinicianRows = [];
//       const drIdsFromOpts =
//         Array.isArray(opts.dr_ids) && opts.dr_ids.length ? opts.dr_ids : null;

//       if (drIdsFromOpts) {
//         const [rows] = await connection.query(
//           `SELECT u.id, u.name, u.email, role.role_type,
//                   das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
//            FROM users u
//            JOIN role ON u.id = role.user_id
//            LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
//            WHERE u.id IN (?) AND role.role_type = 'clinician' AND u.is_active = true`,
//           [drIdsFromOpts]
//         );
//         clinicianRows = rows;
//       } else {
//         // try to fetch clinicians assigned to this patient from common assignment tables (best-effort)
//         // if your schema uses a different table name, replace 'patient_doctor' with it.
//         try {
//           const [rowsAssigned] = await connection.query(
//             `SELECT u.id, u.name, u.email, role.role_type,
//                     das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
//              FROM users u
//              JOIN role ON u.id = role.user_id
//              LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
//              JOIN patient_doctor pd ON pd.doctor_id = u.id
//              WHERE pd.patient_id = ? AND role.role_type = 'clinician' AND u.is_active = true`,
//             [userId]
//           );
//           clinicianRows = rowsAssigned;
//         } catch (e) {
//           // fallback: clinicians in same organization as patient
//           const [patientRows] = await connection.query(
//             "SELECT id, organization_id FROM users WHERE id = ?",
//             [userId]
//           );
//           const patient = patientRows[0];
//           if (patient && patient.organization_id) {
//             const [rowsOrg] = await connection.query(
//               `SELECT u.id, u.name, u.email, role.role_type,
//                       das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
//                FROM users u
//                JOIN role ON u.id = role.user_id
//                LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
//                WHERE u.organization_id = ? AND role.role_type = 'clinician' AND u.is_active = true`,
//               [patient.organization_id]
//             );
//             clinicianRows = rowsOrg;
//           } else {
//             // final fallback: all active clinicians
//             const [rowsAll] = await connection.query(
//               `SELECT u.id, u.name, u.email, role.role_type,
//                       das.systolic_high, das.systolic_low, das.diastolic_high, das.diastolic_low
//                FROM users u
//                JOIN role ON u.id = role.user_id
//                LEFT JOIN doctor_alert_settings das ON u.id = das.doctor_id
//                WHERE role.role_type = 'clinician' AND u.is_active = true`
//             );
//             clinicianRows = rowsAll;
//           }
//         }
//       }

//       console.log("🎯 Candidate clinicians count:", clinicianRows.length);

//       // ✅ NEW: Use the first clinician as primary assigned doctor (same as test-alert)
//       const primaryDoctorId =
//         clinicianRows.length > 0 ? clinicianRows[0].id : null;
//       const primaryDoctor = clinicianRows.length > 0 ? clinicianRows[0] : null;

//       console.log("🎯 Primary assigned doctor:", primaryDoctor);

//       // filter clinicians based on their settings and derived vitals
//       const cliniciansToAlert = [];
//       const clinicianTypeMap = {};
//       const vitals = {
//         systolic: processedData.systolic,
//         diastolic: processedData.diastolic,
//       };
//       clinicianRows.forEach((clin) => {
//         // determineTypeForClinician uses measured bands (same as test-alert)
//         const derived = determineTypeForClinician(vitals);
//         if (derived) {
//           cliniciansToAlert.push(clin);
//           clinicianTypeMap[clin.id] = derived;
//         } else {
//           // fallback: if clinician has no specific thresholds saved, include them
//           const hasSettings =
//             clin.systolic_high ||
//             clin.systolic_low ||
//             clin.diastolic_high ||
//             clin.diastolic_low;
//           if (!hasSettings) {
//             cliniciansToAlert.push(clin);
//             clinicianTypeMap[clin.id] = "low"; // conservative default
//           }
//         }
//       });

//       console.log("📣 Final cliniciansToAlert:", cliniciansToAlert.length);

//       // ✅ NEW: Combine doctor IDs and admin IDs (remove duplicates) - same as test-alert
//       const clinicianIds = cliniciansToAlert.map((c) => c.id);
//       const allRecipientIds = [
//         ...new Set([...clinicianIds, ...organizationAdmins]),
//       ];
//       console.log("📨 All recipients (doctors + admins):", allRecipientIds);

//       if (allRecipientIds.length === 0) {
//         // nothing to alert for
//         serviceResponse.alertCreated = false;
//         serviceResponse.filtered = true;
//         return serviceResponse;
//       }

//       // choose overall alert type by priority
//       const priority = { abnormal: 3, high: 2, low: 1 };
//       let overallType = null;
//       for (const clin of cliniciansToAlert) {
//         const t = clinicianTypeMap[clin.id] || "low";
//         if (!overallType) overallType = t;
//         else if (priority[t] > priority[overallType]) overallType = t;
//       }
//       if (!overallType) overallType = "low";

//       // Insert alert + assignments in transaction
//       await connection.beginTransaction();
//       try {
//         const [alertResult] = await connection.query(
//           "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
//           [
//             userId,
//             `BP alert (severity: ${overallType}) - ${processedData.systolic}/${processedData.diastolic}`,
//             overallType,
//             new Date(),
//           ]
//         );
//         const alertId = alertResult.insertId;

//         // ✅ UPDATED: Create assignments for ALL recipients (doctors + admins)
//         const assignments = allRecipientIds.map((recipient_id) => [
//           alertId,
//           recipient_id,
//           false, // read_status
//           null, // read_at
//           new Date(), // created_at
//           new Date(), // updated_at
//         ]);

//         await connection.query(
//           `INSERT INTO alert_assignments (alert_id, doctor_id, read_status, read_at, created_at, updated_at) VALUES ?`,
//           [assignments]
//         );

//         const [newAlertRows] = await connection.query(
//           `SELECT alerts.*,
//                   patients.name as patient_name,
//                   patients.email as patient_email,
//                   patients.phoneNumber as patient_phone,
//                   patients.organization_id as patient_organization_id
//            FROM alerts
//            LEFT JOIN users as patients ON alerts.user_id = patients.id
//            WHERE alerts.id = ?`,
//           [alertId]
//         );
//         const newAlert = newAlertRows[0];

//         await connection.commit();

//         // ✅ ENHANCED: WebSocket notifications for all recipients
//         const io = getIO();
//         const notificationResults = [];
//         let notificationsSent = 0;

//         for (const recipient_id of allRecipientIds) {
//           const recipientSocketId = getUserSocketId(recipient_id);
//           const isConnected = isUserConnected(recipient_id);

//           const [unreadCountRows] = await connection.query(
//             "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
//             [recipient_id]
//           );
//           const unreadCount = unreadCountRows[0]?.count || 0;

//           // ✅ ENHANCED: Include primary doctor information (same as test-alert)
//           const alertData = {
//             alert: {
//               ...newAlert,
//               read_status: false,
//               assignment_id: recipient_id,
//               // ✅ NEW: Include primary doctor assignment info
//               primary_assigned_doctor_id: primaryDoctorId,
//               primary_assigned_doctor_name:
//                 primaryDoctor?.name || "Unknown Doctor",
//               primary_assigned_doctor_email: primaryDoctor?.email || "N/A",
//               derived_type: clinicianTypeMap[recipient_id] || overallType,
//             },
//             patient: patientDetails, // ✅ Use full patient details
//             // ✅ NEW: Include assigned doctor details
//             assigned_doctor: primaryDoctor
//               ? {
//                   id: primaryDoctor.id,
//                   name: primaryDoctor.name,
//                   email: primaryDoctor.email,
//                   phone: primaryDoctor.phoneNumber,
//                 }
//               : null,
//             unread_count: parseInt(unreadCount) || 0,
//             timestamp: new Date(),
//             server_time: new Date().toISOString(),
//             vital_data: vitals,
//           };

//           let sent = false;

//           // Try multiple methods to send alert
//           if (isConnected && recipientSocketId) {
//             // Method 1: Send to user's personal room
//             io.to(`user_${recipient_id}`).emit("new_alert", alertData);
//             console.log(`   ✅ Method 1: Sent to room user_${recipient_id}`);
//             sent = true;

//             // Method 2: Send to specific socket
//             io.to(recipientSocketId).emit("new_alert", alertData);
//             console.log(`   ✅ Method 2: Sent to socket ${recipientSocketId}`);
//           }

//           // Method 3: Broadcast to all clinicians room (fallback)
//           // io.to("all_clinicians").emit("new_alert_broadcast", {
//           //   ...alertData,
//           //   broadcast: true,
//           //   intended_for: recipient_id,
//           // });
//           // console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

//           // ✅ NEW: Method 4: Send to admins room
//           if (organizationAdmins.includes(recipient_id)) {
//             io.to("all_admins").emit("admin_alert", {
//               ...alertData,
//               is_admin_alert: true,
//             });
//             console.log(
//               `   ✅ Method 4: Sent to admins room for admin ${recipient_id}`
//             );
//           }

//           if (sent) {
//             notificationsSent++;
//           }

//           notificationResults.push({
//             recipient_id,
//             role: organizationAdmins.includes(recipient_id)
//               ? "admin"
//               : "clinician",
//             connected: isConnected,
//             socket_id: recipientSocketId,
//             notification_sent: sent,
//           });
//         }

//         serviceResponse.alertCreated = true;
//         serviceResponse.alert = newAlert;
//         serviceResponse.primary_assigned_doctor = primaryDoctor;
//         serviceResponse.recipients = {
//           doctors: clinicianIds,
//           admins: organizationAdmins,
//           primary_doctor: primaryDoctorId,
//           total: allRecipientIds.length,
//         };
//         serviceResponse.notifications = {
//           sent: notificationsSent,
//           total: allRecipientIds.length,
//           details: notificationResults,
//         };

//         return serviceResponse;
//       } catch (txErr) {
//         await connection.rollback();
//         console.error("❌ BP alert transaction rolled back:", txErr);
//         throw txErr;
//       }
//     } // end BP alert block

//     return serviceResponse;
//   } catch (error) {
//     console.error("❌ createDeviceDataService error:", error);
//     throw error;
//   } finally {
//     if (connection) connection.release();
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

  let connection;
  try {
    // Get database connection
    connection = await db.getConnection();

    // 1. Get the doctors assigned to this patient
    const [assignedDoctors] = await connection.query(
      "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
      [patient_id]
    );

    if (!assignedDoctors || assignedDoctors.length === 0) {
      console.log("⚠️ No doctors assigned to patient:", patient_id);
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
    const [validDoctors] = await connection.query(
      `SELECT users.id, users.name, users.email, role.role_type 
       FROM users 
       JOIN role ON users.id = role.user_id 
       WHERE users.id IN (?) 
       AND role.role_type IN ('clinician', 'doctor') 
       AND users.is_active = true`,
      [doctor_ids]
    );

    console.log("✅ Valid doctors found:", validDoctors.length);

    if (validDoctors.length === 0) {
      console.log("❌ No valid doctors found");
      return { ok: false, message: "No valid doctors found" };
    }

    // Get patient details
    const [patientRows] = await connection.query(
      "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
      [patient_id]
    );

    const patientDetails = patientRows[0];
    if (!patientDetails) {
      console.log("❌ Patient not found");
      return { ok: false, message: "Patient not found" };
    }

    console.log("👤 Patient details:", patientDetails.name);

    // Start transaction
    await connection.beginTransaction();

    try {
      // FIX: Use backticks around 'desc' since it's a reserved keyword
      const [alertResult] = await connection.query(
        "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
        [patient_id, alertDesc, alertType, new Date()]
      );

      const alertId = alertResult.insertId;
      console.log("📝 Alert inserted with ID:", alertId);

      // Create alert assignments
      const assignmentValues = doctor_ids.map((doctor_id) => [
        alertId,
        doctor_id,
        false, // read_status
        null, // read_at
        new Date(), // created_at
        new Date(), // updated_at
      ]);

      await connection.query(
        `INSERT INTO alert_assignments 
         (alert_id, doctor_id, read_status, read_at, created_at, updated_at) 
         VALUES ?`,
        [assignmentValues]
      );

      console.log("✅ Alert assignments created for doctors:", doctor_ids);

      // Fetch complete alert details
      const [alertRows] = await connection.query(
        `SELECT alerts.*, 
                patients.name as patient_name, 
                patients.email as patient_email, 
                patients.phoneNumber as patient_phone, 
                patients.organization_id as patient_organization_id 
         FROM alerts 
         LEFT JOIN users as patients ON alerts.user_id = patients.id 
         WHERE alerts.id = ?`,
        [alertId]
      );

      const newAlert = alertRows[0];

      // Commit transaction
      await connection.commit();

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
        const [unreadCountRows] = await connection.query(
          "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
          [doctor_id]
        );

        const unreadCount = unreadCountRows[0].count;

        const alertData = {
          alert: {
            ...newAlert,
            read_status: false,
            assignment_id: doctor_id,
          },
          patient: patientDetails,
          unread_count: parseInt(unreadCount) || 0,
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

        // REMOVED: the all_clinicians "fallback" broadcast. Method 1 above
        // already delivers to the responsible recipient's own room; the
        // broadcast fanned every alert to every clinician (org-wide realtime
        // leak). It was harmless only while the socket all_clinicians gate was
        // dead — now that the gate is live, this must not exist. Org-wide staff
        // get alert VISIBILITY via the read queries, not a realtime broadcast.

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
        alert: newAlert,
        notifications: {
          sent: notificationsSent,
          total: doctor_ids.length,
          details: notificationResults,
        },
      };
    } catch (transactionError) {
      // Rollback transaction if anything fails
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("❌ Error in triggerBPAlert:", error);
    throw error;
  } finally {
    // Always release the connection back to the pool
    if (connection) {
      connection.release();
    }
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
