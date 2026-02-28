// src/models/AuditLog.js
import mongoose from "mongoose";
import { emitPlatformPulse } from "../utils/notifyUser.js";

/**
 * 🧾 Audit Log Schema
 * --------------------------------------
 * Tracks all system actions for accountability, debugging,
 * and analytics (admin approvals, job actions, login events, etc.)
 *
 * Example:
 * await AuditLog.create({
 *   action: "RECRUITER_APPROVED",
 *   targetUser: recruiter._id,
 *   targetUserSnapshot: {
 *     name: recruiter.name,
 *     email: recruiter.email,
 *     role: recruiter.role,
 *   },
 *   performedBy: req.user._id,
 *   performedBySnapshot: {
 *     name: req.user.name,
 *     email: req.user.email,
 *     role: req.user.role,
 *   },
 *   details: `Recruiter ${recruiter.email} approved by ${req.user.email}`,
 *   context: { ip: req.ip, userAgent: req.headers["user-agent"] },
 * });
 */

const auditLogSchema = new mongoose.Schema(
  {
    // 🎯 The action performed
    action: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // 👤 The user affected by the action (if applicable)
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // 💼 If action relates to a job or entity
    targetJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },

    // 🧍 Snapshot of affected user at time of action
    targetUserSnapshot: {
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      role: { type: String, trim: true },
    },

    // 👑 The user who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🧾 Snapshot of performer (name/email/role at time of action)
    performedBySnapshot: {
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      role: { type: String, trim: true },
    },

    // 🧠 Detailed message, reason, or metadata
    details: {
      type: String,
      trim: true,
      default: "",
    },

    // 🌍 Context data (for analytics / forensics)
    context: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      location: { type: String, default: "" },
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
  }
);

/* =====================================================
   🔁 Pre-Save Normalization
===================================================== */
auditLogSchema.pre("save", function (next) {
  if (this.targetUserSnapshot?.email) {
    this.targetUserSnapshot.email = this.targetUserSnapshot.email.toLowerCase();
  }
  if (this.performedBySnapshot?.email) {
    this.performedBySnapshot.email = this.performedBySnapshot.email.toLowerCase();
  }
  next();
});

/* =====================================================
   ⚡ Indexes for Performance (admin analytics)
===================================================== */
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ "performedBySnapshot.email": 1 });
auditLogSchema.index({ "targetUserSnapshot.email": 1 });
auditLogSchema.index({ performedBy: 1 });
auditLogSchema.index({ targetUser: 1 });
auditLogSchema.index({ targetJob: 1 });

/* =====================================================
   🧠 Static Helper (Optional)
   - Creates a clean audit record automatically
===================================================== */
auditLogSchema.statics.record = async function ({
  action,
  targetUser,
  targetJob,
  performedBy,
  details = "",
  context = {},
}) {
  try {
    const performer = await mongoose.model("User").findById(performedBy);
    let targetUserSnapshot = null;
    let performedBySnapshot = null;

    if (targetUser) {
      const target = await mongoose.model("User").findById(targetUser);
      if (target) {
        targetUserSnapshot = {
          name: target.name,
          email: target.email,
          role: target.role,
        };
      }
    }

    if (performer) {
      performedBySnapshot = {
        name: performer.name,
        email: performer.email,
        role: performer.role,
      };
    }

    const log = await this.create({
      action,
      targetUser,
      targetJob,
      targetUserSnapshot,
      performedBy,
      performedBySnapshot,
      details,
      context,
    });

    // 🛰️ Emit real-time pulse
    emitPlatformPulse(log);

    return log;
  } catch (err) {
    console.error("❌ Failed to record audit log:", err.message);
  }
};

/* =====================================================
   ✅ Model Export
===================================================== */
const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
