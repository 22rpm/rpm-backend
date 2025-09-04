const express = require("express");
const router = express.Router();
const { createDeviceDataController, createBPDataController } = require("../controllers/deviceData.controller");
const { authRequired } = require("../middleware/auth");


// POST /api/bp/data
router.post("/bp/data", authRequired, createBPDataController);


module.exports = router;
