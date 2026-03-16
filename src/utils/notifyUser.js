// src/utils/notifyUser.js
import Notification from "../models/Notification.js";
import { sendEmail } from "./sendEmail.js";
import User from "../models/User.js";

let globalIO = null;

export const setSocketInstance = (ioInstance) => {
  globalIO = ioInstance;
  console.log("🔗 Global Socket.io instance linked to notifyUser.js");
};

/**
 * 🔔 Smart Universal Notification Utility
 */
export const notifyUser = async ({
  userId = null,
  email = null,
  title,
  message,
  link = "",
  type = "system",
  emailSubject = "Notification from OneStop Hub",
  emailHtml = "",
  broadcast = false,
  persist = true,
  emailEnabled = false,
  realtime = true,
  aggregationKey = null,
}) => {
  try {
    let notificationDoc = null;
    let targetUser = null;

    if (userId && !broadcast) {
      targetUser = await User.findById(userId).select("email notificationSettings");
    }

    if (persist && userId) {
      if (aggregationKey) {
        const existing = await Notification.findOne({ user: userId, aggregationKey, read: false });
        if (existing) {
          existing.count += 1;
          existing.message = `${title} (${existing.count} total updates)`;
          existing.createdAt = new Date();
          notificationDoc = await existing.save();
        }
      }

      if (!notificationDoc) {
        notificationDoc = await Notification.create({
          user: userId,
          title,
          message,
          link,
          type,
          aggregationKey,
          read: false,
        });
      }
    }

    const canSendEmail = broadcast || (targetUser?.notificationSettings?.email?.[type] !== false);
    const userEmail = email || targetUser?.email;

    if (emailEnabled && userEmail && canSendEmail) {
      const html = emailHtml || `
        <div style="font-family:'Segoe UI',sans-serif;padding:20px;max-width:600px;margin:auto;border:1px solid #eee;border-radius:12px;">
          <h2 style="color:#6366f1;">${title}</h2>
          <p style="font-size:1rem;color:#333;line-height:1.6;">${message}</p>
          ${link ? `<div style="margin-top:25px;"><a href="${process.env.FRONTEND_URL}${link}" style="background:#6366f1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;">View Update →</a></div>` : ""}
          <hr style="border:none;border-top:1px solid #eee;margin-top:30px;" />
          <p style="font-size:0.75rem;color:#999;">Manage your alerts in OneStop Hub Profile Settings.</p>
        </div>
      `;
      await sendEmail(userEmail, emailSubject, html, true);
    }

    const canSendRealtime = broadcast || (targetUser?.notificationSettings?.inApp?.[type] !== false);
    
    if (realtime && globalIO && canSendRealtime) {
      const payload = {
        _id: notificationDoc?._id || Date.now().toString(),
        title: notificationDoc?.title || title,
        message: notificationDoc?.message || message,
        link,
        type,
        count: notificationDoc?.count || 1,
        read: false,
        createdAt: new Date(),
      };

      if (broadcast) {
        globalIO.emit("notification:new", payload);
      } else if (userId) {
        globalIO.to(userId.toString()).emit("notification:new", payload);
      }
    }

    return notificationDoc;
  } catch (err) {
    console.error("❌ notifyUser error:", err.message);
  }
};

/**
 * 🌍 Broadcast Helper
 */
export const broadcastNotification = async ({
  title,
  message,
  link = "",
  type = "system",
  realtime = true,
  persist = false,
}) => {
  try {
    if (persist) {
      await Notification.create({ user: null, title, message, link, type });
    }

    if (realtime && globalIO) {
      const payload = {
        _id: Date.now().toString(),
        title,
        message,
        link,
        type,
        read: false,
        createdAt: new Date(),
      };
      globalIO.emit("notification:new", payload);
    }
  } catch (err) {
    console.error("❌ broadcastNotification error:", err.message);
  }
};

/**
 * 🛰️ Global Activity Pulse Emitter
 */
export const emitPlatformPulse = (activity) => {
  if (globalIO) {
    const significantActions = [
      "USER_REGISTERED", "JOB_POSTED", "CONTEST_CREATED", 
      "CERTIFICATE_CLAIMED", "MENTOR_APPROVED", "CONTEST_JOINED", 
      "INTERVIEW_COMPLETED", "CANDIDATE_HIRED"
    ];

    if (significantActions.includes(activity.action)) {
      globalIO.emit("pulse:new", activity);
    }
  }
};