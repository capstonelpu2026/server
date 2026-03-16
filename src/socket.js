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
const proctorRooms = new Map(); // socketId -> applicationId
const p2pActiveRooms = new Map(); // roomId -> { participants: [userIds], topic, startTime }
const disconnectTimeouts = new Map(); // userId -> timeoutId

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

    socket.on("p2p:join_queue", async ({ topic: rawTopic }) => {
      const topic = (rawTopic || "").trim();
      
      // 🚀 NEW: Check if this user was already in an active room (handle accidental refresh)
      for (const [rid, roomData] of p2pActiveRooms.entries()) {
        if (roomData.participants.includes(userId)) {
          console.log(`[P2P] Found active session for ${socket.user.name} in ${rid}. Suggesting rejoin instead.`);
          // We don't auto-rejoin here, but we can prevent them from queueing if they should be in a room
        }
      }

      console.log(`[P2P DEBUG] ${socket.user.name} (${socket.id}) requested join for topic: "${topic}"`);

      if (!VALID_P2P_TOPICS.includes(topic)) {
        console.warn(`[P2P DEBUG] 🛑 Unauthorized Topic: "${topic}" by ${socket.user.name}`);
        return;
      }

      if (!p2pQueues.has(topic)) p2pQueues.set(topic, []);
      const queue = p2pQueues.get(topic);

      // Remove current socket from queue if it was there
      const prevLen = queue.length;
      const filteredQueue = queue.filter(u => u.socketId !== socket.id);
      p2pQueues.set(topic, filteredQueue);
      if (filteredQueue.length < prevLen) console.log(`[P2P DEBUG] Removed stale entry for ${socket.user.name} from "${topic}" queue`);

      const currentQueue = p2pQueues.get(topic);
      console.log(`[P2P DEBUG] Current queue size for "${topic}": ${currentQueue.length}`);

      // Attempt to find a partner
      let partner = null;
      while (currentQueue.length > 0) {
        const candidate = currentQueue.shift();
        const candidateSocket = io.sockets.sockets.get(candidate.socketId);
        
        if (candidateSocket && candidate.socketId !== socket.id) {
          partner = candidate;
          console.log(`[P2P DEBUG] Found valid partner: ${partner.name} (${partner.socketId})`);
          break;
        } else {
          console.log(`[P2P DEBUG] Skipping invalid candidate: ${candidate.name} (Socket exists: ${!!candidateSocket})`);
        }
      }

      if (partner) {
        const partnerSocket = io.sockets.sockets.get(partner.socketId);
        const roomId = `p2p_${partner.userId}_${userId}_${Date.now()}`;
        const sessionData = { topic, roomId, startTime: new Date() };

        console.log(`[P2P DEBUG] Initiating match: ${socket.user.name} <-> ${partner.name} in Room ${roomId}`);

        try {
          // Join room
          socket.join(roomId);
          partnerSocket.join(roomId);
          p2pRooms.set(socket.id, roomId);
          p2pRooms.set(partnerSocket.id, roomId);

          // 🚀 Track active room
          p2pActiveRooms.set(roomId, {
            participants: [partner.userId, userId],
            topic,
            startTime: sessionData.startTime,
            roles: { [partner.userId]: "interviewer", [userId]: "candidate" }
          });

          // Notify both
          socket.emit("p2p:matched", { 
            peer: { name: partner.name, id: partner.userId, avatar: partner.avatar, role: partner.role }, 
            role: "interviewer",
            ...sessionData
          });
          
          partnerSocket.emit("p2p:matched", { 
            peer: { name: socket.user.name, id: userId, avatar: socket.user.avatar, role: socket.user.role }, 
            role: "candidate",
            ...sessionData
          });

          // Persist session
          await PeerSession.create({
            participants: [
              { user: partner.userId, role: "interviewer" },
              { user: userId, role: "candidate" }
            ],
            topic,
            roomId,
            status: "active"
          });
          console.log(`[P2P DEBUG] ✅ Match Saved & Emitted Successfully`);
        } catch (err) {
          console.error("[P2P DEBUG] ❌ Match initialization failed:", err);
          // Cleanup on fail
          socket.leave(roomId);
          partnerSocket.leave(roomId);
          p2pRooms.delete(socket.id);
          p2pRooms.delete(partnerSocket.id);
          p2pActiveRooms.delete(roomId);
        }
      } else {
        const entry = { userId, socketId: socket.id, name: socket.user.name, avatar: socket.user.avatar, role: socket.user.role };
        currentQueue.push(entry);
        console.log(`[P2P DEBUG] ⏳ Queued ${socket.user.name}. Queue size now: ${currentQueue.length}`);
      }
    });

    // 🚀 NEW: Rejoin Room Event
    socket.on("p2p:rejoin", async ({ roomId }) => {
      const roomData = p2pActiveRooms.get(roomId);
      if (!roomData || !roomData.participants.includes(userId)) {
        console.log(`[P2P] Denied rejoin request from ${socket.user.name} for room ${roomId}`);
        return socket.emit("p2p:rejoin_failed", { message: "Session no longer active or unauthorized" });
      }

      console.log(`[P2P] User ${socket.user.name} rejoining room ${roomId}`);
      
      // Clear any pending disconnect timeout
      if (disconnectTimeouts.has(userId)) {
        clearTimeout(disconnectTimeouts.get(userId));
        disconnectTimeouts.delete(userId);
      }

      socket.join(roomId);
      p2pRooms.set(socket.id, roomId);

      // Find the peer's info from current active users
      const peerId = roomData.participants.find(id => id !== userId);
      const peer = await User.findById(peerId).select("name avatar role");
      
      socket.emit("p2p:matched", {
        peer: { name: peer.name, id: peerId, avatar: peer.avatar, role: peer.role },
        role: roomData.roles[userId],
        topic: roomData.topic,
        roomId,
        startTime: roomData.startTime,
        isRejoin: true
      });

      // Notify the peer
      socket.to(roomId).emit("p2p:message", { 
        senderId: "system", 
        text: `🚀 ${socket.user.name} re-connected to the workspace.`, 
        isSystem: true 
      });
      socket.to(roomId).emit("p2p:peer_reconnected");
    });
    socket.on("p2p:leave_queue", () => {
      console.log(`[P2P DEBUG] 👋 ${socket.user.name} explicitly leaving all queues`);
      p2pQueues.forEach((queue, topic) => {
        const idx = queue.findIndex(u => u.socketId === socket.id);
        if (idx > -1) {
          queue.splice(idx, 1);
          console.log(`[P2P DEBUG] Removed from "${topic}" queue`);
        }
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

    socket.on("p2p:code_update", (code) => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) socket.to(roomId).emit("p2p:code_update", code);
    });

    socket.on("p2p:media_toggle", (data) => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) socket.to(roomId).emit("p2p:media_toggle", data);
    });

    socket.on("p2p:leave_room", async () => {
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        console.log(`[P2P DEBUG] ${socket.user.name} left room ${roomId}`);
        socket.to(roomId).emit("p2p:peer_left");
        socket.leave(roomId);
        p2pRooms.delete(socket.id);
        p2pActiveRooms.delete(roomId); // Clean up the active room tracking
        
        // Update persistent session
        await PeerSession.findOneAndUpdate({ roomId }, { status: "completed", endTime: new Date() });
      }
    });

    // =====================================================
    // 👁️ LIVE PROCTORING LOGIC
    // =====================================================
    
    socket.on("proctor:join", ({ applicationId, role }) => {
      const roomId = `proctor_${applicationId}`;
      socket.join(roomId);
      proctorRooms.set(socket.id, applicationId); // 🚀 Track proctoring room
      console.log(`👁️ [PROCTOR] ${socket.user.name} joined as ${role} for room: ${roomId}`);
      
      if (role === 'candidate') {
        socket.to(roomId).emit("proctor:candidate_online");
      } else {
        socket.to(roomId).emit("proctor:recruiter_online");
      }
    });

    socket.on("proctor:signal", ({ applicationId, signal }) => {
      const roomId = `proctor_${applicationId}`;
      socket.to(roomId).emit("proctor:signal", { signal, from: socket.id });
    });

    socket.on("proctor:alert", ({ applicationId, type, details }) => {
      const roomId = `proctor_${applicationId}`;
      socket.to(roomId).emit("proctor:alert", { type, details, timestamp: new Date() });
    });

    socket.on("proctor:warning", ({ applicationId, message }) => {
      const roomId = `proctor_${applicationId}`;
      socket.to(roomId).emit("proctor:warning", { message });
    });

    socket.on("proctor:seal", ({ applicationId }) => {
      const roomId = `proctor_${applicationId}`;
      socket.to(roomId).emit("proctor:seal");
    });

    socket.on("proctor:leave", ({ applicationId }) => {
      const roomId = `proctor_${applicationId}`;
      socket.leave(roomId);
      proctorRooms.delete(socket.id);
    });

    // =====================================================
    // 🔌 DISCONNECT
    // =====================================

    socket.on("disconnect", () => {
      // Clean P2P queues
      p2pQueues.forEach((queue, topic) => {
        const idx = queue.findIndex(u => u.socketId === socket.id);
        if (idx > -1) queue.splice(idx, 1);
      });

      // Notify P2P partner if in room (with Grace Period)
      const roomId = p2pRooms.get(socket.id);
      if (roomId) {
        p2pRooms.delete(socket.id);

        // Wait 10 seconds before telling the peer they left
        // This allows for page refreshes
        const timeoutId = setTimeout(() => {
          socket.to(roomId).emit("p2p:peer_left");
          p2pActiveRooms.delete(roomId);
          console.log(`[P2P] User ${socket.user.name} timed out of room ${roomId}`);
        }, 10000); 

        disconnectTimeouts.set(userId, timeoutId);
        socket.to(roomId).emit("p2p:peer_disconnected", { userId });
      }

      // 👁️ Notify Proctoring Room (Grace Period)
      const appId = proctorRooms.get(socket.id);
      if (appId) {
        const roomId = `proctor_${appId}`;
        const timeoutId = setTimeout(() => {
          socket.to(roomId).emit("proctor:candidate_offline");
          console.log(`👁️ [PROCTOR] Candidate ${socket.user.name} timed out of assessment.`);
        }, 12000); // 12 second grace for assessments
        
        disconnectTimeouts.set(userId, timeoutId);
        proctorRooms.delete(socket.id);
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
