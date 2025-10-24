// socket/socketServer.js
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: function (origin, callback) {
        // Allow all duckdns.org and localhost origins
        if (
          !origin ||
          origin.includes("duckdns.org") ||
          origin.includes("localhost")
        ) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io", // Important: Nginx handles the /rpm-be prefix
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
  });

  // Auth middleware
  io.use((socket, next) => {
    let token;

    // Check cookies first
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    // Also check auth header as fallback
    if (!token && socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }

    console.log("🔐 Socket auth - Token present:", !!token);
    console.log("🔐 Socket path:", socket.handshake.url);

    if (!token) {
      console.log(
        "❌ Socket auth - No token found, allowing connection for testing"
      );
      socket.userId = "anonymous";
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("✅ Socket auth - User authenticated:", decoded.id);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      console.log("❌ Socket auth - Token invalid:", err.message);
      socket.userId = "anonymous";
      next();
    }
  });

  io.on("connection", (socket) => {
    console.log(
      "✅ User connected - ID:",
      socket.userId,
      "Socket ID:",
      socket.id
    );
    console.log("📡 Transport:", socket.conn.transport.name);
    console.log("🔗 Path:", socket.handshake.url);

    userSockets.set(socket.userId.toString(), socket.id);

    console.log(
      "📊 Currently connected users:",
      Array.from(userSockets.entries())
    );

    // Test connection
    socket.emit("test_connection", {
      message: "Hello from server! Connected successfully",
      userId: socket.userId,
      timestamp: new Date(),
      transport: socket.conn.transport.name,
      path: "/socket.io",
    });

    socket.on("join_room", (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);
    });

    socket.on("send_message", (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join("_");

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
        `🔄 Transport upgraded for ${socket.userId}:`,
        transport.name
      );
    });

    socket.on("disconnect", (reason) => {
      console.log(
        "❌ User disconnected - ID:",
        socket.userId,
        "Reason:",
        reason
      );
      userSockets.delete(socket.userId.toString());
      console.log(
        "📊 Remaining connected users:",
        Array.from(userSockets.entries())
      );
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets,
};
