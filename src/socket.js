// src/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import Message from "./models/Message.js";
import Notification from "./models/Notification.js";
import PeerSession from "./models/PeerSession.js";
import { setSocketInstance } from "./utils/notifyUser.js";

const activeUsers = new Map(); // userId -> socketId
const p2pQueues = new Map(); // topic -> [userIds]
const p2pRooms = new Map(); // socketId -> roomId

const VALID_P2P_TOPICS = [
  // Roles
  "Software Engineering", "Frontend Development", "Backend Engineering", "Fullstack Development",
  "Mobile Development", "Data Science", "Machine Learning Eng", "DevOps & SRE",
  "Cybersecurity Analyst", "Cloud Architect", "Product Management", "UI/UX Design",
  "Data Engineer", "QA Automation", "Embedded Systems",
  
  // Specific Technologies
  "React & Next.js", "Angular", "Vue.js", "Node.js & Express", "Python (Django/FastAPI)",
  "Java (Spring Boot)", "Go (Golang)", "Rust", "C++ System Design", "Kotlin / Swift",
  "SQL & Database Design", "NoSQL (MongoDB/Redis)", "Kubernetes & Docker", "AWS/Azure/GCP",
  
  // Concepts
  "System Design (High Level)", "Data Structures & Algorithms", "Low Level Design (LLD)",
  "Behavioral / HR Round", "GraphQL / REST APIs", "Microservices Architecture"
];

export default function socketServer(httpServer) {
  const allowedOrigins = [
    "http://localhost:5173",
    "https://onestopfrontend.vercel.app",
    process.env.CLIENT_URL
  ].filter(Boolean);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  });

  // ✅ Make socket globally accessible (for utils/notifyUser.js)
  setSocketInstance(io);

  /**
   * 🔐 Authenticate each socket via JWT before connection
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error("User not found"));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  /**
   * ✅ Handle new connection
   */
  io.on("connection", (socket) => {
    const userId = socket.user._id.toString();
    activeUsers.set(userId, socket.id);

    console.log(`✅ ${socket.user.name} connected (${socket.user.role})`);
    io.emit("presence:update", { userId, online: true });

    // =====================================================
    // 🔔 REAL-TIME NOTIFICATIONS
    // =====================================================

    // Join personal room for user-specific notifications
    socket.join(userId);
    console.log(`🔔 User joined room: ${userId}`);

    // Listen for manual "notification:send" events (optional)
    socket.on("notification:send", async (data) => {
      try {
        const { to, title, message, link, type = "system" } = data;
        if (!to || !title || !message) return;

        const notif = await Notification.create({
          user: to,
          title,
          message,
          link,
          type,
          read: false,
        });

        const targetSocket = activeUsers.get(to);
        if (targetSocket) {
          io.to(targetSocket).emit("notification:new", notif);
        }

        console.log(`📨 Real-time notification sent to ${to}: ${title}`);
      } catch (err) {
        console.error("❌ Notification send failed:", err);
      }
    });

    // =====================================================
    // 💬 MESSAGING
    // =====================================================

    socket.on("message:send", async ({ conversationId, to, body }, cb) => {
      try {
        if (!conversationId || !to)
          return cb?.({ ok: false, error: "Missing recipient or conversation" });

        const msg = await Message.create({
          conversation: conversationId,
          from: userId,
          to,
          body,
          status: "sent",
        });

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: msg._id,
          lastMessageAt: new Date(),
        });

        const populated = await Message.findById(msg._id)
          .populate("from to", "name email avatar role")
          .lean();

        // 🎯 Emit to receiver
        const targetSocket = activeUsers.get(to);
        if (targetSocket) {
          io.to(targetSocket).emit("message:new", { message: populated });
          populated.status = "delivered";
          await Message.findByIdAndUpdate(msg._id, { status: "delivered" });
        }

        cb?.({ ok: true, message: populated });
      } catch (err) {
        console.error("💥 Send error:", err);
        cb?.({ ok: false, error: "Send failed" });
      }
    });

    // =====================================================
    // 🧹 DELETE MESSAGE
    // =====================================================

    socket.on("message:delete", async ({ messageId, mode }, cb) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return cb?.({ ok: false, error: "Message not found" });

        if (mode === "everyone") {
          if (msg.from.toString() !== userId)
            return cb?.({ ok: false, error: "Not allowed" });

          msg.body = "❌ Message deleted";
          await msg.save();

          const targetSocket = activeUsers.get(msg.to.toString());
          if (targetSocket) {
            io.to(targetSocket).emit("message:deleted", {
              messageId: msg._id,
              mode: "everyone",
            });
          }

          io.to(socket.id).emit("message:deleted", {
            messageId: msg._id,
            mode: "everyone",
          });

          cb?.({ ok: true });
        } else if (mode === "me") {
          if (!msg.deletedFor.includes(userId)) {
            msg.deletedFor.push(userId);
            await msg.save();
          }

          io.to(socket.id).emit("message:deleted", {
            messageId: msg._id,
            mode: "me",
          });

          cb?.({ ok: true });
        }
      } catch (err) {
        console.error("❌ Delete error:", err);
        cb?.({ ok: false, error: "Delete failed" });
      }
    });

    // =====================================================
    // ⌨️ TYPING INDICATOR
    // =====================================================

    socket.on("typing", ({ to, conversationId, typing }) => {
      const targetSocket = activeUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("typing", {
          from: userId,
          conversationId,
          typing,
        });
      }
    });

    // =====================================================
    // 🧾 MESSAGE STATUS UPDATES
    // =====================================================

    socket.on("message:mark", async ({ messageId, status }) => {
      try {
        const msg = await Message.findById(messageId);
        if (msg && msg.to.toString() === userId) {
          msg.status = status;
          await msg.save();

          const fromSocket = activeUsers.get(msg.from.toString());
          if (fromSocket) {
            io.to(fromSocket).emit("message:update", {
              messageId: msg._id,
              status,
            });
          }
        }
      } catch (err) {
        console.error("❌ Message mark error:", err);
      }
    });

    // =====================================================
    // 🤝 PEER-TO-PEER (P2P) INTERVIEW LOGIC
    // =====================================================

    socket.on("p2p:join_queue", async ({ topic }) => {
      // 🛡️ Logic Validation: Ignore invalid or forged topics
      if (!VALID_P2P_TOPICS.includes(topic)) {
        console.warn(`🛑 Unauthorized P2P Topic Attempt: ${topic} by ${socket.user.name}`);
        return;
      }

      console.log(`🤝 ${socket.user.name} joined P2P Queue for ${topic}`);
      
      if (!p2pQueues.has(topic)) p2pQueues.set(topic, []);
      const queue = p2pQueues.get(topic);

      // Remove if already in queue (sanity check)
      const existingIdx = queue.findIndex(u => u.userId === userId);
      if (existingIdx > -1) queue.splice(existingIdx, 1);

      // Matchmaking
      if (queue.length > 0) {
        const partner = queue.shift();
        const partnerSocket = io.sockets.sockets.get(partner.socketId);
        
        if (partnerSocket) {
          const roomId = `p2p_${partner.userId}_${userId}`;
          const sessionData = { topic, roomId, startTime: new Date() };

          // Persist to Database
          await PeerSession.create({
            participants: [
              { user: partner.userId, role: "interviewer" },
              { user: userId, role: "candidate" }
            ],
            topic,
            roomId,
            status: "active"
          });

          socket.join(roomId);
          partnerSocket.join(roomId);
          p2pRooms.set(socket.id, roomId);
          p2pRooms.set(partnerSocket.id, roomId);

          socket.emit("p2p:matched", { 
            peer: { name: partner.name, id: partner.userId, avatar: partner.avatar }, 
            role: "interviewer",
            ...sessionData
          });
          
          partnerSocket.emit("p2p:matched", { 
            peer: { name: socket.user.name, id: userId, avatar: socket.user.avatar }, 
            role: "candidate",
            ...sessionData
          });

          console.log(`🔥 Match Saved: ${socket.user.name} <-> ${partner.name}`);
        }
      } else {
        queue.push({ userId, socketId: socket.id, name: socket.user.name, avatar: socket.user.avatar });
      }
    });

    socket.on("p2p:leave_queue", () => {
      console.log(`👋 ${socket.user.name} left queue`);
      p2pQueues.forEach((queue, topic) => {
        const idx = queue.findIndex(u => u.socketId === socket.id);
        if (idx > -1) queue.splice(idx, 1);
      });
    });

    socket.on("p2p:message", (msg) => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) socket.to(roomId).emit("p2p:message", msg);
    });

    socket.on("p2p:signal", (data) => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) socket.to(roomId).emit("p2p:signal", data);
    });

    socket.on("p2p:swap_roles", () => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) io.to(roomId).emit("p2p:roles_swapped");
    });

    socket.on("p2p:leave_room", () => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit("p2p:peer_left");
        socket.leave(roomId);
        p2pRooms.delete(socket.id);
      }
    });

    socket.on("p2p:code_update", (code) => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit("p2p:code_update", code);
      }
    });

    socket.on("p2p:leave_room", () => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit("p2p:peer_left");
        socket.leave(roomId);
        p2pRooms.delete(socket.id);
      }
    });

    // =====================================================
    // 🔌 DISCONNECT
    // =====================================================

    socket.on("disconnect", () => {
      // Clean P2P queues
      p2pQueues.forEach((queue, topic) => {
        const idx = queue.findIndex(u => u.socketId === socket.id);
        if (idx > -1) queue.splice(idx, 1);
      });

      // Notify P2P partner if in room
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit("p2p:peer_left");
        p2pRooms.delete(socket.id);
      }

      activeUsers.delete(userId);
      io.emit("presence:update", { userId, online: false });
      console.log(`❌ ${socket.user.name} disconnected`);
    });
  });

  console.log("⚙️ Socket.io initialized ✅");
  return io;
}

export { activeUsers };
