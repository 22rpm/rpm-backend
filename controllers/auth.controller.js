// controllers/auth.controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { loginSchema } = require('../validations/auth.validation');
const { findUserByEmail, findRoleByUsername, updateLastLogin } = require('../services/user.service');
const { insertDevData } = require('../services/devData.service');
const { COOKIE_NAME } = require('../middleware/auth');
const { registerSchema } = require('../validations/auth.validation');
const { createUser, assignRole } = require('../services/user.service');
const speakeasy = require('speakeasy');
const { buildFingerprint } = require('../utils/fingerprint');
const { 
  getDeviceByHash, trustDevice, touchDevice,
  getMfa, setMfaSecret, enableMfa 
} = require('../services/security.service');
const { verifyOtp, createOtp } = require("../services/otp.service");
const { sendOtpEmail } = require("../services/mail.service");



const COOKIE_SECURE = process.env.NODE_ENV === 'production';

function signJwt(userPayload) {
  return jwt.sign(userPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer: 'rpm-api',
  });
}
function signMfaChallenge(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'rpm-api', subject: 'mfa' });
}

// auth.controller.js
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // ✅ Get user from DB through service
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Generate OTP (6-digit)
    const otp = ("" + Math.floor(100000 + Math.random() * 900000)).substring(0, 6);

    // ✅ Store OTP in otp_tokens table via service
    await createOtp(user.id, otp, "login");

    // ✅ Send OTP (via email service or SMS)
    if (sendOtpEmail) {
      await sendOtpEmail(user.email, otp);
    } else {
      console.log(`OTP for ${email}: ${otp}`); // fallback for dev
    }

    return res.status(200).json({ message: "OTP sent, please verify" });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}


async function me(req, res) {
  // req.user is set by authRequired middleware
  return res.status(200).json({ ok: true, user: req.user });
}

async function logout(req, res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
  });
  return res.status(200).json({ ok: true, message: 'Logged out' });
}


async function register(req, res) {
  try {
    const { value, error } = registerSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ ok: false, message: 'Validation error', details: error.details });
    }

    // Check if email already exists
    const existing = await findUserByEmail(value.email);
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(value.password, 12);
    const userId = await createUser({
      username: value.username,
      name: value.name,
      email: value.email,
      password: hashed,
    });

    await assignRole({
      username: value.username,
      userId,
      role: value.role,
    });

    return res.status(201).json({
      ok: true,
      message: 'User created successfully',
      user: {
        id: userId,
        username: value.username,
        name: value.name,
        email: value.email,
        role: value.role,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}

async function verifyLogin(req, res) {
  const { userId, otp } = req.body;

  const valid = await verifyOtp(userId, otp, "login");
  if (!valid) return res.status(400).json({ message: "Invalid or expired OTP" });

  // issue JWT or session here
  return res.json({ message: "Login successful", token: "jwt-token-here" });
}

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body;
    // 1. Find user
    const user = await findUserByEmail(email);
    
    if (!user) return res.status(400).json({ error: "User not found" });

    // 2. Call the service
    const valid = await verifyOtp(user.id, otp, "login");
    console.log(valid);
    
    if (!valid) return res.status(400).json({ error: "Invalid or expired OTP" });

    // 3. Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({ message: "OTP verified successfully", token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

async function addDevData(req, res) {
  try {
    const jsonData = req.body; // data from frontend (assumed JSON)

    if (!jsonData || typeof jsonData !== 'object') {
      return res.status(400).json({ error: "Invalid JSON data" });
    }

    const newId = await insertDevData(jsonData);

    return res.status(201).json({
      message: "Data inserted successfully",
      id: newId,
    });
  } catch (err) {
    console.error("Error inserting dev data:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = { login, me, logout, register, verifyOtpController, verifyLogin, addDevData };
