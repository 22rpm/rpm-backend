// controllers/auth.controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { loginSchema } = require('../validations/auth.validation');
const { findUserByEmail, findRoleByUsername, updateLastLogin } = require('../services/user.service');
const { COOKIE_NAME } = require('../middleware/auth');
const { registerSchema } = require('../validations/auth.validation');
const { createUser, assignRole } = require('../services/user.service');


const COOKIE_SECURE = process.env.NODE_ENV === 'production';

function signJwt(userPayload) {
  return jwt.sign(userPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer: 'rpm-api',
  });
}
async function login(req, res) {
  try {
    const { value, error } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ ok: false, message: "Validation error", details: error.details });
    }

    const user = await findUserByEmail(value.email);
    if (!user) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const passwordOk = await bcrypt.compare(value.password, user.password);
    if (!passwordOk) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const role = await findRoleByUsername(user.username);
    const payload = { id: user.id, email: user.email, username: user.username, role };

    const token = signJwt(payload);

    // ✅ Update last login timestamp
    await updateLastLogin(user.id);

    // HIPAA-friendly cookie defaults
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "strict",
      maxAge: parseInt(process.env.JWT_COOKIE_MAXAGE_MS || `${60 * 60 * 1000}`, 10), // default 1h
      path: "/",
    });

    return res.status(200).json({
      ok: true,
      message: "Login successful",
      user: { id: user.id, username: user.username, name: user.name, email: user.email },
      role,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
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

module.exports = { login, me, logout, register };
