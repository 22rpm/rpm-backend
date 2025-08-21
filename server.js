// server.js
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const devDataRoutes = require('./routes/auth.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();
app.use(express.json());
app.use(cookieParser());

// CORS example (adjust origins as needed). Cookies need credentials=true on client.
const allowed = 
(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (allowed.length) {
  const cors = require('cors');
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
      credentials: true,
    })
  );
}

// app.get('/health', (req, res) => res.json({ ok: true, service: 'rpm-api', ts: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/dev-data', devDataRoutes);
// 404
app.use((req, res) => res.status(404).json({ ok: false, message: 'Not found' }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server started on ${port}`));
