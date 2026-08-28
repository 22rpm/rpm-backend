import pool from "../config/db.js";
import {
  getAssignedPatientsService,
  searchAssignedPatientsService,
  getUserWithLatestDeviceDataService,
  getOrgPatientsService,
  searchOrgPatientsService,
} from "../services/doctor.service.js";
import { getPatientVitalSignsService } from "../services/doctor.service.js";
import { canAccessPatient } from "../services/patientAccess.js";

const SUPER_ADMIN = "super-admin";

export const getPatientVitalSignsController = async (req, res) => {
  try {
    const doctor = req.user;
    const { patientId } = req.params;

    // Visibility via the shared model (services/patientAccess): org-wide roles
    // (super-admin/admin/care_manager) see any patient in the org; a clinician
    // must be assigned. The helper enforces the org boundary itself, so this is
    // safe independent of scopePatientParam.
    const allowed = await canAccessPatient(doctor, req.orgScope, patientId);
    if (!allowed) {
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

    // Visibility via the shared model (services/patientAccess): org-wide roles
    // see any patient in the org; a clinician must be assigned. Enforces the org
    // boundary itself.
    const allowed = await canAccessPatient(doctor, req.orgScope, patientId);
    if (!allowed) {
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

    // Super-admin sees every patient in the selected organization (req.orgScope);
    // a clinician sees only the patients assigned to them.
    const result =
      doctor.role_type === SUPER_ADMIN
        ? await getOrgPatientsService(req.orgScope, limitInt, offset)
        : await getAssignedPatientsService(doctor.id, limitInt, offset);

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

    // Super-admin searches across the selected organization; a clinician
    // searches only within their assigned patients.
    const result =
      doctor.role_type === SUPER_ADMIN
        ? await searchOrgPatientsService(req.orgScope, search.trim())
        : await searchAssignedPatientsService(doctor.id, search.trim());

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
