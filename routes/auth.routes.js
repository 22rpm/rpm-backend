// routes/auth.routes.js
const express = require('express');
const { login, me, logout, register } = require('../controllers/auth.controller');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.get('/me', authRequired, me);
router.post('/logout', authRequired, logout);
router.post('/register', register);

module.exports = router;
