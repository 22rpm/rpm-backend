const db = require("../config/db"); // your MySQL pool
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
     LIMIT 50`,
    [patientId]
  );

  // Transform data safely
  const formattedReadings = readings.map((reading) => {
    let data;
    try {
      // ✅ handle both string & object cases
      data =
        typeof reading.data === "string"
          ? JSON.parse(reading.data)
          : reading.data;
    } catch (err) {
      console.error("Error parsing BP data:", err, "Raw:", reading.data);
      data = {};
    }

    // ✅ calculate mean arterial pressure (MAP) if not present
    const mean =
      data.meanPressure ||
      data.map ||
      (data.systolic && data.diastolic
        ? (data.systolic + 2 * data.diastolic) / 3
        : null);

    return {
      id: reading.id,
      systolic: data.systolic || 0,
      diastolic: data.diastolic || 0,
      bpm: data.pulse || data.heartRate || 0,
      mean,
      timestamp: reading.timestamp,
      date: reading.date,
      time: reading.time,
    };
  });

  return formattedReadings;
};

const getPatientLatestBPService = async (patientId) => {
  // Get latest BP reading
  const [readings] = await db.query(
    `SELECT 
      id,
      data,
      created_at as timestamp
     FROM dev_data 
     WHERE user_id = ? AND dev_type = 'bp'
     ORDER BY created_at DESC
     LIMIT 1`,
    [patientId]
  );

  if (readings.length === 0) return null;

  const reading = readings[0];

  let data;
  try {
    // ✅ Safe parse
    data =
      typeof reading.data === "string"
        ? JSON.parse(reading.data)
        : reading.data;
  } catch (err) {
    console.error("Error parsing BP data:", err, "Raw:", reading.data);
    data = {};
  }

  // ✅ Auto-compute mean (MAP)
  const mean =
    data.meanPressure ||
    data.map ||
    (data.systolic && data.diastolic
      ? (data.systolic + 2 * data.diastolic) / 3
      : null);

  return {
    id: reading.id,
    systolic: data.systolic || 0,
    diastolic: data.diastolic || 0,
    bpm: data.pulse || data.heartRate || 0,
    mean,
    timestamp: reading.timestamp,
  };
};

module.exports = {
  getPatientBPReadingsService,
  getPatientLatestBPService,
};
