import pool from "../config/db.js";
import {
  verifyDoctorPatientAccess,
  getAssignedPatientsService,
  searchAssignedPatientsService,
  getUserWithLatestDeviceDataService,
} from "../services/doctor.service.js";
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
    const {
      deviceType = "bp",
      days = 7,
      page = 1,
      limit = 10,
      fromDate,
      toDate,
    } = req.query;

    console.log("📱 Device data request:", {
      patientId,
      deviceType,
      days,
      page,
      limit,
      fromDate,
      toDate,
    });

    // Validate required parameters
    if (!deviceType) {
      return res.status(400).json({
        success: false,
        message: "Device type is required",
      });
    }

    // Validate device type
    if (!["bp", "spo2"].includes(deviceType)) {
      return res.status(400).json({
        success: false,
        message: "Device type must be either 'bp' or 'spo2'",
      });
    }

    // Validate days parameter (only used in range mode)
    const daysInt = parseInt(days);
    if (isNaN(daysInt) || daysInt < 0 || daysInt > 365) {
      return res.status(400).json({
        success: false,
        message: "Days must be a number between 0 and 365",
      });
    }

    // Validate pagination parameters
    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    if (isNaN(pageInt) || pageInt < 1) {
      return res.status(400).json({
        success: false,
        message: "Page must be a number greater than 0",
      });
    }
    if (isNaN(limitInt) || limitInt < 1 || limitInt > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be a number between 1 and 100",
      });
    }

    // Validate date range if custom dates are provided
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD",
        });
      }

      if (from > to) {
        return res.status(400).json({
          success: false,
          message: "From date cannot be after to date",
        });
      }
    }

    // Verify doctor has access to this patient
    const hasAccess = await verifyDoctorPatientAccess(doctor.id, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied to patient data",
      });
    }

    const deviceData = await getPatientDeviceDataService(
      patientId,
      deviceType,
      daysInt,
      pageInt,
      limitInt,
      fromDate,
      toDate
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


export const getAssignedPatientsController = async (req, res) => {
  try {
    const doctor = req.user;
    const { page = 1, limit = 5 } = req.query;

    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const offset = (pageInt - 1) * limitInt;

    const result = await getAssignedPatientsService(
      doctor.id,
      limitInt,
      offset
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("❌ Error fetching assigned patients:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const searchAssignedPatientsController = async (req, res) => {
  try {
    const doctor = req.user;
    const { search = "" } = req.query;

    if (!search.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const result = await searchAssignedPatientsService(
      doctor.id,
      search.trim()
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("❌ Error searching assigned patients:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

export const getUserWithLatestDeviceDataController = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const result = await getUserWithLatestDeviceDataService(userId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("❌ Error fetching user data:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};
