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
