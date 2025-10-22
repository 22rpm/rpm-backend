import pool from "../config/db.js";
import { verifyDoctorPatientAccess } from "../services/doctor.service.js";
import { getPatientVitalSignsService } from "../services/doctor.service.js";

export const getPatientVitalSignsController = async (req, res) => {
  try {
    const doctor = req.user;
    const { patientId } = req.params;

    // Verify doctor has access to this patient
    const hasAccess = await verifyDoctorPatientAccess(doctor.id, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied to patient data",
      });
    }

    const vitalSigns = await getPatientVitalSignsService(patientId);

    res.status(200).json({
      success: true,
      data: vitalSigns,
    });
  } catch (err) {
    console.error("❌ Error fetching patient vital signs:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

import { getPatientDeviceDataService } from "../services/doctor.service.js";

export const getPatientDeviceDataController = async (req, res) => {
  try {
    const doctor = req.user;
    const { patientId } = req.params;
    const { deviceType = "bp", days = 7 } = req.query;

    // Validate required parameters
    if (!deviceType) {
      return res.status(400).json({
        success: false,
        message: "Device type is required",
      });
    }

    // Validate days parameter
    const daysInt = parseInt(days);
    if (isNaN(daysInt) || daysInt < 1 || daysInt > 365) {
      return res.status(400).json({
        success: false,
        message: "Days must be a number between 1 and 365",
      });
    }

    // Verify doctor has access to this patient
    const hasAccess = await verifyDoctorPatientAccess(doctor.id, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied to patient data",
      });
    }

    // Only BP is implemented for now
    if (deviceType !== "bp") {
      return res.status(200).json({
        success: true,
        data: {
          message: `${deviceType.toUpperCase()} data processing is under development`,
          deviceType,
          days: daysInt,
          status: "under_development",
        },
      });
    }

    const deviceData = await getPatientDeviceDataService(
      patientId,
      deviceType,
      daysInt
    );

    res.status(200).json({
      success: true,
      data: deviceData,
    });
  } catch (err) {
    console.error("❌ Error fetching patient device data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};
