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

// Update your getPatientDeviceDataService function
const getPatientDeviceDataService = async (
  patientId,
  deviceType,
  days,
  page = 1,
  limit = 10
) => {
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

  // Calculate offset for pagination
  const offset = (page - 1) * limit;

  // Get paginated data
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
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [patientId, deviceType, startDateString, limit, offset]
  );

  // Get total count for pagination
  const [totalCountResult] = await db.query(
    `SELECT COUNT(*) as total
     FROM dev_data 
     WHERE user_id = ? 
       AND dev_type = ?
       AND DATE(created_at) >= ?`,
    [patientId, deviceType, startDateString]
  );

  const totalRecords = totalCountResult[0].total;
  const totalPages = Math.ceil(totalRecords / limit);

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
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalRecords: 0,
        hasNext: false,
        hasPrev: false,
      },
      message: `No ${deviceType.toUpperCase()} data found for the last ${days} days`,
    };
  }

  // Process BP data to extract systolic, diastolic, pulse from your JSON structure
  const processedData = deviceData.map((record) => {
    let systolic = null;
    let diastolic = null;
    let pulse = null;
    let mean = null;
    let bpStatus = null;

    try {
      const dataObj =
        typeof record.data === "string" ? JSON.parse(record.data) : record.data;

      // Extract data from your JSON structure
      systolic = dataObj.systolic || null;
      diastolic = dataObj.diastolic || null;
      pulse = dataObj.pulse || null;
      mean = dataObj.mean || null;
      bpStatus = dataObj.bpStatus || null;
    } catch (error) {
      console.error("Error parsing device data:", error);
    }

    return {
      ...record,
      systolic,
      diastolic,
      pulse,
      mean,
      bpStatus,
      formattedBP: systolic && diastolic ? `${systolic}/${diastolic}` : "N/A",
      formattedPulse: pulse ? `${pulse} bpm` : "N/A",
    };
  });

  // Calculate statistics for the entire date range (not just current page)
  const [allDataInRange] = await db.query(
    `SELECT data
     FROM dev_data 
     WHERE user_id = ? 
       AND dev_type = ?
       AND DATE(created_at) >= ?`,
    [patientId, deviceType, startDateString]
  );

  const allReadings = allDataInRange
    .map((record) => {
      try {
        const dataObj =
          typeof record.data === "string"
            ? JSON.parse(record.data)
            : record.data;
        return {
          systolic: dataObj.systolic || dataObj.SYS,
          diastolic: dataObj.diastolic || dataObj.DIA,
          pulse: dataObj.pulse,
        };
      } catch (error) {
        return null;
      }
    })
    .filter((reading) => reading && reading.systolic && reading.diastolic);

  // Calculate statistics
  const statistics =
    allReadings.length > 0
      ? {
          totalReadings: allReadings.length,
          averageSystolic: Math.round(
            allReadings.reduce((sum, reading) => sum + reading.systolic, 0) /
              allReadings.length
          ),
          averageDiastolic: Math.round(
            allReadings.reduce((sum, reading) => sum + reading.diastolic, 0) /
              allReadings.length
          ),
          averagePulse: Math.round(
            allReadings.reduce(
              (sum, reading) => sum + (reading.pulse || 0),
              0
            ) / allReadings.filter((r) => r.pulse).length
          ),
          highestSystolic: Math.max(
            ...allReadings.map((reading) => reading.systolic)
          ),
          lowestSystolic: Math.min(
            ...allReadings.map((reading) => reading.systolic)
          ),
          highestDiastolic: Math.max(
            ...allReadings.map((reading) => reading.diastolic)
          ),
          lowestDiastolic: Math.min(
            ...allReadings.map((reading) => reading.diastolic)
          ),
          highestPulse: Math.max(
            ...allReadings.map((reading) => reading.pulse || 0)
          ),
          lowestPulse: Math.min(
            ...allReadings.map((reading) => reading.pulse || 0)
          ),
        }
      : {
          totalReadings: 0,
          averageSystolic: 0,
          averageDiastolic: 0,
          averagePulse: 0,
          highestSystolic: 0,
          lowestSystolic: 0,
          highestDiastolic: 0,
          lowestDiastolic: 0,
          highestPulse: 0,
          lowestPulse: 0,
        };

  return {
    patient: patientDetails[0],
    deviceType,
    days,
    totalRecords,
    data: processedData,
    statistics,
    dateRange: {
      start: startDateString,
      end: new Date().toISOString().split("T")[0],
    },
    pagination: {
      currentPage: page,
      totalPages,
      totalRecords,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      limit,
    },
  };
};

module.exports = {
  getPatientVitalSignsService,
  verifyDoctorPatientAccess,
  getPatientDeviceDataService,
};
