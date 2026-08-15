// const express = require("express");
// const jwt = require("jsonwebtoken");
// const db = require("../config/db");
// const { authRequired } = require("../middleware/auth");

// const {
//   userSockets,
//   getIO,
//   getConnectedUsers,
//   isUserConnected,
//   getUserSocketId,
// } = require("../socket/socketServer");

// const router = express.Router();
// // ✅ Helper to calculate BP status
// const calculateBPStatus = (systolic, diastolic) => {
//   const sys = parseInt(systolic);
//   const dia = parseInt(diastolic);

//   if (sys < 90 || dia < 60) return "Low";
//   else if (sys <= 120 && dia <= 80) return "Normal";
//   else if (sys > 120 || dia > 80) return "High";
//   else return "Normal";
// };
// // Debug endpoint to check connected users
// router.get("/debug-connected-users", (req, res) => {
//   const connectedUsers = Array.from(userSockets.entries());
//   console.log("🔍 DEBUG: Currently connected users:", connectedUsers);

//   res.json({
//     ok: true,
//     connected_users: connectedUsers.map(([userId, socketId]) => ({
//       user_id: userId,
//       socket_id: socketId,
//     })),
//     total_connected: connectedUsers.length,
//   });
// });

// // TEMPORARY TEST ROUTE - Remove this after testing
// // routes/alert.route.js - COMPLETE FIXED VERSION
// router.post("/test-alert", async (req, res) => {
//   const { dr_ids, type, desc, patient_id = 21 } = req.body;

//   console.log("=".repeat(60));
//   console.log("🚨 TEST ALERT CREATION REQUEST");
//   console.log("=".repeat(60));
//   console.log("   Patient ID:", patient_id);
//   console.log("   Doctor IDs:", dr_ids);
//   console.log("   Alert Type:", type);
//   console.log("   Description:", desc);

//   // Validate input
//   if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
//     return res.status(400).json({
//       ok: false,
//       message: "Invalid request: dr_ids (non-empty array) and type required",
//     });
//   }

//   try {
//     // Get connection status BEFORE processing
//     const connectedUsersBefore = getConnectedUsers();
//     console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

//     // Verify clinicians exist and are active
//     const validClinicians = await db("users")
//       .select("users.id", "users.name", "users.email", "role.role_type")
//       .join("role", "users.id", "role.user_id")
//       .whereIn("users.id", dr_ids)
//       .where("role.role_type", "clinician")
//       .where("users.is_active", true);

//     console.log("✅ Valid clinicians found:", validClinicians.length);

//     if (validClinicians.length === 0) {
//       return res.status(400).json({
//         ok: false,
//         message: "No valid clinicians found from the provided IDs",
//       });
//     }

//     // Get patient details
//     const patientDetails = await db("users")
//       .select("id", "name", "email", "phoneNumber", "organization_id")
//       .where("id", patient_id)
//       .first();

//     if (!patientDetails) {
//       return res.status(400).json({
//         ok: false,
//         message: "Patient not found",
//       });
//     }

//     console.log("👤 Patient details:", patientDetails);

//     // Start transaction
//     const transactionResult = await db.transaction(async (trx) => {
//       // Insert alert
//       const [alertId] = await trx("alerts").insert({
//         user_id: patient_id,
//         desc: desc || `Health alert with severity: ${type}`,
//         type: type,
//         created_at: new Date(),
//       });

//       console.log("📝 Alert inserted with ID:", alertId);

//       // ✅ FIXED: Use correct column names for alert_assignments
//       const assignments = dr_ids.map((clinician_id) => ({
//         alert_id: alertId,
//         doctor_id: clinician_id,
//         read_status: false,
//         read_at: null,
//         created_at: new Date(), // ✅ Use created_at instead of assigned_at
//         updated_at: new Date(), // ✅ Add updated_at
//       }));

//       await trx("alert_assignments").insert(assignments);
//       console.log("✅ Alert assignments created for clinicians:", dr_ids);

//       // Fetch complete alert details
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

//     // Send WebSocket notifications
//     const io = getIO();
//     console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

//     let notificationsSent = 0;
//     const notificationResults = [];

//     for (const clinician_id of dr_ids) {
//       const clinicianSocketId = getUserSocketId(clinician_id);
//       const isConnected = isUserConnected(clinician_id);

//       console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
//         socketId: clinicianSocketId,
//         isConnected: isConnected,
//         inUserSockets: userSockets.has(clinician_id.toString()),
//       });

//       // Get unread count
//       const unreadCount = await db("alert_assignments")
//         .where("doctor_id", clinician_id)
//         .andWhere("read_status", false)
//         .count("id as count")
//         .first();

//       const alertData = {
//         alert: {
//           ...transactionResult.newAlert,
//           read_status: false,
//           assignment_id: clinician_id,
//         },
//         patient: patientDetails,
//         unread_count: parseInt(unreadCount?.count) || 0,
//         timestamp: new Date(),
//         server_time: new Date().toISOString(),
//       };

//       let sent = false;

//       // Try multiple methods to send alert
//       if (isConnected && clinicianSocketId) {
//         // Method 1: Send to user's personal room
//         io.to(`user_${clinician_id}`).emit("new_alert", alertData);
//         console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);
//         sent = true;

//         // Method 2: Send to specific socket
//         io.to(clinicianSocketId).emit("new_alert", alertData);
//         console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);
//       }

//       // Method 3: Broadcast to all clinicians room (fallback)
//       io.to("all_clinicians").emit("new_alert_broadcast", {
//         ...alertData,
//         broadcast: true,
//         intended_for: clinician_id,
//       });
//       console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

//       if (sent) {
//         notificationsSent++;
//       }

//       notificationResults.push({
//         clinician_id,
//         connected: isConnected,
//         socket_id: clinicianSocketId,
//         notification_sent: sent,
//       });
//     }

//     // Get connection status AFTER processing
//     const connectedUsersAfter = getConnectedUsers();
//     console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

//     res.status(201).json({
//       ok: true,
//       message: `Alert created successfully. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
//       alert: transactionResult.newAlert,
//       patient: patientDetails,
//       notifications: {
//         sent: notificationsSent,
//         total: dr_ids.length,
//         details: notificationResults,
//       },
//       connection_info: {
//         before: connectedUsersBefore,
//         after: connectedUsersAfter,
//         total_connections: connectedUsersAfter.length,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Error creating alert:", error);
//     res.status(500).json({
//       ok: false,
//       message: "Server error creating alert",
//       error: error.message,
//       stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
//     });
//   }
// });

// // New endpoint to check socket connections
// router.get("/connection-status", (req, res) => {
//   const connectedUsers = getConnectedUsers();

//   res.json({
//     ok: true,
//     connected_users: connectedUsers,
//     total_connections: connectedUsers.length,
//     timestamp: new Date().toISOString(),
//   });
// });
// // router.post("/test-alert", async (req, res) => {
// //   const { dr_ids, type, desc, patient_id = 21 } = req.body;

// //   console.log("=".repeat(60));
// //   console.log("🚨 TEST ALERT CREATION REQUEST");
// //   console.log("=".repeat(60));
// //   console.log("   Patient ID:", patient_id);
// //   console.log("   Doctor IDs:", dr_ids);
// //   console.log("   Alert Type:", type);
// //   console.log("   Description:", desc);

// //   // Validate input
// //   if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
// //     return res.status(400).json({
// //       ok: false,
// //       message: "Invalid request: dr_ids (non-empty array) and type required",
// //     });
// //   }

// //   try {
// //     // Get connection status BEFORE processing
// //     const connectedUsersBefore = getConnectedUsers();
// //     console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

// //     // Verify clinicians exist and are active
// //     const validClinicians = await db("users")
// //       .select("users.id", "users.name", "users.email", "role.role_type")
// //       .join("role", "users.id", "role.user_id")
// //       .whereIn("users.id", dr_ids)
// //       .where("role.role_type", "clinician")
// //       .where("users.is_active", true);

// //     console.log("✅ Valid clinicians found:", validClinicians.length);

// //     if (validClinicians.length === 0) {
// //       return res.status(400).json({
// //         ok: false,
// //         message: "No valid clinicians found from the provided IDs",
// //       });
// //     }

// //     // Get patient details
// //     const patientDetails = await db("users")
// //       .select("id", "name", "email", "phoneNumber", "organization_id")
// //       .where("id", patient_id)
// //       .first();

// //     if (!patientDetails) {
// //       return res.status(400).json({
// //         ok: false,
// //         message: "Patient not found",
// //       });
// //     }

// //     console.log("👤 Patient details:", patientDetails);

// //     // Start transaction
// //     const transactionResult = await db.transaction(async (trx) => {
// //       // Insert alert
// //       const [alertId] = await trx("alerts").insert({
// //         user_id: patient_id,
// //         desc: desc || `Health alert with severity: ${type}`,
// //         type: type,
// //         created_at: new Date(),
// //       });

// //       console.log("📝 Alert inserted with ID:", alertId);

// //       // Insert assignments
// //       const assignments = dr_ids.map((clinician_id) => ({
// //         alert_id: alertId,
// //         doctor_id: clinician_id,
// //         read_status: false,
// //         read_at: null,
// //         assigned_at: new Date(),
// //       }));

// //       await trx("alert_assignments").insert(assignments);

// //       // Fetch complete alert details
// //       const newAlert = await trx("alerts")
// //         .select(
// //           "alerts.*",
// //           "patients.name as patient_name",
// //           "patients.email as patient_email",
// //           "patients.phoneNumber as patient_phone",
// //           "patients.organization_id as patient_organization_id"
// //         )
// //         .leftJoin("users as patients", "alerts.user_id", "patients.id")
// //         .where("alerts.id", alertId)
// //         .first();

// //       return { alertId, newAlert, patientDetails };
// //     });

// //     // Send WebSocket notifications
// //     const io = getIO();
// //     console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

// //     let notificationsSent = 0;
// //     const notificationResults = [];

// //     for (const clinician_id of dr_ids) {
// //       const clinicianSocketId = getUserSocketId(clinician_id);
// //       const isConnected = isUserConnected(clinician_id);

// //       console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
// //         socketId: clinicianSocketId,
// //         isConnected: isConnected,
// //         inUserSockets: userSockets.has(clinician_id.toString()),
// //       });

// //       // Get unread count
// //       const unreadCount = await db("alert_assignments")
// //         .where("doctor_id", clinician_id)
// //         .andWhere("read_status", false)
// //         .count("id as count")
// //         .first();

// //       const alertData = {
// //         alert: {
// //           ...transactionResult.newAlert,
// //           read_status: false,
// //           assignment_id: clinician_id,
// //         },
// //         patient: patientDetails,
// //         unread_count: parseInt(unreadCount?.count) || 0,
// //         timestamp: new Date(),
// //         server_time: new Date().toISOString(),
// //       };

// //       let sent = false;

// //       // Try multiple methods to send alert
// //       if (isConnected && clinicianSocketId) {
// //         // Method 1: Send to user's personal room
// //         io.to(`user_${clinician_id}`).emit("new_alert", alertData);
// //         console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);
// //         sent = true;

// //         // Method 2: Send to specific socket
// //         io.to(clinicianSocketId).emit("new_alert", alertData);
// //         console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);
// //       }

// //       // Method 3: Broadcast to all clinicians room (fallback)
// //       io.to("all_clinicians").emit("new_alert_broadcast", {
// //         ...alertData,
// //         broadcast: true,
// //         intended_for: clinician_id,
// //       });
// //       console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

// //       if (sent) {
// //         notificationsSent++;
// //       }

// //       notificationResults.push({
// //         clinician_id,
// //         connected: isConnected,
// //         socket_id: clinicianSocketId,
// //         notification_sent: sent,
// //       });
// //     }

// //     // Get connection status AFTER processing
// //     const connectedUsersAfter = getConnectedUsers();
// //     console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

// //     res.status(201).json({
// //       ok: true,
// //       message: `Alert created successfully. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
// //       alert: transactionResult.newAlert,
// //       patient: patientDetails,
// //       notifications: {
// //         sent: notificationsSent,
// //         total: dr_ids.length,
// //         details: notificationResults,
// //       },
// //       connection_info: {
// //         before: connectedUsersBefore,
// //         after: connectedUsersAfter,
// //         total_connections: connectedUsersAfter.length,
// //       },
// //     });
// //   } catch (error) {
// //     console.error("❌ Error creating alert:", error);
// //     res.status(500).json({
// //       ok: false,
// //       message: "Server error creating alert",
// //       error: error.message,
// //     });
// //   }
// // });

// // New endpoint to check socket connections
// router.get("/connection-status", (req, res) => {
//   const connectedUsers = getConnectedUsers();

//   res.json({
//     ok: true,
//     connected_users: connectedUsers,
//     total_connections: connectedUsers.length,
//     timestamp: new Date().toISOString(),
//   });
// });

// // Original alert route (with auth)
// router.post("/", authRequired, async (req, res) => {
//   const { dr_ids, type, desc } = req.body;
//   const patient_id = req.user.id;

//   console.log("🚨 Alert creation request received:");
//   console.log("   Patient ID:", patient_id);
//   console.log("   Clinician IDs:", dr_ids);
//   console.log("   Alert Type:", type);
//   console.log("   Description:", desc);

//   // Validate input
//   if (
//     !dr_ids ||
//     !Array.isArray(dr_ids) ||
//     dr_ids.length === 0 ||
//     !type ||
//     !["high", "medium", "low"].includes(type)
//   ) {
//     return res.status(400).json({
//       ok: false,
//       message:
//         "Invalid request: dr_ids (non-empty array) and valid type required",
//     });
//   }

//   try {
//     // Verify all dr_ids exist and are clinicians
//     const validClinicians = await db("users")
//       .select("users.id", "users.name", "users.email", "role.role_type")
//       .join("role", "users.id", "role.user_id")
//       .whereIn("users.id", dr_ids)
//       .where("role.role_type", "clinician")
//       .where("users.is_active", true);

//     console.log("✅ Valid clinicians found:", validClinicians.length);

//     if (validClinicians.length !== dr_ids.length) {
//       return res.status(400).json({
//         ok: false,
//         message: "One or more clinician IDs are invalid or not clinicians",
//       });
//     }

//     // Get patient details for notification
//     const patientDetails = await db("users")
//       .select("id", "name", "email", "phoneNumber", "organization_id")
//       .where("id", patient_id)
//       .first();

//     console.log("👤 Patient details:", patientDetails);

//     // Start transaction to ensure atomicity
//     const result = await db.transaction(async (trx) => {
//       // Insert alert
//       const [alertId] = await trx("alerts")
//         .insert({
//           user_id: patient_id,
//           desc: desc || `Health alert with severity: ${type}`,
//           type,
//         })
//         .returning("id");

//       // Insert assignments for each clinician - UPDATED WITH READ STATUS
//       const assignments = dr_ids.map((clinician_id) => ({
//         alert_id: alertId,
//         doctor_id: clinician_id,
//         read_status: false,
//         read_at: null,
//       }));
//       await trx("alert_assignments").insert(assignments);

//       // Fetch the complete alert with patient details for response/notification
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

//     // Send WebSocket notifications to all clinicians
//     const io = getIO();
//     console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

//     let notificationsSent = 0;

//     // Send notifications to each clinician
//     for (const clinician_id of dr_ids) {
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
//           `   ❌ Clinician ${clinician_id} not connected; alert saved but not notified in real-time`
//         );
//       }
//     }

//     res.status(201).json({
//       ok: true,
//       message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
//       alert: result.newAlert,
//       patient: result.patientDetails,
//     });
//   } catch (error) {
//     console.error("Error creating alert:", error);
//     res.status(500).json({ ok: false, message: "Server error" });
//   }
// });
// // Get unread alerts count for notification badge
// router.get("/unread-count", authRequired, async (req, res) => {
//   const clinician_id = req.user.id;

//   try {
//     // Verify the user is a clinician
//     const clinicianRole = await db("role")
//       .where("user_id", clinician_id)
//       .andWhere("role_type", "clinician")
//       .first();

//     if (!clinicianRole) {
//       return res.status(403).json({
//         ok: false,
//         message: "Access denied. User is not a clinician",
//       });
//     }

//     const unreadCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .count("id as count")
//       .first();

//     res.json({
//       ok: true,
//       unread_count: parseInt(unreadCount?.count) || 0,
//     });
//   } catch (error) {
//     console.error("Error fetching unread count:", error);
//     res
//       .status(500)
//       .json({ ok: false, message: "Server error", error: error.message });
//   }
// });
// // Get all alerts for a clinician (with read status)
// router.get("/my-alerts", authRequired, async (req, res) => {
//   const clinician_id = req.user.id;

//   try {
//     // Verify the user is a clinician
//     const clinicianRole = await db("role")
//       .where("user_id", clinician_id)
//       .andWhere("role_type", "clinician")
//       .first();

//     if (!clinicianRole) {
//       return res.status(403).json({
//         ok: false,
//         message: "Access denied. User is not a clinician",
//       });
//     }

//     const alerts = await db("alert_assignments")
//       .select(
//         "alerts.id",
//         "alerts.user_id as patient_id",
//         "alerts.desc",
//         "alerts.type",
//         "alerts.created_at as alert_created_at",
//         "alerts.updated_at as alert_updated_at",
//         "alert_assignments.read_status",
//         "alert_assignments.read_at",
//         "alert_assignments.created_at as assigned_at",
//         "alert_assignments.id as assignment_id",
//         "patients.name as patient_name",
//         "patients.email as patient_email",
//         "patients.phoneNumber as patient_phone",
//         "patients.organization_id as patient_organization_id"
//       )
//       .join("alerts", "alert_assignments.alert_id", "alerts.id")
//       .join("users as patients", "alerts.user_id", "patients.id")
//       .where("alert_assignments.doctor_id", clinician_id)
//       .orderBy("alerts.created_at", "desc");

//     // Count unread alerts
//     const unreadCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .count("id as count")
//       .first();

//     res.json({
//       ok: true,
//       alerts,
//       unread_count: parseInt(unreadCount?.count) || 0,
//       total_alerts: alerts.length,
//     });
//   } catch (error) {
//     console.error("Error fetching alerts:", error);
//     res
//       .status(500)
//       .json({ ok: false, message: "Server error", error: error.message });
//   }
// });
// // Get only unread alerts for a clinician
// router.get("/my-alerts/unread", authRequired, async (req, res) => {
//   const clinician_id = req.user.id;

//   try {
//     // Verify the user is a clinician
//     const clinicianRole = await db("role")
//       .where("user_id", clinician_id)
//       .andWhere("role_type", "clinician")
//       .first();

//     if (!clinicianRole) {
//       return res.status(403).json({
//         ok: false,
//         message: "Access denied. User is not a clinician",
//       });
//     }

//     const unreadAlerts = await db("alert_assignments")
//       .select(
//         "alerts.id",
//         "alerts.user_id as patient_id",
//         "alerts.desc",
//         "alerts.type",
//         "alerts.created_at as alert_created_at",
//         "alerts.updated_at as alert_updated_at",
//         "alert_assignments.read_status",
//         "alert_assignments.read_at",
//         "alert_assignments.created_at as assigned_at",
//         "alert_assignments.id as assignment_id",
//         "patients.name as patient_name",
//         "patients.email as patient_email",
//         "patients.phoneNumber as patient_phone",
//         "patients.organization_id as patient_organization_id"
//       )
//       .join("alerts", "alert_assignments.alert_id", "alerts.id")
//       .join("users as patients", "alerts.user_id", "patients.id")
//       .where("alert_assignments.doctor_id", clinician_id)
//       .andWhere("alert_assignments.read_status", false)
//       .orderBy("alerts.created_at", "desc");

//     res.json({
//       ok: true,
//       alerts: unreadAlerts,
//       count: unreadAlerts.length,
//     });
//   } catch (error) {
//     console.error("Error fetching unread alerts:", error);
//     res
//       .status(500)
//       .json({ ok: false, message: "Server error", error: error.message });
//   }
// });
// // Mark a specific alert as read
// router.patch("/:alert_id/read", authRequired, async (req, res) => {
//   const clinician_id = req.user.id;
//   const { alert_id } = req.params;

//   try {
//     // Verify the alert assignment exists and belongs to this clinician
//     const assignment = await db("alert_assignments")
//       .where("alert_id", alert_id)
//       .andWhere("doctor_id", clinician_id)
//       .first();

//     if (!assignment) {
//       return res.status(404).json({
//         ok: false,
//         message: "Alert not found or you don't have permission to access it",
//       });
//     }

//     // If already read, return success
//     if (assignment.read_status) {
//       return res.json({
//         ok: true,
//         message: "Alert is already marked as read",
//       });
//     }

//     // Mark as read
//     await db("alert_assignments")
//       .where("alert_id", alert_id)
//       .andWhere("doctor_id", clinician_id)
//       .update({
//         read_status: true,
//         read_at: db.fn.now(),
//         updated_at: db.fn.now(),
//       });

//     // Get updated unread count
//     const unreadCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .count("id as count")
//       .first();

//     // Send WebSocket update for real-time badge update
//     const io = getIO();
//     const clinicianSocketId = userSockets.get(clinician_id.toString());
//     if (clinicianSocketId) {
//       io.to(clinicianSocketId).emit("alert_read", {
//         alert_id: alert_id,
//         unread_count: parseInt(unreadCount?.count) || 0,
//       });
//     }

//     res.json({
//       ok: true,
//       message: "Alert marked as read successfully",
//       unread_count: parseInt(unreadCount?.count) || 0,
//     });
//   } catch (error) {
//     console.error("Error marking alert as read:", error);
//     res
//       .status(500)
//       .json({ ok: false, message: "Server error", error: error.message });
//   }
// });
// // Mark all alerts as read for a clinician
// router.patch("/mark-all-read", authRequired, async (req, res) => {
//   const clinician_id = req.user.id;

//   try {
//     // Count unread alerts before update
//     const unreadCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .count("id as count")
//       .first();

//     const countToUpdate = parseInt(unreadCount?.count) || 0;

//     if (countToUpdate === 0) {
//       return res.json({
//         ok: true,
//         message: "No unread alerts to mark as read",
//         updated_count: 0,
//       });
//     }

//     // Mark all unread alerts as read
//     const updatedCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .update({
//         read_status: true,
//         read_at: db.fn.now(),
//         updated_at: db.fn.now(),
//       });

//     // Get updated unread count (should be 0)
//     const newUnreadCount = await db("alert_assignments")
//       .where("doctor_id", clinician_id)
//       .andWhere("read_status", false)
//       .count("id as count")
//       .first();

//     // Send WebSocket update
//     const io = getIO();
//     const clinicianSocketId = userSockets.get(clinician_id.toString());
//     if (clinicianSocketId) {
//       io.to(clinicianSocketId).emit("all_alerts_read", {
//         unread_count: 0,
//       });
//     }

//     res.json({
//       ok: true,
//       message: `Successfully marked ${updatedCount} alerts as read`,
//       updated_count: updatedCount,
//       unread_count: 0,
//     });
//   } catch (error) {
//     console.error("Error marking all alerts as read:", error);
//     res
//       .status(500)
//       .json({ ok: false, message: "Server error", error: error.message });
//   }
// });

// router.get("/alert-settings", authRequired, async (req, res) => {
//   console.log("getting the alert settings");
//   try {
//     const doctor_id = req.user.id;

//     // Check if user is a doctor/clinician - USING YOUR MYSQL CONNECTION
//     const [roleRows] = await db.query(
//       "SELECT role_type FROM role WHERE user_id = ?",
//       [doctor_id]
//     );

//     const role = roleRows[0]; // Get the first row
//     console.log("getting the dr setting .. dr role", role);

//     if (!role || !["doctor", "clinician"].includes(role.role_type)) {
//       console.log("no role or invalid role");
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Doctor role required.",
//       });
//     }

//     // Get doctor's settings - USING YOUR MYSQL CONNECTION
//     const [settingsRows] = await db.query(
//       "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
//       [doctor_id]
//     );

//     // If no settings exist, return defaults
//     if (!settingsRows || settingsRows.length === 0) {
//       const defaultSettings = {
//         systolic_high: 140,
//         systolic_low: 90,
//         diastolic_high: 90,
//         diastolic_low: 60,
//       };
//       return res.json({
//         success: true,
//         settings: defaultSettings,
//         isDefault: true,
//       });
//     }

//     const settings = settingsRows[0];
//     res.json({
//       success: true,
//       settings: settings,
//       isDefault: false,
//     });
//   } catch (error) {
//     console.error("Error fetching doctor alert settings:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// });
// router.patch("/alert-settings", authRequired, async (req, res) => {
//   try {
//     const doctor_id = req.user.id;
//     const { systolic_high, systolic_low, diastolic_high, diastolic_low } =
//       req.body;

//     // Validate doctor role
//     const [roleRows] = await db.query(
//       "SELECT role_type FROM role WHERE user_id = ?",
//       [doctor_id]
//     );

//     const role = roleRows[0];
//     if (!role || !["doctor", "clinician"].includes(role.role_type)) {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Doctor role required.",
//       });
//     }

//     // Validate input
//     const errors = [];

//     if (systolic_high && (systolic_high < 100 || systolic_high > 200)) {
//       errors.push("Systolic high must be between 100 and 200");
//     }

//     if (systolic_low && (systolic_low < 60 || systolic_low > 150)) {
//       errors.push("Systolic low must be between 60 and 150");
//     }

//     if (diastolic_high && (diastolic_high < 60 || diastolic_high > 130)) {
//       errors.push("Diastolic high must be between 60 and 130");
//     }

//     if (diastolic_low && (diastolic_low < 40 || diastolic_low > 100)) {
//       errors.push("Diastolic low must be between 40 and 100");
//     }

//     if (systolic_high && systolic_low && systolic_high <= systolic_low) {
//       errors.push("Systolic high must be greater than systolic low");
//     }

//     if (diastolic_high && diastolic_low && diastolic_high <= diastolic_low) {
//       errors.push("Diastolic high must be greater than diastolic low");
//     }

//     if (errors.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Validation failed",
//         errors: errors,
//       });
//     }

//     // Check if settings already exist
//     const [existingSettings] = await db.query(
//       "SELECT id FROM doctor_alert_settings WHERE doctor_id = ?",
//       [doctor_id]
//     );

//     let result;

//     if (existingSettings && existingSettings.length > 0) {
//       // Update existing settings
//       [result] = await db.query(
//         `UPDATE doctor_alert_settings
//          SET systolic_high = ?, systolic_low = ?, diastolic_high = ?, diastolic_low = ?, updated_at = NOW()
//          WHERE doctor_id = ?`,
//         [systolic_high, systolic_low, diastolic_high, diastolic_low, doctor_id]
//       );
//     } else {
//       // Insert new settings
//       [result] = await db.query(
//         `INSERT INTO doctor_alert_settings
//          (doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low)
//          VALUES (?, ?, ?, ?, ?)`,
//         [doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low]
//       );
//     }

//     // Get updated settings
//     const [updatedSettings] = await db.query(
//       "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
//       [doctor_id]
//     );

//     res.json({
//       success: true,
//       message:
//         existingSettings && existingSettings.length > 0
//           ? "Settings updated successfully"
//           : "Settings created successfully",
//       settings: updatedSettings[0],
//     });
//   } catch (error) {
//     console.error("Error updating doctor alert settings:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// });

// router.post("/test/bp-alert", async (req, res) => {
//   console.log("📥 Incoming test request to /test/bp-alert");

//   const { patient_id, devId, devType, systolic, diastolic, data } = req.body;

//   console.log("📦 Request Body:", req.body);

//   if (!patient_id || !devType || !systolic || !diastolic) {
//     return res.status(400).json({
//       success: false,
//       message:
//         "Missing required fields: patient_id, devType, systolic, diastolic are required",
//     });
//   }

//   const bpStatus = calculateBPStatus(systolic, diastolic);
//   console.log(`🩺 Calculated BP Status: ${bpStatus}`);

//   // Only trigger BP alert for abnormal readings
//   if (devType !== "bp" || bpStatus === "Normal") {
//     return res.status(200).json({
//       success: true,
//       message: `BP status is ${bpStatus}. No alert triggered.`,
//     });
//   }

//   console.log("🚨 BP Alert Condition Met:", bpStatus);

//   let connection;
//   try {
//     connection = await db.getConnection();

//     // 1️⃣ Get doctors assigned to the patient
//     const [assignedDoctors] = await connection.query(
//       "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
//       [patient_id]
//     );

//     if (!assignedDoctors.length) {
//       console.log("⚠️ No doctors assigned to patient");
//       return res.json({ ok: false, message: "No doctors assigned to patient" });
//     }

//     const doctor_ids = assignedDoctors.map((d) => d.doctor_id);
//     console.log("👨‍⚕️ Assigned Doctor IDs:", doctor_ids);

//     // 2️⃣ Validate doctors
//     const [validDoctors] = await connection.query(
//       `SELECT users.id, users.name, users.email, role.role_type
//        FROM users
//        JOIN role ON users.id = role.user_id
//        WHERE users.id IN (?)
//        AND role.role_type IN ('clinician', 'doctor')
//        AND users.is_active = true`,
//       [doctor_ids]
//     );

//     if (!validDoctors.length) {
//       console.log("❌ No valid doctors found");
//       return res.json({ ok: false, message: "No valid doctors found" });
//     }

//     // 3️⃣ Get patient details
//     const [patientRows] = await connection.query(
//       "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
//       [patient_id]
//     );
//     const patientDetails = patientRows[0];

//     if (!patientDetails) {
//       return res.json({ ok: false, message: "Patient not found" });
//     }

//     console.log("👤 Patient details:", patientDetails.name);

//     // 4️⃣ Create alert + assignments in a transaction
//     await connection.beginTransaction();

//     const alertType = `BP_${bpStatus.toUpperCase()}`;
//     const alertDesc = `Blood Pressure Alert: ${bpStatus} (${systolic}/${diastolic} mmHg)`;

//     const [alertResult] = await connection.query(
//       "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
//       [patient_id, alertDesc, alertType, new Date()]
//     );

//     const alertId = alertResult.insertId;
//     console.log("📝 Alert created with ID:", alertId);

//     // Insert assignments for each doctor
//     const assignmentValues = doctor_ids.map((doctor_id) => [
//       alertId,
//       doctor_id,
//       false,
//       null,
//       new Date(),
//       new Date(),
//     ]);

//     await connection.query(
//       `INSERT INTO alert_assignments
//        (alert_id, doctor_id, read_status, read_at, created_at, updated_at)
//        VALUES ?`,
//       [assignmentValues]
//     );

//     await connection.commit();

//     console.log("✅ Alert and assignments created successfully.");

//     // 5️⃣ Send notifications via WebSocket
//     const io = getIO();
//     const notifications = [];

//     for (const doctor_id of doctor_ids) {
//       const socketId = getUserSocketId(doctor_id);
//       const connected = isUserConnected(doctor_id);

//       const alertData = {
//         alert_id: alertId,
//         patient: patientDetails,
//         bp_reading: `${systolic}/${diastolic}`,
//         bp_status: bpStatus,
//         timestamp: new Date(),
//       };

//       if (connected && socketId) {
//         io.to(`user_${doctor_id}`).emit("new_alert", alertData);
//         io.to(socketId).emit("new_alert", alertData);
//         console.log(`📡 Alert sent to doctor ${doctor_id}`);
//       }

//       io.to("all_clinicians").emit("new_alert_broadcast", alertData);
//       notifications.push({ doctor_id, connected });
//     }

//     res.status(201).json({
//       success: true,
//       message: "BP Alert triggered successfully",
//       bpStatus,
//       alertId,
//       doctors: doctor_ids,
//       notifications,
//     });
//   } catch (err) {
//     console.error("❌ Error in /test/bp-alert:", err);
//     if (connection) await connection.rollback();
//     res.status(500).json({ success: false, message: err.message });
//   } finally {
//     if (connection) connection.release();
//   }
// });

// module.exports = router;
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { authRequired } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const twilioService = require("../services/twillio.service");

const {
  userSockets,
  getIO,
  getConnectedUsers,
  isUserConnected,
  getUserSocketId,
} = require("../socket/socketServer");

const router = express.Router();

// ✅ Helper to calculate BP status
const calculateBPStatus = (systolic, diastolic) => {
  const sys = parseInt(systolic);
  const dia = parseInt(diastolic);

  if (sys < 90 || dia < 60) return "Low";
  else if (sys <= 120 && dia <= 80) return "Normal";
  else if (sys > 120 || dia > 80) return "High";
  else return "Normal";
};

// Debug endpoint to check connected users
router.get("/debug-connected-users", (req, res) => {
  const connectedUsers = Array.from(userSockets.entries());
  console.log("🔍 DEBUG: Currently connected users:", connectedUsers);

  res.json({
    ok: true,
    connected_users: connectedUsers.map(([userId, socketId]) => ({
      user_id: userId,
      socket_id: socketId,
    })),
    total_connected: connectedUsers.length,
  });
});

// TEMPORARY TEST ROUTE - Remove this after testing
// router.post("/test-alert", async (req, res) => {
//   const { dr_ids, type, desc, patient_id = 21 } = req.body;

//   console.log("=".repeat(60));
//   console.log("🚨 TEST ALERT CREATION REQUEST");
//   console.log("=".repeat(60));
//   console.log("   Patient ID:", patient_id);
//   console.log("   Doctor IDs:", dr_ids);
//   console.log("   Alert Type:", type);
//   console.log("   Description:", desc);

//   // Validate input
//   if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
//     return res.status(400).json({
//       ok: false,
//       message: "Invalid request: dr_ids (non-empty array) and type required",
//     });
//   }

//   let connection;
//   try {
//     // Get connection status BEFORE processing
//     const connectedUsersBefore = getConnectedUsers();
//     console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

//     // Get database connection
//     connection = await db.getConnection();

//     // Verify clinicians exist and are active
//     const [validClinicians] = await connection.query(
//       `SELECT users.id, users.name, users.email, role.role_type
//        FROM users
//        JOIN role ON users.id = role.user_id
//        WHERE users.id IN (?)
//        AND role.role_type = 'clinician'
//        AND users.is_active = true`,
//       [dr_ids]
//     );

//     console.log("✅ Valid clinicians found:", validClinicians.length);

//     if (validClinicians.length === 0) {
//       return res.status(400).json({
//         ok: false,
//         message: "No valid clinicians found from the provided IDs",
//       });
//     }

//     // Get patient details
//     const [patientRows] = await connection.query(
//       "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
//       [patient_id]
//     );

//     const patientDetails = patientRows[0];

//     if (!patientDetails) {
//       return res.status(400).json({
//         ok: false,
//         message: "Patient not found",
//       });
//     }

//     console.log("👤 Patient details:", patientDetails);

//     // Start transaction
//     await connection.beginTransaction();

//     try {
//       // Insert alert
//       const [alertResult] = await connection.query(
//         "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
//         [
//           patient_id,
//           desc || `Health alert with severity: ${type}`,
//           type,
//           new Date(),
//         ]
//       );

//       const alertId = alertResult.insertId;
//       console.log("📝 Alert inserted with ID:", alertId);

//       // ✅ FIXED: Use correct column names for alert_assignments
//       const assignments = dr_ids.map((clinician_id) => [
//         alertId,
//         clinician_id,
//         false, // read_status
//         null, // read_at
//         new Date(), // created_at
//         new Date(), // updated_at
//       ]);

//       await connection.query(
//         `INSERT INTO alert_assignments (alert_id, doctor_id, read_status, read_at, created_at, updated_at) VALUES ?`,
//         [assignments]
//       );

//       console.log("✅ Alert assignments created for clinicians:", dr_ids);

//       // Fetch complete alert details
//       const [newAlertRows] = await connection.query(
//         `SELECT alerts.*,
//                 patients.name as patient_name,
//                 patients.email as patient_email,
//                 patients.phoneNumber as patient_phone,
//                 patients.organization_id as patient_organization_id
//          FROM alerts
//          LEFT JOIN users as patients ON alerts.user_id = patients.id
//          WHERE alerts.id = ?`,
//         [alertId]
//       );

//       const newAlert = newAlertRows[0];

//       await connection.commit();

//       // Send WebSocket notifications
//       const io = getIO();
//       console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

//       let notificationsSent = 0;
//       const notificationResults = [];

//       for (const clinician_id of dr_ids) {
//         const clinicianSocketId = getUserSocketId(clinician_id);
//         const isConnected = isUserConnected(clinician_id);

//         console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
//           socketId: clinicianSocketId,
//           isConnected: isConnected,
//           inUserSockets: userSockets.has(clinician_id.toString()),
//         });

//         // Get unread count
//         const [unreadCountRows] = await connection.query(
//           "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
//           [clinician_id]
//         );

//         const unreadCount = unreadCountRows[0].count;

//         const alertData = {
//           alert: {
//             ...newAlert,
//             read_status: false,
//             assignment_id: clinician_id,
//           },
//           patient: patientDetails,
//           unread_count: parseInt(unreadCount) || 0,
//           timestamp: new Date(),
//           server_time: new Date().toISOString(),
//         };

//         let sent = false;

//         // Try multiple methods to send alert
//         if (isConnected && clinicianSocketId) {
//           // Method 1: Send to user's personal room
//           io.to(`user_${clinician_id}`).emit("new_alert", alertData);
//           console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);
//           sent = true;

//           // Method 2: Send to specific socket
//           io.to(clinicianSocketId).emit("new_alert", alertData);
//           console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);
//         }

//         // Method 3: Broadcast to all clinicians room (fallback)
//         io.to("all_clinicians").emit("new_alert_broadcast", {
//           ...alertData,
//           broadcast: true,
//           intended_for: clinician_id,
//         });
//         console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

//         if (sent) {
//           notificationsSent++;
//         }

//         notificationResults.push({
//           clinician_id,
//           connected: isConnected,
//           socket_id: clinicianSocketId,
//           notification_sent: sent,
//         });
//       }

//       // Get connection status AFTER processing
//       const connectedUsersAfter = getConnectedUsers();
//       console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

//       res.status(201).json({
//         ok: true,
//         message: `Alert created successfully. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
//         alert: newAlert,
//         patient: patientDetails,
//         notifications: {
//           sent: notificationsSent,
//           total: dr_ids.length,
//           details: notificationResults,
//         },
//         connection_info: {
//           before: connectedUsersBefore,
//           after: connectedUsersAfter,
//           total_connections: connectedUsersAfter.length,
//         },
//       });
//     } catch (error) {
//       await connection.rollback();
//       throw error;
//     }
//   } catch (error) {
//     console.error("❌ Error creating alert:", error);
//     res.status(500).json({
//       ok: false,
//       message: "Server error creating alert",
//       error: error.message,
//       stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
//     });
//   } finally {
//     if (connection) connection.release();
//   }
// });
// router.post("/test-alert", async (req, res) => {
//   const { dr_ids, type, desc, patient_id = 14 } = req.body;

//   console.log("=".repeat(60));
//   console.log("🚨 TEST ALERT CREATION REQUEST");
//   console.log("=".repeat(60));
//   console.log("   Patient ID:", patient_id);
//   console.log("   Doctor IDs:", dr_ids);
//   console.log("   Alert Type:", type);
//   console.log("   Description:", desc);

//   // Validate input
//   if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
//     return res.status(400).json({
//       ok: false,
//       message: "Invalid request: dr_ids (non-empty array) and type required",
//     });
//   }

//   let connection;
//   try {
//     // Get connection status BEFORE processing
//     const connectedUsersBefore = getConnectedUsers();
//     console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

//     // Get database connection
//     connection = await db.getConnection();

//     // Get patient details first to get organization_id
//     const [patientRows] = await connection.query(
//       "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
//       [patient_id]
//     );

//     const patientDetails = patientRows[0];

//     if (!patientDetails) {
//       return res.status(400).json({
//         ok: false,
//         message: "Patient not found",
//       });
//     }

//     console.log("👤 Patient details:", patientDetails);

//     // Get organization admins
//     const [adminRows] = await connection.query(
//       `SELECT users.id, users.name, users.email
//        FROM users
//        JOIN role ON users.id = role.user_id
//        WHERE users.organization_id = ?
//        AND role.role_type = 'admin'
//        AND users.is_active = true`,
//       [patientDetails.organization_id]
//     );

//     const organizationAdmins = adminRows.map((admin) => admin.id);
//     console.log("👨‍💼 Organization admins found:", organizationAdmins);

//     // Combine doctor IDs and admin IDs (remove duplicates)
//     const allRecipientIds = [...new Set([...dr_ids, ...organizationAdmins])];
//     console.log("📨 All recipients (doctors + admins):", allRecipientIds);

//     // ✅ NEW: Get doctor details for the primary assigned doctor
//     // Use the FIRST doctor in dr_ids as the primary assigned doctor
//     const primaryDoctorId = dr_ids[0];
//     console.log("🎯 Primary assigned doctor ID:", primaryDoctorId);

//     const [doctorRows] = await connection.query(
//       `SELECT users.id, users.name, users.email, users.phoneNumber
//        FROM users
//        WHERE users.id = ? AND users.is_active = true`,
//       [primaryDoctorId]
//     );

//     const primaryDoctor = doctorRows[0];
//     console.log("👨‍⚕️ Primary doctor details:", primaryDoctor);

//     // Verify clinicians and admins exist and are active
//     const [validRecipients] = await connection.query(
//       `SELECT users.id, users.name, users.email, role.role_type
//        FROM users
//        JOIN role ON users.id = role.user_id
//        WHERE users.id IN (?)
//        AND role.role_type IN ('clinician', 'admin')
//        AND users.is_active = true`,
//       [allRecipientIds]
//     );

//     console.log("✅ Valid recipients found:", validRecipients.length);

//     if (validRecipients.length === 0) {
//       return res.status(400).json({
//         ok: false,
//         message: "No valid recipients found from the provided IDs",
//       });
//     }

//     // Start transaction
//     await connection.beginTransaction();

//     try {
//       // Insert alert
//       const [alertResult] = await connection.query(
//         "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
//         [
//           patient_id,
//           desc || `Health alert with severity: ${type}`,
//           type,
//           new Date(),
//         ]
//       );

//       const alertId = alertResult.insertId;
//       console.log("📝 Alert inserted with ID:", alertId);

//       // ✅ Create assignments for all recipients (doctors + admins)
//       const assignments = allRecipientIds.map((recipient_id) => [
//         alertId,
//         recipient_id,
//         false, // read_status
//         null, // read_at
//         new Date(), // created_at
//         new Date(), // updated_at
//       ]);

//       await connection.query(
//         `INSERT INTO alert_assignments (alert_id, doctor_id, read_status, read_at, created_at, updated_at) VALUES ?`,
//         [assignments]
//       );

//       console.log(
//         "✅ Alert assignments created for recipients:",
//         allRecipientIds
//       );

//       // Fetch complete alert details
//       const [newAlertRows] = await connection.query(
//         `SELECT alerts.*,
//                 patients.name as patient_name,
//                 patients.email as patient_email,
//                 patients.phoneNumber as patient_phone,
//                 patients.organization_id as patient_organization_id
//          FROM alerts
//          LEFT JOIN users as patients ON alerts.user_id = patients.id
//          WHERE alerts.id = ?`,
//         [alertId]
//       );

//       const newAlert = newAlertRows[0];

//       await connection.commit();

//       // Send WebSocket notifications
//       const io = getIO();
//       console.log(
//         "📡 Sending WebSocket notifications to recipients:",
//         allRecipientIds
//       );

//       let notificationsSent = 0;
//       const notificationResults = [];

//       for (const recipient_id of allRecipientIds) {
//         const recipientSocketId = getUserSocketId(recipient_id);
//         const isConnected = isUserConnected(recipient_id);

//         console.log(`   👨‍⚕️ Recipient ${recipient_id}:`, {
//           socketId: recipientSocketId,
//           isConnected: isConnected,
//           inUserSockets: userSockets.has(recipient_id.toString()),
//         });

//         // Get unread count
//         const [unreadCountRows] = await connection.query(
//           "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
//           [recipient_id]
//         );

//         const unreadCount = unreadCountRows[0].count;

//         // ✅ UPDATED: Include primary doctor information in alert data
//         const alertData = {
//           alert: {
//             ...newAlert,
//             read_status: false,
//             assignment_id: recipient_id,
//             // ✅ NEW: Include primary doctor assignment info for admins
//             primary_assigned_doctor_id: primaryDoctorId,
//             primary_assigned_doctor_name:
//               primaryDoctor?.name || "Unknown Doctor",
//             primary_assigned_doctor_email: primaryDoctor?.email || "N/A",
//           },
//           patient: patientDetails,
//           // ✅ NEW: Include primary doctor details separately
//           assigned_doctor: primaryDoctor
//             ? {
//                 id: primaryDoctor.id,
//                 name: primaryDoctor.name,
//                 email: primaryDoctor.email,
//                 phone: primaryDoctor.phoneNumber,
//               }
//             : null,
//           unread_count: parseInt(unreadCount) || 0,
//           timestamp: new Date(),
//           server_time: new Date().toISOString(),
//           is_emergency: type === "critical" || type === "emergency",
//           // ✅ NEW: Add recipient type to distinguish between doctor and admin alerts
//           recipient_type: validRecipients.find((r) => r.id === recipient_id)
//             ?.role_type,
//         };

//         let sent = false;

//         // Try multiple methods to send alert
//         if (isConnected && recipientSocketId) {
//           // Method 1: Send to user's personal room
//           io.to(`user_${recipient_id}`).emit("new_alert", alertData);
//           console.log(`   ✅ Method 1: Sent to room user_${recipient_id}`);
//           sent = true;

//           // Method 2: Send to specific socket
//           io.to(recipientSocketId).emit("new_alert", alertData);
//           console.log(`   ✅ Method 2: Sent to socket ${recipientSocketId}`);
//         }

//         // Method 3: Broadcast to all clinicians room (fallback)
//         io.to("all_clinicians").emit("new_alert_broadcast", {
//           ...alertData,
//           broadcast: true,
//           intended_for: recipient_id,
//         });
//         console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

//         // Method 4: Send to admins room - WITH ENHANCED DATA
//         if (organizationAdmins.includes(recipient_id)) {
//           const adminAlertData = {
//             ...alertData,
//             is_admin_alert: true,
//             // ✅ ENHANCED: Include clear assignment information for admins
//             doctor_assignment: {
//               doctor_id: primaryDoctorId,
//               doctor_name: primaryDoctor?.name || "Unknown Doctor",
//               doctor_email: primaryDoctor?.email || "N/A",
//               patient_id: patient_id,
//               patient_name: patientDetails.name,
//               alert_type: type,
//               alert_description: desc,
//             },
//           };

//           io.to("all_admins").emit("admin_alert", adminAlertData);
//           console.log(
//             `   ✅ Method 4: Sent to admins room for admin ${recipient_id}`
//           );
//         }

//         if (sent) {
//           notificationsSent++;
//         }

//         notificationResults.push({
//           recipient_id,
//           role: validRecipients.find((r) => r.id === recipient_id)?.role_type,
//           connected: isConnected,
//           socket_id: recipientSocketId,
//           notification_sent: sent,
//         });
//       }

//       // Get connection status AFTER processing
//       const connectedUsersAfter = getConnectedUsers();
//       console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

//       res.status(201).json({
//         ok: true,
//         message: `Alert created successfully. Notifications sent to ${notificationsSent}/${allRecipientIds.length} recipients`,
//         alert: newAlert,
//         patient: patientDetails,
//         // ✅ NEW: Include primary doctor assignment in response
//         primary_assigned_doctor: primaryDoctor,
//         recipients: {
//           doctors: dr_ids,
//           primary_doctor: primaryDoctorId,
//           admins: organizationAdmins,
//           total: allRecipientIds.length,
//         },
//         notifications: {
//           sent: notificationsSent,
//           total: allRecipientIds.length,
//           details: notificationResults,
//         },
//         connection_info: {
//           before: connectedUsersBefore,
//           after: connectedUsersAfter,
//           total_connections: connectedUsersAfter.length,
//         },
//       });
//     } catch (error) {
//       await connection.rollback();
//       throw error;
//     }
//   } catch (error) {
//     console.error("❌ Error creating alert:", error);
//     res.status(500).json({
//       ok: false,
//       message: "Server error creating alert",
//       error: error.message,
//       stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
//     });
//   } finally {
//     if (connection) connection.release();
//   }
// });
router.post("/test-alert", async (req, res) => {
  const { dr_ids, type, desc, patient_id = 14 } = req.body;

  console.log("=".repeat(60));
  console.log("🚨 TEST ALERT CREATION REQUEST");
  console.log("=".repeat(60));
  console.log("   Patient ID:", patient_id);
  console.log("   Doctor IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  // Validate input
  if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
    return res.status(400).json({
      ok: false,
      message: "Invalid request: dr_ids (non-empty array) and type required",
    });
  }

  let connection;
  try {
    // Get connection status BEFORE processing
    const connectedUsersBefore = getConnectedUsers();
    console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

    // Get database connection
    connection = await db.getConnection();

    // Get patient details first to get organization_id
    const [patientRows] = await connection.query(
      "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
      [patient_id]
    );

    const patientDetails = patientRows[0];

    if (!patientDetails) {
      return res.status(400).json({
        ok: false,
        message: "Patient not found",
      });
    }

    console.log("👤 Patient details:", patientDetails);

    // Get organization details for SMS message
    const [orgRows] = await connection.query(
      "SELECT id, name FROM organizations WHERE id = ?",
      [patientDetails.organization_id]
    );
    const organization = orgRows[0];
    console.log("🏢 Organization details:", organization);

    // Get organization admins with phone numbers
    const [adminRows] = await connection.query(
      `SELECT users.id, users.name, users.email, users.phoneNumber 
       FROM users 
       JOIN role ON users.id = role.user_id 
       WHERE users.organization_id = ? 
       AND role.role_type = 'admin' 
       AND users.is_active = true`,
      [patientDetails.organization_id]
    );

    const organizationAdmins = adminRows;
    console.log("👨‍💼 Organization admins found:", organizationAdmins.length);

    // Get ALL clinician details (not just IDs)
    const [clinicianRows] = await connection.query(
      `SELECT users.id, users.name, users.email, users.phoneNumber 
       FROM users 
       JOIN role ON users.id = role.user_id 
       WHERE users.id IN (?) 
       AND role.role_type = 'clinician'
       AND users.is_active = true`,
      [dr_ids]
    );

    console.log("👨‍⚕️ Clinicians found:", clinicianRows.length);

    // Combine clinicians and admins for notifications
    const allRecipients = [...clinicianRows, ...organizationAdmins];
    console.log(
      "📨 All recipients (clinicians + admins):",
      allRecipients.length
    );

    // Get primary doctor details
    const primaryDoctorId = dr_ids[0];
    const primaryDoctor = clinicianRows.find(
      (doc) => doc.id === primaryDoctorId
    );
    console.log("🎯 Primary assigned doctor:", primaryDoctor);

    // Verify we have valid recipients
    if (allRecipients.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No valid recipients found from the provided IDs",
      });
    }

    // Start transaction
    await connection.beginTransaction();

    try {
      // Insert alert
      const [alertResult] = await connection.query(
        "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
        [
          patient_id,
          desc || `Health alert with severity: ${type}`,
          type,
          new Date(),
        ]
      );

      const alertId = alertResult.insertId;
      console.log("📝 Alert inserted with ID:", alertId);

      // Create assignments for all recipients
      const allRecipientIds = allRecipients.map((r) => r.id);
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

      console.log(
        "✅ Alert assignments created for recipients:",
        allRecipientIds
      );

      // Fetch complete alert details
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

      // ✅ SEND SMS ALERTS TO ALL RECIPIENTS
      console.log("=".repeat(50));
      console.log("📱 STARTING SMS NOTIFICATIONS");
      console.log("=".repeat(50));

      const smsResults = [];
      const smsPromises = [];

      for (const recipient of allRecipients) {
        // Only send SMS if recipient has a phone number
        if (recipient.phoneNumber) {
          const formattedPhone = twilioService.formatPhoneNumber(
            recipient.phoneNumber
          );

          if (formattedPhone) {
            // Generate appropriate message based on recipient role
            const isAdmin = organizationAdmins.some(
              (admin) => admin.id === recipient.id
            );
            const rolePrefix = isAdmin ? "[ADMIN] " : "";

            const smsMessage = twilioService.generateAlertMessage(
              type,
              patientDetails.name,
              desc || `Health alert - ${type} priority`,
              organization?.name
            );

            const fullMessage = `${rolePrefix}${smsMessage}`;

            console.log(
              `   📲 Sending SMS to ${recipient.name} (${formattedPhone})`
            );

            // Create SMS promise
            const smsPromise = twilioService
              .sendSMS(formattedPhone, fullMessage)
              .then((smsResult) => ({
                recipient_id: recipient.id,
                recipient_name: recipient.name,
                phone: formattedPhone,
                role: isAdmin ? "admin" : "clinician",
                sms_success: smsResult.success,
                message_id: smsResult.messageId,
                error: smsResult.error,
              }));

            smsPromises.push(smsPromise);
          } else {
            console.log(
              `   ⚠️  Invalid phone number for ${recipient.name}: ${recipient.phoneNumber}`
            );
            smsResults.push({
              recipient_id: recipient.id,
              recipient_name: recipient.name,
              phone: recipient.phoneNumber,
              role: organizationAdmins.some(
                (admin) => admin.id === recipient.id
              )
                ? "admin"
                : "clinician",
              sms_success: false,
              error: "Invalid phone number format",
            });
          }
        } else {
          console.log(`   ⚠️  No phone number for ${recipient.name}`);
          smsResults.push({
            recipient_id: recipient.id,
            recipient_name: recipient.name,
            phone: null,
            role: organizationAdmins.some((admin) => admin.id === recipient.id)
              ? "admin"
              : "clinician",
            sms_success: false,
            error: "No phone number available",
          });
        }
      }

      // Wait for all SMS promises to complete
      const smsPromiseResults = await Promise.all(smsPromises);
      smsResults.push(...smsPromiseResults);

      console.log("✅ SMS notifications completed");

      // Send WebSocket notifications
      const io = getIO();
      console.log("=".repeat(50));
      console.log("📡 SENDING WEBSOCKET NOTIFICATIONS");
      console.log("=".repeat(50));

      let notificationsSent = 0;
      const notificationResults = [];

      for (const recipient_id of allRecipientIds) {
        const recipientSocketId = getUserSocketId(recipient_id);
        const isConnected = isUserConnected(recipient_id);

        console.log(`   👨‍⚕️ Recipient ${recipient_id}:`, {
          socketId: recipientSocketId,
          isConnected: isConnected,
          inUserSockets: userSockets.has(recipient_id.toString()),
        });

        // Get unread count
        const [unreadCountRows] = await connection.query(
          "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
          [recipient_id]
        );

        const unreadCount = unreadCountRows[0].count;

        // Include primary doctor information in alert data
        const alertData = {
          alert: {
            ...newAlert,
            read_status: false,
            assignment_id: recipient_id,
            primary_assigned_doctor_id: primaryDoctorId,
            primary_assigned_doctor_name:
              primaryDoctor?.name || "Unknown Doctor",
            primary_assigned_doctor_email: primaryDoctor?.email || "N/A",
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
          is_emergency: type === "critical" || type === "emergency",
          recipient_type:
            allRecipients.find((r) => r.id === recipient_id)?.role_type ||
            "clinician",
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

        // Method 3: Broadcast to all clinicians room (fallback)
        io.to("all_clinicians").emit("new_alert_broadcast", {
          ...alertData,
          broadcast: true,
          intended_for: recipient_id,
        });
        console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

        // Method 4: Send to admins room - WITH ENHANCED DATA
        if (organizationAdmins.some((admin) => admin.id === recipient_id)) {
          const adminAlertData = {
            ...alertData,
            is_admin_alert: true,
            doctor_assignment: {
              doctor_id: primaryDoctorId,
              doctor_name: primaryDoctor?.name || "Unknown Doctor",
              doctor_email: primaryDoctor?.email || "N/A",
              patient_id: patient_id,
              patient_name: patientDetails.name,
              alert_type: type,
              alert_description: desc,
            },
          };

          io.to("all_admins").emit("admin_alert", adminAlertData);
          console.log(
            `   ✅ Method 4: Sent to admins room for admin ${recipient_id}`
          );
        }

        if (sent) {
          notificationsSent++;
        }

        notificationResults.push({
          recipient_id,
          role:
            allRecipients.find((r) => r.id === recipient_id)?.role_type ||
            "clinician",
          connected: isConnected,
          socket_id: recipientSocketId,
          notification_sent: sent,
        });
      }

      console.log("✅ WebSocket notifications completed");

      // Get connection status AFTER processing
      const connectedUsersAfter = getConnectedUsers();
      console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

      // Calculate SMS success stats
      const successfulSMS = smsResults.filter((r) => r.sms_success).length;
      const totalSMSAttempts = smsResults.length;

      console.log("=".repeat(60));
      console.log("🎯 ALERT CREATION SUMMARY");
      console.log("=".repeat(60));
      console.log(
        `   WebSocket: ${notificationsSent}/${allRecipientIds.length} recipients`
      );
      console.log(`   SMS: ${successfulSMS}/${totalSMSAttempts} recipients`);
      console.log(`   Total recipients: ${allRecipients.length}`);
      console.log("=".repeat(60));

      res.status(201).json({
        ok: true,
        message: `Alert created successfully. WebSocket: ${notificationsSent}/${allRecipientIds.length} recipients. SMS: ${successfulSMS}/${totalSMSAttempts} recipients.`,
        alert: newAlert,
        patient: patientDetails,
        primary_assigned_doctor: primaryDoctor,
        organization: organization,
        recipients: {
          clinicians: clinicianRows,
          admins: organizationAdmins,
          total: allRecipients.length,
        },
        notifications: {
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
        },
        connection_info: {
          before: connectedUsersBefore,
          after: connectedUsersAfter,
          total_connections: connectedUsersAfter.length,
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    console.error("❌ Error creating alert:", error);
    res.status(500).json({
      ok: false,
      message: "Server error creating alert",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    if (connection) connection.release();
  }
});
// New endpoint to check socket connections
router.get("/connection-status", (req, res) => {
  const connectedUsers = getConnectedUsers();

  res.json({
    ok: true,
    connected_users: connectedUsers,
    total_connections: connectedUsers.length,
    timestamp: new Date().toISOString(),
  });
});

// Original alert route (with auth)
router.post("/", authRequired, async (req, res) => {
  const { dr_ids, type, desc } = req.body;
  const patient_id = req.user.id;

  console.log("🚨 Alert creation request received:");
  console.log("   Patient ID:", patient_id);
  console.log("   Clinician IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  // Validate input
  if (
    !dr_ids ||
    !Array.isArray(dr_ids) ||
    dr_ids.length === 0 ||
    !type ||
    !["high", "medium", "low"].includes(type)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        "Invalid request: dr_ids (non-empty array) and valid type required",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // Verify all dr_ids exist and are clinicians
    const [validClinicians] = await connection.query(
      `SELECT users.id, users.name, users.email, role.role_type 
       FROM users 
       JOIN role ON users.id = role.user_id 
       WHERE users.id IN (?) 
       AND role.role_type = 'clinician' 
       AND users.is_active = true`,
      [dr_ids]
    );

    console.log("✅ Valid clinicians found:", validClinicians.length);

    if (validClinicians.length !== dr_ids.length) {
      return res.status(400).json({
        ok: false,
        message: "One or more clinician IDs are invalid or not clinicians",
      });
    }

    // Get patient details for notification
    const [patientRows] = await connection.query(
      "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
      [patient_id]
    );

    const patientDetails = patientRows[0];

    console.log("👤 Patient details:", patientDetails);

    // Start transaction
    await connection.beginTransaction();

    try {
      // Insert alert
      const [alertResult] = await connection.query(
        "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
        [
          patient_id,
          desc || `Health alert with severity: ${type}`,
          type,
          new Date(),
        ]
      );

      const alertId = alertResult.insertId;

      // Insert assignments for each clinician
      const assignments = dr_ids.map((clinician_id) => [
        alertId,
        clinician_id,
        false, // read_status
        null, // read_at
        new Date(), // created_at
      ]);

      await connection.query(
        `INSERT INTO alert_assignments (alert_id, doctor_id, read_status, read_at, created_at) VALUES ?`,
        [assignments]
      );

      // Fetch the complete alert with patient details
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

      // Send WebSocket notifications to all clinicians
      const io = getIO();
      console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

      let notificationsSent = 0;

      // Send notifications to each clinician
      for (const clinician_id of dr_ids) {
        const clinicianSocketId = userSockets.get(clinician_id.toString());
        if (clinicianSocketId) {
          // Get updated unread count for this clinician
          const [unreadCountRows] = await connection.query(
            "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
            [clinician_id]
          );

          const unreadCount = unreadCountRows[0].count;

          io.to(clinicianSocketId).emit("new_alert", {
            alert: {
              ...newAlert,
              read_status: false,
              assignment_id: clinician_id,
            },
            patient: {
              id: patientDetails.id,
              name: patientDetails.name,
              email: patientDetails.email,
              phoneNumber: patientDetails.phoneNumber,
              organization_id: patientDetails.organization_id,
            },
            unread_count: parseInt(unreadCount) || 0,
            timestamp: new Date(),
          });
          console.log(`   ✅ Notification sent to clinician ${clinician_id}`);
          notificationsSent++;
        } else {
          console.log(
            `   ❌ Clinician ${clinician_id} not connected; alert saved but not notified in real-time`
          );
        }
      }

      res.status(201).json({
        ok: true,
        message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
        alert: newAlert,
        patient: patientDetails,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error creating alert:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
});

// Get unread alerts count for notification badge
router.get("/unread-count", authRequired, resolveOrgScope, async (req, res) => {
  const clinician_id = req.user.id;

  let connection;
  try {
    connection = await db.getConnection();

    // Super-admin: unread count across the whole selected organization
    // (every alert whose patient belongs to req.orgScope).
    if (req.user.role_type === "super-admin") {
      const [orgUnreadRows] = await connection.query(
        `SELECT COUNT(DISTINCT aa.id) as count
           FROM alert_assignments aa
           JOIN alerts a ON aa.alert_id = a.id
           JOIN users p ON a.user_id = p.id
          WHERE p.organization_id = ? AND aa.read_status = false`,
        [req.orgScope]
      );
      return res.json({
        ok: true,
        unread_count: parseInt(orgUnreadRows[0].count) || 0,
      });
    }

    // Verify the user is a clinician
    const [roleRows] = await connection.query(
      "SELECT role_type FROM role WHERE user_id = ? AND role_type = 'clinician'",
      [clinician_id]
    );

    if (roleRows.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    res.json({
      ok: true,
      unread_count: parseInt(unreadCountRows[0].count) || 0,
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get all alerts for a clinician (with read status)
router.get("/my-alerts", authRequired, resolveOrgScope, async (req, res) => {
  const clinician_id = req.user.id;

  let connection;
  try {
    connection = await db.getConnection();

    // Super-admin: every alert for patients in the selected organization,
    // regardless of which clinician the alert was assigned to.
    if (req.user.role_type === "super-admin") {
      const [orgAlerts] = await connection.query(
        `SELECT alerts.id,
                alerts.user_id as patient_id,
                alerts.desc,
                alerts.type,
                alerts.created_at as alert_created_at,
                alerts.updated_at as alert_updated_at,
                alert_assignments.read_status,
                alert_assignments.read_at,
                alert_assignments.created_at as assigned_at,
                alert_assignments.id as assignment_id,
                alert_assignments.doctor_id,
                patients.name as patient_name,
                patients.email as patient_email,
                patients.phoneNumber as patient_phone,
                patients.organization_id as patient_organization_id
         FROM alert_assignments
         JOIN alerts ON alert_assignments.alert_id = alerts.id
         JOIN users as patients ON alerts.user_id = patients.id
         WHERE patients.organization_id = ?
         ORDER BY alerts.created_at DESC`,
        [req.orgScope]
      );

      const [orgUnreadRows] = await connection.query(
        `SELECT COUNT(DISTINCT aa.id) as count
           FROM alert_assignments aa
           JOIN alerts a ON aa.alert_id = a.id
           JOIN users p ON a.user_id = p.id
          WHERE p.organization_id = ? AND aa.read_status = false`,
        [req.orgScope]
      );

      return res.json({
        ok: true,
        alerts: orgAlerts,
        unread_count: parseInt(orgUnreadRows[0].count) || 0,
        total_alerts: orgAlerts.length,
      });
    }

    // Verify the user is a clinician
    const [roleRows] = await connection.query(
      "SELECT role_type FROM role WHERE user_id = ? AND role_type = 'clinician'",
      [clinician_id]
    );

    if (roleRows.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const [alerts] = await connection.query(
      `SELECT alerts.id,
              alerts.user_id as patient_id,
              alerts.desc,
              alerts.type,
              alerts.created_at as alert_created_at,
              alerts.updated_at as alert_updated_at,
              alert_assignments.read_status,
              alert_assignments.read_at,
              alert_assignments.created_at as assigned_at,
              alert_assignments.id as assignment_id,
              patients.name as patient_name,
              patients.email as patient_email,
              patients.phoneNumber as patient_phone,
              patients.organization_id as patient_organization_id
       FROM alert_assignments
       JOIN alerts ON alert_assignments.alert_id = alerts.id
       JOIN users as patients ON alerts.user_id = patients.id
       WHERE alert_assignments.doctor_id = ?
       ORDER BY alerts.created_at DESC`,
      [clinician_id]
    );

    // Count unread alerts
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    res.json({
      ok: true,
      alerts,
      unread_count: parseInt(unreadCountRows[0].count) || 0,
      total_alerts: alerts.length,
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get only unread alerts for a clinician
router.get("/my-alerts/unread", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  let connection;
  try {
    connection = await db.getConnection();

    // Verify the user is a clinician
    const [roleRows] = await connection.query(
      "SELECT role_type FROM role WHERE user_id = ? AND role_type = 'clinician'",
      [clinician_id]
    );

    if (roleRows.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const [unreadAlerts] = await connection.query(
      `SELECT alerts.id,
              alerts.user_id as patient_id,
              alerts.desc,
              alerts.type,
              alerts.created_at as alert_created_at,
              alerts.updated_at as alert_updated_at,
              alert_assignments.read_status,
              alert_assignments.read_at,
              alert_assignments.created_at as assigned_at,
              alert_assignments.id as assignment_id,
              patients.name as patient_name,
              patients.email as patient_email,
              patients.phoneNumber as patient_phone,
              patients.organization_id as patient_organization_id
       FROM alert_assignments
       JOIN alerts ON alert_assignments.alert_id = alerts.id
       JOIN users as patients ON alerts.user_id = patients.id
       WHERE alert_assignments.doctor_id = ? 
       AND alert_assignments.read_status = false
       ORDER BY alerts.created_at DESC`,
      [clinician_id]
    );

    res.json({
      ok: true,
      alerts: unreadAlerts,
      count: unreadAlerts.length,
    });
  } catch (error) {
    console.error("Error fetching unread alerts:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Mark a specific alert as read
router.patch("/:alert_id/read", authRequired, async (req, res) => {
  const clinician_id = req.user.id;
  const { alert_id } = req.params;

  let connection;
  try {
    connection = await db.getConnection();

    // Verify the alert assignment exists and belongs to this clinician
    const [assignmentRows] = await connection.query(
      "SELECT * FROM alert_assignments WHERE alert_id = ? AND doctor_id = ?",
      [alert_id, clinician_id]
    );

    if (assignmentRows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Alert not found or you don't have permission to access it",
      });
    }

    const assignment = assignmentRows[0];

    // If already read, return success
    if (assignment.read_status) {
      return res.json({
        ok: true,
        message: "Alert is already marked as read",
      });
    }

    // Mark as read
    await connection.query(
      "UPDATE alert_assignments SET read_status = true, read_at = NOW(), updated_at = NOW() WHERE alert_id = ? AND doctor_id = ?",
      [alert_id, clinician_id]
    );

    // Get updated unread count
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    const unreadCount = parseInt(unreadCountRows[0].count) || 0;

    // Send WebSocket update for real-time badge update
    const io = getIO();
    const clinicianSocketId = userSockets.get(clinician_id.toString());
    if (clinicianSocketId) {
      io.to(clinicianSocketId).emit("alert_read", {
        alert_id: alert_id,
        unread_count: unreadCount,
      });
    }

    res.json({
      ok: true,
      message: "Alert marked as read successfully",
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("Error marking alert as read:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Mark all alerts as read for a clinician
router.patch("/mark-all-read", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  let connection;
  try {
    connection = await db.getConnection();

    // Count unread alerts before update
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    const countToUpdate = parseInt(unreadCountRows[0].count) || 0;

    if (countToUpdate === 0) {
      return res.json({
        ok: true,
        message: "No unread alerts to mark as read",
        updated_count: 0,
      });
    }

    // Mark all unread alerts as read
    const [updateResult] = await connection.query(
      "UPDATE alert_assignments SET read_status = true, read_at = NOW(), updated_at = NOW() WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    const updatedCount = updateResult.affectedRows;

    // Get updated unread count (should be 0)
    const [newUnreadCountRows] = await connection.query(
      "SELECT COUNT(id) as count FROM alert_assignments WHERE doctor_id = ? AND read_status = false",
      [clinician_id]
    );

    const newUnreadCount = parseInt(newUnreadCountRows[0].count) || 0;

    // Send WebSocket update
    const io = getIO();
    const clinicianSocketId = userSockets.get(clinician_id.toString());
    if (clinicianSocketId) {
      io.to(clinicianSocketId).emit("all_alerts_read", {
        unread_count: 0,
      });
    }

    res.json({
      ok: true,
      message: `Successfully marked ${updatedCount} alerts as read`,
      updated_count: updatedCount,
      unread_count: 0,
    });
  } catch (error) {
    console.error("Error marking all alerts as read:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Alert settings routes (already using db.query)
router.get("/alert-settings", authRequired, async (req, res) => {
  console.log("getting the alert settings");
  try {
    const doctor_id = req.user.id;

    // Check if user is a doctor/clinician
    const [roleRows] = await db.query(
      "SELECT role_type FROM role WHERE user_id = ?",
      [doctor_id]
    );

    const role = roleRows[0];
    console.log("getting the dr setting .. dr role", role);

    if (!role || !["doctor", "clinician"].includes(role.role_type)) {
      console.log("no role or invalid role");
      return res.status(403).json({
        success: false,
        message: "Access denied. Doctor role required.",
      });
    }

    // Get doctor's settings
    const [settingsRows] = await db.query(
      "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    // If no settings exist, return defaults
    if (!settingsRows || settingsRows.length === 0) {
      const defaultSettings = {
        systolic_high: 140,
        systolic_low: 90,
        diastolic_high: 90,
        diastolic_low: 60,
      };
      return res.json({
        success: true,
        settings: defaultSettings,
        isDefault: true,
      });
    }

    const settings = settingsRows[0];
    res.json({
      success: true,
      settings: settings,
      isDefault: false,
    });
  } catch (error) {
    console.error("Error fetching doctor alert settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

router.patch("/alert-settings", authRequired, async (req, res) => {
  try {
    const doctor_id = req.user.id;
    const { systolic_high, systolic_low, diastolic_high, diastolic_low } =
      req.body;

    // Validate doctor role
    const [roleRows] = await db.query(
      "SELECT role_type FROM role WHERE user_id = ?",
      [doctor_id]
    );

    const role = roleRows[0];
    if (!role || !["doctor", "clinician"].includes(role.role_type)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Doctor role required.",
      });
    }

    // Validate input (same validation logic as before)
    const errors = [];

    if (systolic_high && (systolic_high < 100 || systolic_high > 200)) {
      errors.push("Systolic high must be between 100 and 200");
    }

    if (systolic_low && (systolic_low < 60 || systolic_low > 150)) {
      errors.push("Systolic low must be between 60 and 150");
    }

    if (diastolic_high && (diastolic_high < 60 || diastolic_high > 130)) {
      errors.push("Diastolic high must be between 60 and 130");
    }

    if (diastolic_low && (diastolic_low < 40 || diastolic_low > 100)) {
      errors.push("Diastolic low must be between 40 and 100");
    }

    if (systolic_high && systolic_low && systolic_high <= systolic_low) {
      errors.push("Systolic high must be greater than systolic low");
    }

    if (diastolic_high && diastolic_low && diastolic_high <= diastolic_low) {
      errors.push("Diastolic high must be greater than diastolic low");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    // Check if settings already exist
    const [existingSettings] = await db.query(
      "SELECT id FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    let result;

    if (existingSettings && existingSettings.length > 0) {
      // Update existing settings
      [result] = await db.query(
        `UPDATE doctor_alert_settings 
         SET systolic_high = ?, systolic_low = ?, diastolic_high = ?, diastolic_low = ?, updated_at = NOW()
         WHERE doctor_id = ?`,
        [systolic_high, systolic_low, diastolic_high, diastolic_low, doctor_id]
      );
    } else {
      // Insert new settings
      [result] = await db.query(
        `INSERT INTO doctor_alert_settings 
         (doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low) 
         VALUES (?, ?, ?, ?, ?)`,
        [doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low]
      );
    }

    // Get updated settings
    const [updatedSettings] = await db.query(
      "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    res.json({
      success: true,
      message:
        existingSettings && existingSettings.length > 0
          ? "Settings updated successfully"
          : "Settings created successfully",
      settings: updatedSettings[0],
    });
  } catch (error) {
    console.error("Error updating doctor alert settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// BP Alert test route (already using db.query)
router.post("/test/bp-alert", async (req, res) => {
  console.log("📥 Incoming test request to /test/bp-alert");

  const { patient_id, devId, devType, systolic, diastolic, data } = req.body;

  console.log("📦 Request Body:", req.body);

  if (!patient_id || !devType || !systolic || !diastolic) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields: patient_id, devType, systolic, diastolic are required",
    });
  }

  const bpStatus = calculateBPStatus(systolic, diastolic);
  console.log(`🩺 Calculated BP Status: ${bpStatus}`);

  // Only trigger BP alert for abnormal readings
  if (devType !== "bp" || bpStatus === "Normal") {
    return res.status(200).json({
      success: true,
      message: `BP status is ${bpStatus}. No alert triggered.`,
    });
  }

  console.log("🚨 BP Alert Condition Met:", bpStatus);

  let connection;
  try {
    connection = await db.getConnection();

    // 1️⃣ Get doctors assigned to the patient
    const [assignedDoctors] = await connection.query(
      "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
      [patient_id]
    );

    if (!assignedDoctors.length) {
      console.log("⚠️ No doctors assigned to patient");
      return res.json({ ok: false, message: "No doctors assigned to patient" });
    }

    const doctor_ids = assignedDoctors.map((d) => d.doctor_id);
    console.log("👨‍⚕️ Assigned Doctor IDs:", doctor_ids);

    // 2️⃣ Validate doctors
    const [validDoctors] = await connection.query(
      `SELECT users.id, users.name, users.email, role.role_type
       FROM users
       JOIN role ON users.id = role.user_id
       WHERE users.id IN (?) 
       AND role.role_type IN ('clinician', 'doctor') 
       AND users.is_active = true`,
      [doctor_ids]
    );

    if (!validDoctors.length) {
      console.log("❌ No valid doctors found");
      return res.json({ ok: false, message: "No valid doctors found" });
    }

    // 3️⃣ Get patient details
    const [patientRows] = await connection.query(
      "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
      [patient_id]
    );
    const patientDetails = patientRows[0];

    if (!patientDetails) {
      return res.json({ ok: false, message: "Patient not found" });
    }

    console.log("👤 Patient details:", patientDetails.name);

    // 4️⃣ Create alert + assignments in a transaction
    await connection.beginTransaction();

    const alertType = `BP_${bpStatus.toUpperCase()}`;
    const alertDesc = `Blood Pressure Alert: ${bpStatus} (${systolic}/${diastolic} mmHg)`;

    const [alertResult] = await connection.query(
      "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
      [patient_id, alertDesc, alertType, new Date()]
    );

    const alertId = alertResult.insertId;
    console.log("📝 Alert created with ID:", alertId);

    // Insert assignments for each doctor
    const assignmentValues = doctor_ids.map((doctor_id) => [
      alertId,
      doctor_id,
      false,
      null,
      new Date(),
      new Date(),
    ]);

    await connection.query(
      `INSERT INTO alert_assignments 
       (alert_id, doctor_id, read_status, read_at, created_at, updated_at) 
       VALUES ?`,
      [assignmentValues]
    );

    await connection.commit();

    console.log("✅ Alert and assignments created successfully.");

    // 5️⃣ Send notifications via WebSocket
    const io = getIO();
    const notifications = [];

    for (const doctor_id of doctor_ids) {
      const socketId = getUserSocketId(doctor_id);
      const connected = isUserConnected(doctor_id);

      const alertData = {
        alert_id: alertId,
        patient: patientDetails,
        bp_reading: `${systolic}/${diastolic}`,
        bp_status: bpStatus,
        timestamp: new Date(),
      };

      if (connected && socketId) {
        io.to(`user_${doctor_id}`).emit("new_alert", alertData);
        io.to(socketId).emit("new_alert", alertData);
        console.log(`📡 Alert sent to doctor ${doctor_id}`);
      }

      io.to("all_clinicians").emit("new_alert_broadcast", alertData);
      notifications.push({ doctor_id, connected });
    }

    res.status(201).json({
      success: true,
      message: "BP Alert triggered successfully",
      bpStatus,
      alertId,
      doctors: doctor_ids,
      notifications,
    });
  } catch (err) {
    console.error("❌ Error in /test/bp-alert:", err);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
