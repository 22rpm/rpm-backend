// socket/socketServer.js - COMPLETE UPDATED CODE
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = new Server(server, {
    // No path configuration - uses default "/socket.io"
    cors: {
      origin: [
        "https://rmtrpm.duckdns.org",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware
  io.use((socket, next) => {
    let token;

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    // Fallback to auth object
    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token;
    }

    console.log("🔐 Socket Auth - Token Present:", !!token);

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

  io.on("connection", (socket) => {
    console.log(
      `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
    );
    console.log("📡 Transport:", socket.conn.transport.name);

    // Store user socket mapping
    userSockets.set(socket.userId.toString(), socket.id);
    console.log("📊 Connected Users:", Array.from(userSockets.entries()));

    // Send immediate connection confirmation
    socket.emit("connection_success", {
      message: "Socket.IO connected successfully!",
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date(),
      transport: socket.conn.transport.name,
    });

    // Test message handler
    socket.on("test_message", (data) => {
      console.log("📨 Received test message:", data);
      socket.emit("test_response", {
        message: "Test response from server",
        received: data,
        timestamp: new Date(),
      });
    });

    // Join room handler
    socket.on("join_room", (roomId) => {
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);
      socket.emit("room_joined", {
        roomId,
        message: `Successfully joined room ${roomId}`,
        timestamp: new Date(),
      });
    });

    // Send message handler
    socket.on("send_message", (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join("_");

      console.log(`📤 User ${socket.userId} sending message to room ${roomId}`);

      io.to(roomId).emit("new_message", {
        senderId: socket.userId,
        receiverId,
        message,
        timestamp: new Date(),
      });
    });

    // Handle transport upgrades
    socket.conn.on("upgrade", (transport) => {
      console.log(
        `🔄 Transport upgraded for ${socket.userId}: ${transport.name}`
      );
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
      );
      userSockets.delete(socket.userId.toString());
      console.log("📊 Remaining Users:", Array.from(userSockets.entries()));
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

const getUserSockets = () => {
  return userSockets;
};

module.exports = {
  initializeSocket,
  getIO,
  getUserSockets,
};
