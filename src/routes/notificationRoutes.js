// src/routes/notificationRoutes.js
import express from "express";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/auth.js";
import { notifyUser } from "../utils/notifyUser.js";

const router = express.Router();

/* =====================================================
   📬 Get Notifications (Authenticated)
===================================================== */
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ count: notifications.length, notifications });
  } catch (err) {
    res.status(500).json({ message: "Failed to load notifications" });
  }
});

/* =====================================================
   📩 Mark all as read
===================================================== */
router.patch("/mark-all/read", protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id }, { $set: { read: true } });
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update notifications" });
  }
});

/* =====================================================
   🗑️ Delete single notification
===================================================== */
router.delete("/:id", protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete notification" });
  }
});

/* =====================================================
   🔔 Admin/Server Send Notification
===================================================== */
router.post("/send", async (req, res) => {
  try {
    const { userId, title, message, email } = req.body;
    if (!userId || !title || !message)
      return res.status(400).json({ message: "Missing fields" });

    const notification = await notifyUser({
      userId,
      title,
      message,
      email,
      sendEmailFlag: !!email,
    });

    res.status(201).json({ message: "Notification sent", notification });
  } catch (err) {
    console.error("Send notification error:", err);
    res.status(500).json({ message: "Error sending notification" });
  }
});

export default router;
