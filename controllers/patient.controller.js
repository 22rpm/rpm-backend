const {
  getPatientBPReadingsService,
  getPatientLatestBPService,
} = require("../services/patient.service");
const getPatientBPReadingsController = async (req, res) => {
  try {
    const patient = req.user; // logged-in patient
    const readings = await getPatientBPReadingsService(patient.id);

    res.status(200).json({
      success: true,
      data: readings,
      message: "Blood pressure readings fetched successfully",
    });
  } catch (err) {
    console.error("❌ Error fetching BP readings:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};


 const getPatientLatestBPController = async (req, res) => {
   try {
     const patient = req.user;
     const latestReading = await getPatientLatestBPService(patient.id);

     res.status(200).json({
       success: true,
       data: latestReading,
       message: "Latest blood pressure reading fetched successfully",
     });
   } catch (err) {
     console.error("❌ Error fetching latest BP reading:", err);
     res.status(500).json({
       success: false,
       message: err.message || "Internal Server Error",
     });
   }
 };
module.exports = {
  getPatientBPReadingsController,
  getPatientLatestBPController,
};
