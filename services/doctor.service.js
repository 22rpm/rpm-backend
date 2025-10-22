const db = require("../config/db.js");

const getPatientVitalSignsService = async (patientId) => {
  // Get patient details
  const [patientDetails] = await db.query(
    `SELECT id, name, email FROM users WHERE id = ?`,
    [patientId]
  );

  if (patientDetails.length === 0) {
    throw new Error("Patient not found");
  }

  // ✅ FIXED: Get latest BP data only
  const [latestData] = await db.query(
    `SELECT dd.data, dd.dev_type, dd.created_at
     FROM dev_data dd
     WHERE dd.user_id = ? AND dd.dev_type = 'bp'
     ORDER BY dd.created_at DESC
     LIMIT 1`,
    [patientId]
  );

  // If no BP data found, return default values
  if (latestData.length === 0) {
    return {
      patient: patientDetails[0],
      vitalSigns: {
        heartRate: {
          value: "--",
          unit: "BPM",
          status: "no-data",
          timestamp: null,
        },
        bloodPressure: {
          value: "--/--",
          unit: "mmHg",
          status: "no-data",
          timestamp: null,
        },
      },
      lastUpdated: null,
      overallStatus: "no-data",
    };
  }

  const latestReading = latestData[0];
  const data = latestReading.data;

  // Extract BP device data
  const heartRate = data.pulse || data.heartRate || "--";
  const systolic = data.systolic || "--";
  const diastolic = data.diastolic || "--";
  const timestamp = data.timestamp || latestReading.created_at;

  // Status calculation functions
  const getHeartRateStatus = (hr) => {
    if (hr === "--") return "no-data";
    hr = parseInt(hr);
    if (hr >= 60 && hr <= 100) return "normal";
    if (hr >= 50 && hr <= 110) return "warning";
    return "critical";
  };

  const getBPStatus = (sys, dia) => {
    if (sys === "--" || dia === "--") return "no-data";
    sys = parseInt(sys);
    dia = parseInt(dia);
    if (sys < 120 && dia < 80) return "normal";
    if (sys <= 139 && dia <= 89) return "warning";
    return "critical";
  };

  const vitalSigns = {
    heartRate: {
      value: heartRate,
      unit: "BPM",
      status: getHeartRateStatus(heartRate),
      timestamp: timestamp,
    },
    bloodPressure: {
      value: `${systolic}/${diastolic}`,
      unit: "mmHg",
      status: getBPStatus(systolic, diastolic),
      timestamp: timestamp,
    },
  };

  // Determine overall status
  const statuses = Object.values(vitalSigns).map((vs) => vs.status);
  let overallStatus = "normal";
  if (statuses.includes("critical")) overallStatus = "critical";
  else if (statuses.includes("warning")) overallStatus = "warning";
  else if (statuses.includes("no-data")) overallStatus = "no-data";

  return {
    patient: patientDetails[0],
    vitalSigns,
    lastUpdated: timestamp,
    overallStatus,
  };
};
// Keep the same verifyDoctorPatientAccess function
const verifyDoctorPatientAccess = async (doctorId, patientId) => {
  const [assignments] = await db.query(
    `SELECT pa.id 
     FROM patient_doctor_assignments pa
     WHERE pa.doctor_id = ? AND pa.patient_id = ?`,
    [doctorId, patientId]
  );
  return assignments.length > 0;
};

const getPatientDeviceDataService = async (patientId, deviceType, days) => {
  // Get patient details
  const [patientDetails] = await db.query(
    `SELECT id, name, email FROM users WHERE id = ?`,
    [patientId]
  );

  if (patientDetails.length === 0) {
    throw new Error("Patient not found");
  }

  // Calculate date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateString = startDate.toISOString().split("T")[0];

  // Get all data for the specified device type and time period, ordered by created_at DESC
  const [deviceData] = await db.query(
    `SELECT 
      id,
      dev_id,
      user_id,
      data,
      dev_type,
      created_at,
      updated_at
     FROM dev_data 
     WHERE user_id = ? 
       AND dev_type = ?
       AND DATE(created_at) >= ?
     ORDER BY created_at DESC`,
    [patientId, deviceType, startDateString]
  );

  // If no data found
  if (deviceData.length === 0) {
    return {
      patient: patientDetails[0],
      deviceType,
      days,
      totalRecords: 0,
      data: [],
      dateRange: {
        start: startDateString,
        end: new Date().toISOString().split("T")[0],
      },
      message: `No ${deviceType.toUpperCase()} data found for the last ${days} days`,
    };
  }

  // Return raw data without any processing
  return {
    patient: patientDetails[0],
    deviceType,
    days,
    totalRecords: deviceData.length,
    data: deviceData,
    dateRange: {
      start: startDateString,
      end: new Date().toISOString().split("T")[0],
    },
  };
};

module.exports = {
  getPatientVitalSignsService,
  verifyDoctorPatientAccess,
  getPatientDeviceDataService,
};
