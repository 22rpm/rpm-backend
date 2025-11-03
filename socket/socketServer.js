// socket/socketServer.js - FINAL VERSION
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId (reverse mapping)

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "https://rmtrpm.duckdns.org", // ✅ allow your production domain
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/rpm-be/socket.io/", // ✅ must match frontend path
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  console.log("🔄 Socket.IO server initializing...");

  // 🔐 Authentication middleware
  io.use((socket, next) => {
    console.log("🔐 New socket connection attempt");

    let token = null;
    let userIdFromQuery = null;

    // Get from query
    if (socket.handshake.query.userId) {
      userIdFromQuery = socket.handshake.query.userId;
      console.log(`🔍 User ID from query: ${userIdFromQuery}`);
    }

    // Get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
      console.log(`🔍 Token from cookies: ${token ? "Present" : "Missing"}`);
    }

    // Fallback to query token
    if (!token && socket.handshake.query.token) {
      token = socket.handshake.query.token;
      console.log(`🔍 Token from query: ${token ? "Present" : "Missing"}`);
    }

    // Verify JWT
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        console.log(`✅ Authenticated via JWT: User ${decoded.id}`);
      } catch (err) {
        console.log(`❌ JWT invalid: ${err.message}`);
        socket.userId = userIdFromQuery || "anonymous";
      }
    } else {
      socket.userId = userIdFromQuery || "anonymous";
      console.log(`ℹ️ No token, using userId: ${socket.userId}`);
    }

    next();
  });

  // 🔌 Handle connections
  io.on("connection", (socket) => {
    console.log("=".repeat(50));
    console.log(`✅ SOCKET CONNECTED`);
    console.log(`   User ID: ${socket.userId}`);
    console.log(`   Socket ID: ${socket.id}`);
    console.log(`   Transport: ${socket.conn.transport.name}`);
    console.log("=".repeat(50));

    if (socket.userId && socket.userId !== "anonymous") {
      const userIdStr = socket.userId.toString();

      // Remove previous session if user reconnects
      if (userSockets.has(userIdStr)) {
        const oldSocketId = userSockets.get(userIdStr);
        userSockets.delete(userIdStr);
        socketUsers.delete(oldSocketId);
        console.log(`🔄 Removed previous connection for user ${userIdStr}`);
      }

      // Store new session
      userSockets.set(userIdStr, socket.id);
      socketUsers.set(socket.id, userIdStr);

      // Join rooms
      socket.join(`user_${userIdStr}`);
      socket.join(`all_clinicians`);

      console.log(
        `🚪 User ${userIdStr} joined rooms: user_${userIdStr}, all_clinicians`
      );
      console.log("📊 Connected users:", Array.from(userSockets.entries()));
    }

    // Welcome message
    socket.emit("welcome", {
      message: "Connected to RPM Socket Server",
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date(),
    });

    // 🔧 Test events
    socket.on("test_message", (data) => {
      console.log("📨 Test message received:", data);
      socket.emit("test_response", {
        message: "Server received your message!",
        original: data,
        timestamp: new Date(),
      });
    });

    socket.on("check_connection", () => {
      const response = {
        userId: socket.userId,
        socketId: socket.id,
        connectedUsers: Array.from(userSockets.entries()),
        totalConnections: userSockets.size,
        yourRooms: Array.from(socket.rooms),
      };
      console.log("🔍 Connection check:", response);
      socket.emit("connection_status", response);
    });

    // Disconnect
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ DISCONNECTED: User ${socket.userId}, Socket ${socket.id}, Reason: ${reason}`
      );

      if (socket.userId && socket.userId !== "anonymous") {
        userSockets.delete(socket.userId.toString());
      }
      socketUsers.delete(socket.id);

      console.log("📊 Remaining users:", Array.from(userSockets.entries()));
    });

    // Error handling
    socket.on("error", (error) => {
      console.error("💥 Socket error:", error);
    });
  });

  console.log("✅ Socket.IO initialized on path /rpm-be/socket.io/");
  console.log("📡 Waiting for connections...");

  return io;
};

// 🔧 Utility functions
const getConnectedUsers = () => Array.from(userSockets.entries());
const isUserConnected = (userId) => userSockets.has(userId.toString());
const getUserSocketId = (userId) => userSockets.get(userId.toString());
const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets,
  getConnectedUsers,
  isUserConnected,
  getUserSocketId,
};
