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

const getBPStatus = (systolic, diastolic) => {
  if (!systolic || !diastolic) return "no-data";

  if (systolic > 180 || diastolic > 120) return "critical";
  if (systolic > 140 || diastolic > 90) return "warning";
  if (systolic < 90 || diastolic < 60) return "warning";

  return "normal";
};
// Helper function to calculate statistics
const calculateStatistics = (readings) => {
  if (readings.length === 0) {
    return {
      totalReadings: 0,
      averageSystolic: 0,
      averageDiastolic: 0,
      averagePulse: 0,
      highestSystolic: 0,
      lowestSystolic: 0,
      highestDiastolic: 0,
      lowestDiastolic: 0,
    };
  }

  const systolicReadings = readings.map((r) => r.systolic).filter(Boolean);
  const diastolicReadings = readings.map((r) => r.diastolic).filter(Boolean);
  const pulseReadings = readings.map((r) => r.pulse).filter(Boolean);

  return {
    totalReadings: readings.length,
    averageSystolic: Math.round(
      systolicReadings.reduce((sum, val) => sum + val, 0) /
        systolicReadings.length
    ),
    averageDiastolic: Math.round(
      diastolicReadings.reduce((sum, val) => sum + val, 0) /
        diastolicReadings.length
    ),
    averagePulse:
      pulseReadings.length > 0
        ? Math.round(
            pulseReadings.reduce((sum, val) => sum + val, 0) /
              pulseReadings.length
          )
        : 0,
    highestSystolic: Math.max(...systolicReadings),
    lowestSystolic: Math.min(...systolicReadings),
    highestDiastolic: Math.max(...diastolicReadings),
    lowestDiastolic: Math.min(...diastolicReadings),
    highestPulse: pulseReadings.length > 0 ? Math.max(...pulseReadings) : 0,
    lowestPulse: pulseReadings.length > 0 ? Math.min(...pulseReadings) : 0,
  };
};
// Update your getPatientDeviceDataService function
// const getPatientDeviceDataService = async (
//   patientId,
//   deviceType,
//   days,
//   page = 1,
//   limit = 10
// ) => {
//   // Get patient details
//   const [patientDetails] = await db.query(
//     `SELECT id, name, email FROM users WHERE id = ?`,
//     [patientId]
//   );

//   if (patientDetails.length === 0) {
//     throw new Error("Patient not found");
//   }

//   // Calculate date range
//   const startDate = new Date();
//   startDate.setDate(startDate.getDate() - days);
//   const startDateString = startDate.toISOString().split("T")[0];

//   // Calculate offset for pagination
//   const offset = (page - 1) * limit;

//   // Get paginated data
//   const [deviceData] = await db.query(
//     `SELECT
//       id,
//       dev_id,
//       user_id,
//       data,
//       dev_type,
//       created_at,
//       updated_at
//      FROM dev_data
//      WHERE user_id = ?
//        AND dev_type = ?
//        AND DATE(created_at) >= ?
//      ORDER BY created_at DESC
//      LIMIT ? OFFSET ?`,
//     [patientId, deviceType, startDateString, limit, offset]
//   );

//   // Get total count for pagination
//   const [totalCountResult] = await db.query(
//     `SELECT COUNT(*) as total
//      FROM dev_data
//      WHERE user_id = ?
//        AND dev_type = ?
//        AND DATE(created_at) >= ?`,
//     [patientId, deviceType, startDateString]
//   );

//   const totalRecords = totalCountResult[0].total;
//   const totalPages = Math.ceil(totalRecords / limit);

//   // If no data found
//   if (deviceData.length === 0) {
//     return {
//       patient: patientDetails[0],
//       deviceType,
//       days,
//       totalRecords: 0,
//       data: [],
//       dateRange: {
//         start: startDateString,
//         end: new Date().toISOString().split("T")[0],
//       },
//       pagination: {
//         currentPage: page,
//         totalPages: 0,
//         totalRecords: 0,
//         hasNext: false,
//         hasPrev: false,
//       },
//       message: `No ${deviceType.toUpperCase()} data found for the last ${days} days`,
//     };
//   }

//   // Process BP data to extract systolic, diastolic, pulse from your JSON structure
//   const processedData = deviceData.map((record) => {
//     let systolic = null;
//     let diastolic = null;
//     let pulse = null;
//     let mean = null;
//     let bpStatus = null;

//     try {
//       const dataObj =
//         typeof record.data === "string" ? JSON.parse(record.data) : record.data;

//       // Extract data from your JSON structure
//       systolic = dataObj.systolic || null;
//       diastolic = dataObj.diastolic || null;
//       pulse = dataObj.pulse || null;
//       mean = dataObj.mean || null;
//       bpStatus = dataObj.bpStatus || null;
//     } catch (error) {
//       console.error("Error parsing device data:", error);
//     }

//     return {
//       ...record,
//       systolic,
//       diastolic,
//       pulse,
//       mean,
//       bpStatus,
//       formattedBP: systolic && diastolic ? `${systolic}/${diastolic}` : "N/A",
//       formattedPulse: pulse ? `${pulse} bpm` : "N/A",
//     };
//   });

//   // Calculate statistics for the entire date range (not just current page)
//   const [allDataInRange] = await db.query(
//     `SELECT data
//      FROM dev_data
//      WHERE user_id = ?
//        AND dev_type = ?
//        AND DATE(created_at) >= ?`,
//     [patientId, deviceType, startDateString]
//   );

//   const allReadings = allDataInRange
//     .map((record) => {
//       try {
//         const dataObj =
//           typeof record.data === "string"
//             ? JSON.parse(record.data)
//             : record.data;
//         return {
//           systolic: dataObj.systolic || dataObj.SYS,
//           diastolic: dataObj.diastolic || dataObj.DIA,
//           pulse: dataObj.pulse,
//         };
//       } catch (error) {
//         return null;
//       }
//     })
//     .filter((reading) => reading && reading.systolic && reading.diastolic);

//   // Calculate statistics
//   const statistics =
//     allReadings.length > 0
//       ? {
//           totalReadings: allReadings.length,
//           averageSystolic: Math.round(
//             allReadings.reduce((sum, reading) => sum + reading.systolic, 0) /
//               allReadings.length
//           ),
//           averageDiastolic: Math.round(
//             allReadings.reduce((sum, reading) => sum + reading.diastolic, 0) /
//               allReadings.length
//           ),
//           averagePulse: Math.round(
//             allReadings.reduce(
//               (sum, reading) => sum + (reading.pulse || 0),
//               0
//             ) / allReadings.filter((r) => r.pulse).length
//           ),
//           highestSystolic: Math.max(
//             ...allReadings.map((reading) => reading.systolic)
//           ),
//           lowestSystolic: Math.min(
//             ...allReadings.map((reading) => reading.systolic)
//           ),
//           highestDiastolic: Math.max(
//             ...allReadings.map((reading) => reading.diastolic)
//           ),
//           lowestDiastolic: Math.min(
//             ...allReadings.map((reading) => reading.diastolic)
//           ),
//           highestPulse: Math.max(
//             ...allReadings.map((reading) => reading.pulse || 0)
//           ),
//           lowestPulse: Math.min(
//             ...allReadings.map((reading) => reading.pulse || 0)
//           ),
//         }
//       : {
//           totalReadings: 0,
//           averageSystolic: 0,
//           averageDiastolic: 0,
//           averagePulse: 0,
//           highestSystolic: 0,
//           lowestSystolic: 0,
//           highestDiastolic: 0,
//           lowestDiastolic: 0,
//           highestPulse: 0,
//           lowestPulse: 0,
//         };

//   return {
//     patient: patientDetails[0],
//     deviceType,
//     days,
//     totalRecords,
//     data: processedData,
//     statistics,
//     dateRange: {
//       start: startDateString,
//       end: new Date().toISOString().split("T")[0],
//     },
//     pagination: {
//       currentPage: page,
//       totalPages,
//       totalRecords,
//       hasNext: page < totalPages,
//       hasPrev: page > 1,
//       limit,
//     },
//   };
// };
const getPatientDeviceDataService = async (
  patientId,
  deviceType,
  days,
  page = 1,
  limit = 10,
  fromDate = null,
  toDate = null
) => {
  // Get patient details
  const [patientDetails] = await db.query(
    `SELECT id, name, email FROM users WHERE id = ?`,
    [patientId]
  );

  if (patientDetails.length === 0) {
    throw new Error("Patient not found");
  }

  // Build date range condition based on input
  let dateCondition = "";
  let dateParams = [];
  let startDateString = "";
  let endDateString = "";
  let dateRangeMode = "";

  if (fromDate && toDate) {
    // Custom date range mode
    startDateString = fromDate;
    endDateString = toDate;
    dateCondition = "AND DATE(created_at) BETWEEN ? AND ?";
    dateParams = [fromDate, toDate];
    dateRangeMode = "custom";
  } else {
    // Days range mode (default)
    const endDate = new Date();
    const startDate = new Date();

    if (days === 1) {
      // Today only - get data for the current day only
      startDateString = endDate.toISOString().split("T")[0];
      endDateString = endDate.toISOString().split("T")[0];
      dateCondition = "AND DATE(created_at) = ?";
      dateParams = [startDateString];
      dateRangeMode = "today";
    } else if (days === 0) {
      // All time - no date filter
      startDateString = "";
      endDateString = "";
      dateCondition = "";
      dateParams = [];
      dateRangeMode = "all";
    } else {
      // Last N days (including today)
      startDate.setDate(startDate.getDate() - (days - 1));
      startDateString = startDate.toISOString().split("T")[0];
      endDateString = endDate.toISOString().split("T")[0];
      dateCondition = "AND DATE(created_at) BETWEEN ? AND ?";
      dateParams = [startDateString, endDateString];
      dateRangeMode = "days";
    }
  }

  console.log("📅 Date Range Calculation:", {
    days,
    fromDate,
    toDate,
    startDateString,
    endDateString,
    dateCondition,
    dateParams,
    dateRangeMode,
  });

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
       ${dateCondition}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [patientId, deviceType, ...dateParams, limit, offset]
  );

  // Get total count for pagination
  const [totalCountResult] = await db.query(
    `SELECT COUNT(*) as total
     FROM dev_data 
     WHERE user_id = ? 
       AND dev_type = ?
       ${dateCondition}`,
    [patientId, deviceType, ...dateParams]
  );

  const totalRecords = totalCountResult[0].total;
  const totalPages = Math.ceil(totalRecords / limit);

  // If no data found
  if (deviceData.length === 0) {
    const emptyResponse = {
      patient: patientDetails[0],
      deviceType,
      days: fromDate && toDate ? null : days,
      dateRange: {
        start: startDateString,
        end: endDateString,
        mode: dateRangeMode,
      },
      totalRecords: 0,
      data: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalRecords: 0,
        hasNext: false,
        hasPrev: false,
        limit,
      },
      message: `No ${deviceType.toUpperCase()} data found for the selected period`,
    };

    // Add device-specific empty statistics
    if (deviceType === "bp") {
      emptyResponse.statistics = {
        totalReadings: 0,
        averageSystolic: 0,
        averageDiastolic: 0,
        averagePulse: 0,
        highestSystolic: 0,
        lowestSystolic: 0,
        highestDiastolic: 0,
        lowestDiastolic: 0,
      };
    } else if (deviceType === "spo2") {
      emptyResponse.statistics = {
        totalReadings: 0,
        averageSpo2: 0,
        averagePulse: 0,
        highestSpo2: 0,
        lowestSpo2: 0,
        maxSpo2: 0,
        minSpo2: 0,
        maxPulse: 0,
        minPulse: 0,
      };
    }

    return emptyResponse;
  }

  // Process data based on device type
  let processedData = [];
  let statistics = {};

  if (deviceType === "bp") {
    processedData = deviceData.map(processBPData);
    const allReadings = await getAllReadingsInRange(
      patientId,
      deviceType,
      dateCondition,
      dateParams
    );
    statistics = calculateBPStatistics(allReadings);
  } else if (deviceType === "spo2") {
    processedData = deviceData.map(processSpO2Data);
    const allReadings = await getAllReadingsInRange(
      patientId,
      deviceType,
      dateCondition,
      dateParams
    );
    statistics = calculateSpO2Statistics(allReadings);
  }

  return {
    patient: patientDetails[0],
    deviceType,
    days: fromDate && toDate ? null : days,
    totalRecords,
    data: processedData,
    statistics,
    dateRange: {
      start: startDateString,
      end: endDateString,
      mode: dateRangeMode,
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

// Helper function to get all readings in date range for statistics
const getAllReadingsInRange = async (
  patientId,
  deviceType,
  dateCondition,
  dateParams
) => {
  const [allDataInRange] = await db.query(
    `SELECT data
     FROM dev_data 
     WHERE user_id = ? 
       AND dev_type = ?
       ${dateCondition}`,
    [patientId, deviceType, ...dateParams]
  );

  return allDataInRange
    .map((record) => {
      try {
        return typeof record.data === "string"
          ? JSON.parse(record.data)
          : record.data;
      } catch (error) {
        console.error("Error parsing device data:", error);
        return null;
      }
    })
    .filter((data) => data !== null);
};

// Process BP data
const processBPData = (record) => {
  let systolic = null;
  let diastolic = null;
  let pulse = null;
  let mean = null;
  let bpStatus = null;
  let batteryLevel = null;
  let deviceName = null;

  try {
    const dataObj =
      typeof record.data === "string" ? JSON.parse(record.data) : record.data;

    // Extract data from BP JSON structure
    systolic = dataObj.systolic || dataObj.SYS || null;
    diastolic = dataObj.diastolic || dataObj.DIA || null;
    pulse = dataObj.pulse || dataObj.heartRate || null;
    mean = dataObj.mean || null;
    bpStatus = dataObj.bpStatus || null;

    // Extract device info for frontend
    batteryLevel = dataObj.deviceInfo?.batteryLevel || null;
    deviceName = dataObj.deviceInfo?.name || record.dev_id || "Unknown Device";
  } catch (error) {
    console.error("Error parsing BP device data:", error);
  }

  // Determine BP status if not provided
  if (!bpStatus && systolic && diastolic) {
    bpStatus = getBPStatus(systolic, diastolic);
  }

  return {
    ...record,
    systolic,
    diastolic,
    pulse,
    mean,
    bpStatus,
    batteryLevel,
    deviceName,
    formattedBP: systolic && diastolic ? `${systolic}/${diastolic}` : "N/A",
    formattedPulse: pulse ? `${pulse} bpm` : "N/A",
  };
};

// Process SpO2 data
const processSpO2Data = (record) => {
  let spo2 = null;
  let pulse = null;
  let pi = null;
  let maxSpo2 = null;
  let minSpo2 = null;
  let maxPulse = null;
  let minPulse = null;
  let duration = null;
  let batteryLevel = null;
  let deviceName = null;

  try {
    const dataObj =
      typeof record.data === "string" ? JSON.parse(record.data) : record.data;

    // Extract data from SpO2 JSON structure
    spo2 = dataObj.spo2 || null;
    pulse = dataObj.pulse || null;
    pi = dataObj.pi || null;
    maxSpo2 = dataObj.maxSpo2 || null;
    minSpo2 = dataObj.minSpo2 || null;
    maxPulse = dataObj.maxPulse || null;
    minPulse = dataObj.minPulse || null;
    duration = dataObj.duration || null;

    // Extract device info for frontend
    batteryLevel = dataObj.deviceInfo?.batteryLevel || null;
    deviceName = dataObj.deviceInfo?.name || record.dev_id || "Unknown Device";
  } catch (error) {
    console.error("Error parsing SpO2 device data:", error);
  }

  // Determine SpO2 status
  const spo2Status = getSpO2Status(spo2);

  return {
    ...record,
    spo2,
    pulse,
    pi,
    maxSpo2,
    minSpo2,
    maxPulse,
    minPulse,
    duration,
    spo2Status,
    batteryLevel,
    deviceName,
    formattedSpO2: spo2 ? `${spo2}%` : "N/A",
    formattedPulse: pulse ? `${Math.round(pulse)} bpm` : "N/A",
    formattedPI: pi !== null && pi !== undefined ? pi.toString() : "N/A",
  };
};

// Calculate BP statistics
const calculateBPStatistics = (readings) => {
  const validReadings = readings.filter(
    (reading) => reading && reading.systolic && reading.diastolic
  );

  if (validReadings.length === 0) {
    return {
      totalReadings: 0,
      averageSystolic: 0,
      averageDiastolic: 0,
      averagePulse: 0,
      highestSystolic: 0,
      lowestSystolic: 0,
      highestDiastolic: 0,
      lowestDiastolic: 0,
    };
  }

  const systolicValues = validReadings.map((r) => parseInt(r.systolic));
  const diastolicValues = validReadings.map((r) => parseInt(r.diastolic));
  const pulseValues = validReadings
    .map((r) => parseInt(r.pulse || 0))
    .filter((p) => p > 0);

  return {
    totalReadings: validReadings.length,
    averageSystolic: Math.round(
      systolicValues.reduce((a, b) => a + b, 0) / systolicValues.length
    ),
    averageDiastolic: Math.round(
      diastolicValues.reduce((a, b) => a + b, 0) / diastolicValues.length
    ),
    averagePulse:
      pulseValues.length > 0
        ? Math.round(
            pulseValues.reduce((a, b) => a + b, 0) / pulseValues.length
          )
        : 0,
    highestSystolic: Math.max(...systolicValues),
    lowestSystolic: Math.min(...systolicValues),
    highestDiastolic: Math.max(...diastolicValues),
    lowestDiastolic: Math.min(...diastolicValues),
  };
};

// Calculate SpO2 statistics
const calculateSpO2Statistics = (readings) => {
  const validReadings = readings.filter((reading) => reading && reading.spo2);

  if (validReadings.length === 0) {
    return {
      totalReadings: 0,
      averageSpo2: 0,
      averagePulse: 0,
      highestSpo2: 0,
      lowestSpo2: 0,
      maxSpo2: 0,
      minSpo2: 0,
      maxPulse: 0,
      minPulse: 0,
    };
  }

  const spo2Values = validReadings.map((r) => parseFloat(r.spo2));
  const pulseValues = validReadings
    .map((r) => parseFloat(r.pulse || 0))
    .filter((p) => p > 0);
  const maxSpo2Values = validReadings.map((r) =>
    parseFloat(r.maxSpo2 || r.spo2)
  );
  const minSpo2Values = validReadings.map((r) =>
    parseFloat(r.minSpo2 || r.spo2)
  );
  const maxPulseValues = validReadings
    .map((r) => parseFloat(r.maxPulse || r.pulse || 0))
    .filter((p) => p > 0);
  const minPulseValues = validReadings
    .map((r) => parseFloat(r.minPulse || r.pulse || 0))
    .filter((p) => p > 0);

  return {
    totalReadings: validReadings.length,
    averageSpo2: parseFloat(
      (spo2Values.reduce((a, b) => a + b, 0) / spo2Values.length).toFixed(1)
    ),
    averagePulse:
      pulseValues.length > 0
        ? Math.round(
            pulseValues.reduce((a, b) => a + b, 0) / pulseValues.length
          )
        : 0,
    highestSpo2: parseFloat(Math.max(...spo2Values).toFixed(1)),
    lowestSpo2: parseFloat(Math.min(...spo2Values).toFixed(1)),
    maxSpo2:
      maxSpo2Values.length > 0
        ? parseFloat(Math.max(...maxSpo2Values).toFixed(1))
        : 0,
    minSpo2:
      minSpo2Values.length > 0
        ? parseFloat(Math.min(...minSpo2Values).toFixed(1))
        : 0,
    maxPulse: maxPulseValues.length > 0 ? Math.max(...maxPulseValues) : 0,
    minPulse: minPulseValues.length > 0 ? Math.min(...minPulseValues) : 0,
  };
};

// Helper function to determine SpO2 status
const getSpO2Status = (spo2) => {
  if (!spo2) return "no-data";
  const spo2Value = parseFloat(spo2);
  if (spo2Value < 90) return "critical";
  if (spo2Value < 95) return "warning";
  return "normal";
};

async function getAssignedPatientsService(doctorId, limit = 10, offset = 0) {
  try {
    console.log("👨‍⚕️ [getAssignedPatientsService] Starting...");
    console.log("➡️ Doctor ID:", doctorId);
    console.log("➡️ Limit:", limit, "Offset:", offset);

    const query = `
      SELECT 
        u.id AS patient_id,
        u.username,
        u.name,
        u.email,
        u.phoneNumber,
        u.last_login,
        u.is_active,
        u.organization_id,
        u.created_at,       -- ✅ Include this line
        pda.assigned_by,
        pda.created_at AS assigned_at
      FROM patient_doctor_assignments pda
      INNER JOIN users u 
        ON u.id = pda.patient_id
      WHERE 
        pda.doctor_id = ?
        AND EXISTS (
          SELECT 1 FROM role r1
          WHERE r1.user_id = pda.doctor_id 
          AND r1.role_type = 'clinician'
        )
        AND EXISTS (
          SELECT 1 FROM role r2
          WHERE r2.user_id = u.id 
          AND r2.role_type = 'patient'
        )
      ORDER BY u.last_login DESC, u.name ASC
      LIMIT ? OFFSET ?
    `;

    console.log("🧩 Executing safer query...");
    const [patients] = await db.query(query, [doctorId, limit, offset]);

    console.log("✅ Query executed successfully!");
    console.log("📦 Total patients found:", patients.length);
    if (patients.length > 0) {
      console.log("👥 Sample patient data:", patients.slice(0, 2));
    } else {
      console.log(
        "⚠️ No patients found even after fix — check patient IDs in users table."
      );
    }

    return patients;
  } catch (err) {
    console.error("❌ Error in getAssignedPatientsService:", err);
    throw new Error("Failed to fetch assigned patients");
  }
}

async function searchAssignedPatientsService(doctorId, search) {
  try {
    console.log(
      "🔍 Searching assigned patients for:",
      doctorId,
      "Search:",
      search
    );

    const query = `
      SELECT 
        u.id AS patient_id,
        u.username,
        u.name,
        u.email,
        u.phoneNumber,
        u.last_login,
        u.is_active,
        u.organization_id,
        u.created_at,
        pda.assigned_by,
        pda.created_at AS assigned_at
      FROM patient_doctor_assignments pda
      INNER JOIN users u ON u.id = pda.patient_id
      WHERE 
        pda.doctor_id = ?
        AND (
          u.name LIKE ? OR
          u.username LIKE ? OR
          u.email LIKE ? OR
          u.phoneNumber LIKE ?
        )
        AND EXISTS (
          SELECT 1 FROM role r1
          WHERE r1.user_id = pda.doctor_id 
          AND r1.role_type = 'clinician'
        )
        AND EXISTS (
          SELECT 1 FROM role r2
          WHERE r2.user_id = u.id 
          AND r2.role_type = 'patient'
        )
      ORDER BY u.name ASC
      LIMIT 20
    `;

    const likeQuery = `%${search}%`;
    const [patients] = await db.query(query, [
      doctorId,
      likeQuery,
      likeQuery,
      likeQuery,
      likeQuery,
    ]);

    console.log("✅ Search results:", patients.length);
    return patients;
  } catch (err) {
    console.error("❌ Error in searchAssignedPatientsService:", err);
    throw new Error("Failed to search assigned patients");
  }
}

const getUserWithLatestDeviceDataService = async (userId) => {
  try {
    // Fetch user details
    const [userRows] = await db.query(
      `
      SELECT 
        id, username, name, email, phoneNumber, organization_id,
        is_active, last_login, created_at, updated_at
      FROM users
      WHERE id = ?
      `,
      [userId]
    );

    if (userRows.length === 0) return null;
    const user = userRows[0];

    // Fetch latest BP device data
    const [bpRows] = await db.query(
      `
      SELECT 
        id, dev_id, user_id, data, created_at, dev_type
      FROM dev_data
      WHERE user_id = ? AND dev_type = 'bp'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    // Fetch latest SpO2 device data
    const [spo2Rows] = await db.query(
      `
      SELECT 
        id, dev_id, user_id, data, created_at, dev_type
      FROM dev_data
      WHERE user_id = ? AND dev_type = 'spo2'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    const bpData = bpRows.length > 0 ? bpRows[0] : null;
    const spo2Data = spo2Rows.length > 0 ? spo2Rows[0] : null;

    return {
      user,
      latestBP: bpData,
      latestSpO2: spo2Data,
    };
  } catch (err) {
    console.error("❌ Error in getUserWithLatestDeviceDataService:", err);
    throw new Error("Failed to fetch user data with device info");
  }
};

module.exports = {
  getUserWithLatestDeviceDataService,
  getPatientVitalSignsService,
  getAssignedPatientsService,
  verifyDoctorPatientAccess,
  getPatientDeviceDataService,
  searchAssignedPatientsService,
};
