// socket/socketServer.js - ENHANCED VERSION
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Enhanced Authentication middleware
  io.use(async (socket, next) => {
    console.log("🔐 Socket connection attempt:", {
      headers: socket.handshake.headers,
      query: socket.handshake.query,
      auth: socket.handshake.auth,
    });

    let token;

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
      console.log("🔐 Token from cookies:", token ? "Present" : "Missing");
    }

    // Fallback: check query parameters from frontend
    if (!token && socket.handshake.query) {
      token = socket.handshake.query.token;
      console.log("🔐 Token from query:", token ? "Present" : "Missing");
    }

    // Fallback: check auth object
    if (!token && socket.handshake.auth) {
      token = socket.handshake.auth.token;
      console.log("🔐 Token from auth:", token ? "Present" : "Missing");
    }

    if (!token) {
      console.log("⚠️ No token found, allowing anonymous connection");
      socket.userId = "anonymous";
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      console.log("✅ Authenticated Socket User:", decoded.id);
      next();
    } catch (err) {
      console.log("❌ Invalid Token:", err.message);
      socket.userId = "anonymous";
      next();
    }
  });

  // Enhanced Connection Events
  io.on("connection", (socket) => {
    console.log("=".repeat(50));
    console.log(`✅ NEW SOCKET CONNECTION`);
    console.log(`   User ID: ${socket.userId}`);
    console.log(`   Socket ID: ${socket.id}`);
    console.log(`   Transport: ${socket.conn.transport.name}`);
    console.log("=".repeat(50));

    // ✅ CRITICAL: Store user mapping
    if (socket.userId && socket.userId !== "anonymous") {
      userSockets.set(socket.userId.toString(), socket.id);

      // Join user's personal room
      socket.join(`user_${socket.userId}`);

      console.log(
        `🚪 User ${socket.userId} joined room: user_${socket.userId}`
      );
      console.log("📊 Current userSockets:", Array.from(userSockets.entries()));
    }

    // Send immediate test message
    socket.emit("test_connection", {
      message: "Hello from Socket.IO server!",
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date(),
    });

    // Test message handler
    socket.on("test_message", (data) => {
      console.log("📨 Received test message from client:", data);
      socket.emit("test_response", {
        message: "Test response from server!",
        received: data,
        timestamp: new Date(),
      });
    });

    // Debug endpoint to check connection status
    socket.on("check_connection", () => {
      console.log("🔍 Connection check requested by:", socket.userId);
      socket.emit("connection_status", {
        userId: socket.userId,
        socketId: socket.id,
        connectedUsers: Array.from(userSockets.entries()),
        totalConnections: userSockets.size,
      });
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
      );

      if (socket.userId && socket.userId !== "anonymous") {
        userSockets.delete(socket.userId.toString());
      }

      console.log("📊 Remaining Users:", Array.from(userSockets.entries()));
    });

    // Log any errors
    socket.on("error", (error) => {
      console.error("💥 Socket error:", error);
    });
  });

  console.log("✅ Socket.IO initialized with enhanced debugging");
  return io;
};

// Helper function to get connected users
const getConnectedUsers = () => {
  return Array.from(userSockets.entries());
};

// Helper function to check if user is connected
const isUserConnected = (userId) => {
  return userSockets.has(userId.toString());
};

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
};
