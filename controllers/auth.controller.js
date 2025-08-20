// controllers/auth.controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { loginSchema } = require('../validations/auth.validation');
const { findUserByEmail, findRoleByUsername, updateLastLogin } = require('../services/user.service');
const { COOKIE_NAME } = require('../middleware/auth');
const { registerSchema } = require('../validations/auth.validation');
const { createUser, assignRole } = require('../services/user.service');
const speakeasy = require('speakeasy');
const { buildFingerprint } = require('../utils/fingerprint');
const { 
  getDeviceByHash, trustDevice, touchDevice,
  getMfa, setMfaSecret, enableMfa 
} = require('../services/security.service');


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
const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await userService.findByEmail(email);
  if (!user) return res.status(400).json({ ok: false, message: "Invalid email" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ ok: false, message: "Invalid password" });

  // generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await userService.saveOtp(user.id, otp);

  // send email with Mailtrap
  await mailer.sendMail({
    from: '"TeleHealth" <noreply@telehealth.com>',
    to: user.email,
    subject: "Your OTP Code",
    text: `Your OTP code is ${otp}`,
  });

  return res.json({ ok: true, message: "OTP sent to your email. Please verify." });
};


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

module.exports = { login, me, logout, register };
