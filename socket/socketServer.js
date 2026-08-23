// const { Server } = require("socket.io");
// const jwt = require("jsonwebtoken");
// const cookie = require("cookie");

// let io;
// const userSockets = new Map();

// // Add these helper functions
// const getConnectedUsers = () => {
//   return Array.from(userSockets.entries()).map(([userId, socketId]) => ({
//     userId,
//     socketId,
//   }));
// };

// const isUserConnected = (userId) => {
//   return userSockets.has(userId.toString());
// };

// const getUserSocketId = (userId) => {
//   return userSockets.get(userId.toString());
// };

// const initializeSocket = (server) => {
//   io = new Server(server, {
//     path: "/socket.io", // ✅ Make sure this matches

//     cors: {
//       origin: [
//         "http://localhost:5173",
//         "http://localhost:5174",
//         "http://localhost:5175",
//         "http://localhost:3000",
//       ],
//       methods: ["GET", "POST"],
//       credentials: true,
//     },
//     transports: ["websocket", "polling"],
//     pingTimeout: 60000,
//     pingInterval: 25000,
//   });

//   // Authentication middleware
//   io.use((socket, next) => {
//     let token;

//     // Try to get token from cookies
//     if (socket.handshake.headers.cookie) {
//       const cookies = cookie.parse(socket.handshake.headers.cookie);
//       token = cookies.token;
//     }

//     // Fallback: check query parameters
//     if (!token && socket.handshake.query.token) {
//       token = socket.handshake.query.token;
//     }

//     console.log("🔐 Socket Auth - Token Present:", !!token);

//     if (!token) {
//       console.log("⚠️ No token found, allowing anonymous for testing.");
//       socket.userId = "anonymous";
//       return next();
//     }

//     try {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       socket.userId = decoded.id;
//       console.log("✅ Authenticated Socket User:", decoded.id);
//       next();
//     } catch (err) {
//       console.log("❌ Invalid Token:", err.message);
//       socket.userId = "anonymous";
//       next();
//     }
//   });

//   // Connection Events
//   io.on("connection", (socket) => {
//     console.log(
//       `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
//     );
//     console.log("📡 Transport:", socket.conn.transport.name);

//     // Store user socket mapping
//     userSockets.set(socket.userId.toString(), socket.id);

//     // Join user to their personal room
//     socket.join(`user_${socket.userId}`);

//     // Join all clinicians to a common room (if user is clinician)
//     if (socket.userId !== "anonymous") {
//       socket.join("all_clinicians");
//     }

//     console.log("📊 Connected Users:", getConnectedUsers());

//     // Send immediate test message
//     socket.emit("test_connection", {
//       message: "Hello from Socket.IO server on localhost:3000!",
//       userId: socket.userId,
//       timestamp: new Date(),
//       transport: socket.conn.transport.name,
//     });

//     // Connection status handler
//     socket.on("check_connection", () => {
//       socket.emit("connection_status", {
//         status: "connected",
//         userId: socket.userId,
//         socketId: socket.id,
//         timestamp: new Date(),
//       });
//     });

//     // Test message handler
//     socket.on("test_message", (data) => {
//       console.log("📨 Received test message:", data);
//       socket.emit("test_response", {
//         message: "Test response from server!",
//         received: data,
//         timestamp: new Date(),
//       });
//     });

//     // Join private chat room
//     socket.on("join_room", (receiverId) => {
//       const roomId = [socket.userId, receiverId].sort().join("_");
//       socket.join(roomId);
//       console.log(`🚪 User ${socket.userId} joined room ${roomId}`);

//       socket.emit("room_joined", {
//         roomId,
//         message: "Successfully joined room",
//         timestamp: new Date(),
//       });
//     });

//     // Send message to room
//     socket.on("send_message", (data) => {
//       const { receiverId, message } = data;
//       const roomId = [socket.userId, receiverId].sort().join("_");

//       console.log(`📤 Sending message to room ${roomId}:`, message);

//       io.to(roomId).emit("new_message", {
//         senderId: socket.userId,
//         receiverId,
//         message,
//         timestamp: new Date(),
//       });
//     });

//     // Handle disconnect
//     socket.on("disconnect", (reason) => {
//       console.log(
//         `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
//       );
//       userSockets.delete(socket.userId.toString());
//       console.log("📊 Remaining Users:", getConnectedUsers());
//     });
//   });

//   console.log("✅ Socket.IO initialized on localhost:3000");
//   return io;
// };

// const getIO = () => {
//   if (!io) throw new Error("Socket.io not initialized!");
//   return io;
// };

// // Export all helper functions
// module.exports = {
//   initializeSocket,
//   getIO,
//   userSockets,
//   getConnectedUsers,
//   isUserConnected,
//   getUserSocketId,
// };


// socket/socketServer.js - COMPLETE UPDATED VERSION
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

// Add these helper functions
const getConnectedUsers = () => {
  return Array.from(userSockets.entries()).map(([userId, socketId]) => ({
    userId,
    socketId,
  }));
};

const isUserConnected = (userId) => {
  return userSockets.has(userId.toString());
};

const getUserSocketId = (userId) => {
  return userSockets.get(userId.toString());
};

const initializeSocket = (server) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  io = new Server(server, {
    path: isProduction ? "/rpm-be/socket.io" : "/socket.io", // ✅ Different paths for dev/prod
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "https://rmtrpm.duckdns.org",
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

    console.log("🔐 Socket Auth Attempt");
    // REDACTED: never log raw handshake headers/query — the `cookie` header and a
    // query `token` param carry live session JWTs (token + refresh_token). Logging
    // them let anyone with log/box access lift a live session. Log only which auth
    // source is present, never values. See SECURITY_FOLLOWUPS.
    console.log(
      "📋 Auth sources — cookie:",
      !!socket.handshake.headers.cookie,
      "query.token:",
      !!socket.handshake.query.token,
      "authorization:",
      !!socket.handshake.headers.authorization
    );

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
      console.log("🍪 Token from cookies:", token ? "Present" : "Missing");
    }

    // Fallback: check query parameters (important for production)
    if (!token && socket.handshake.query.token) {
      token = socket.handshake.query.token;
      console.log("🔑 Token from query:", token ? "Present" : "Missing");
    }

    // Fallback: check auth header
    if (!token && socket.handshake.headers.authorization) {
      token = socket.handshake.headers.authorization.replace('Bearer ', '');
      console.log("📁 Token from auth header:", token ? "Present" : "Missing");
    }

    console.log("🔐 Socket Auth - Token Present:", !!token);

    if (!token) {
      console.log("⚠️ No token found, allowing anonymous for testing.");
      socket.userId = "anonymous";
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      console.log("✅ Authenticated Socket User:", decoded.id, "Role:", decoded.role);
      next();
    } catch (err) {
      console.log("❌ Invalid Token:", err.message);
      socket.userId = "anonymous";
      next();
    }
  });

  // Connection Events
  io.on("connection", (socket) => {
    console.log(
      `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
    );
    console.log("📡 Transport:", socket.conn.transport.name);
    console.log("🌐 Environment:", process.env.NODE_ENV);

    // Store user socket mapping
    userSockets.set(socket.userId.toString(), socket.id);

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);

    // Join all clinicians to a common room (if user is clinician)
    if (socket.userId !== "anonymous" && socket.userRole === 'clinician') {
      socket.join("all_clinicians");
      console.log(`👨‍⚕️ Clinician ${socket.userId} joined all_clinicians room`);
    }

    console.log("📊 Connected Users:", getConnectedUsers());

    // Send immediate test message
    socket.emit("connection_success", {
      message: "Successfully connected to Socket.IO server!",
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date(),
      transport: socket.conn.transport.name,
      environment: process.env.NODE_ENV,
    });

    // Connection status handler
    socket.on("check_connection", () => {
      socket.emit("connection_status", {
        status: "connected",
        userId: socket.userId,
        socketId: socket.id,
        timestamp: new Date(),
        environment: process.env.NODE_ENV,
      });
    });

    // Test message handler
    socket.on("test_message", (data) => {
      console.log("📨 Received test message:", data);
      socket.emit("test_response", {
        message: "Test response from server!",
        received: data,
        timestamp: new Date(),
        environment: process.env.NODE_ENV,
        yourUserId: socket.userId
      });
    });

    // Join private chat room
    socket.on("join_room", (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);

      socket.emit("room_joined", {
        roomId,
        message: "Successfully joined room",
        timestamp: new Date(),
      });
    });

    // Send message to room
    socket.on("send_message", (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join("_");

      console.log(`📤 Sending message to room ${roomId}:`, message);

      io.to(roomId).emit("new_message", {
        senderId: socket.userId,
        receiverId,
        message,
        timestamp: new Date(),
      });
    });

    // Alert broadcasting
    socket.on("broadcast_alert", (alertData) => {
      console.log("📢 Broadcasting alert:", alertData);
      io.emit("new_alert_broadcast", {
        ...alertData,
        broadcastBy: socket.userId,
        timestamp: new Date(),
      });
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
      );
      userSockets.delete(socket.userId.toString());
      console.log("📊 Remaining Users:", getConnectedUsers());
    });
  });

  console.log(`✅ Socket.IO initialized in ${process.env.NODE_ENV} mode`);
  console.log(`🛣️ Socket path: ${isProduction ? "/rpm-be/socket.io" : "/socket.io"}`);
  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

// Export all helper functions
module.exports = {
  initializeSocket,
  getIO,
  userSockets,
  getConnectedUsers,
  isUserConnected,
  getUserSocketId,
};