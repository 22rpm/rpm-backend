const express = require("express");
const router = express.Router();
const validate = require("../middleware/validate");
const { updateSettingsSchema } = require("../validations/settings.validation");
const {
  updateSettingsController,
} = require("../controllers/settings.controller");
const { authRequired } = require("../middleware/auth");

router.patch("/", authRequired, updateSettingsController);

module.exports = router;
