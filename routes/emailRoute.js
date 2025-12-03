const express = require("express");
const { sendSupportEmail } = require("../controllers/emailController");

const router = express.Router();

router.post("/support", sendSupportEmail);

module.exports = router;
