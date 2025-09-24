// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { initializeSocket } = require("./socket/socketServer");

const devDataRoutes = require("./routes/deviceData.routes");
// const deviceDataRoutes = require("./routes/deviceData.routes");
const authRoutes = require("./routes/auth.routes");
const messageRoutes = require("./routes/messageRoutes");
const adminRoutes = require("./routes/admin.routes");
const swaggerDocs = require("./config/swagger");
const swaggerUi = require("swagger-ui-express");
const settingsRoutes = require("./routes/settings.route");
const orgRoutes=require('./routes/org.routes')
const fs = require("fs");
const path = require("path");

const app = express();

const server = http.createServer(app);

app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", true);

// CORS example (adjust origins as needed). Cookies need credentials=true on client.
const allowed = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (allowed.length) {
  const cors = require("cors");
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );
}
app.use(express.urlencoded({ extended: true }));

// app.get('/health', (req, res) => res.json({ ok: true, service: 'rpm-api', ts: new Date().toISOString() }));
app.use("/api/messages", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dev-data", devDataRoutes);
// app.use("/api/device-data", deviceDataRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/settings", settingsRoutes);
app.use('/api/org',orgRoutes)
// ✅ Load swagger.json
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
);

// ✅ Swagger UI (only in dev)
if (process.env.NODE_ENV === "development") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log(
    `✅ Swagger docs available at http://localhost:${
      process.env.PORT || 4000
    }/api-docs`
  );
}

// 404
app.use((req, res) =>
  res.status(404).json({ ok: false, message: "Not found" })
);

initializeSocket(server);

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Server started on ${port}`));
