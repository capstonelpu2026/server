import Notification from "../models/Notification.js";
import { getIO } from "../socket.js";

/* =====================================================
   📩 Create a new notification (system-wide helper)
   -----------------------------------------------------
   Used internally when the backend needs to push a new
   notification to a user and emit it in real-time.
===================================================== */
export const createNotification = async (
  userId,
  title,
  message,
  type = "system",
  metadata = {}
) => {
  try {
    // 🧾 Save to MongoDB
    const notif = await Notification.create({
      user: userId,
      title,
      message,
      type,
      metadata,
    });

    // 🔔 Emit to user's socket room in real time
    const io = getIO();
    if (io) {
      io.to(userId.toString()).emit("notification:new", notif);
      console.log(`📢 Sent notification to ${userId}: ${title}`);
    }

    return notif;
  } catch (err) {
    console.error("❌ Error creating notification:", err);
    throw err;
  }
};

/* =====================================================
   📬 Get all notifications (for logged user)
===================================================== */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({ user: userId }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching notifications" });
  }
};

/* =====================================================
   📮 Mark single notification as read
===================================================== */
export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notif = await Notification.findById(id);

    if (!notif)
      return res.status(404).json({ success: false, message: "Notification not found" });
    if (notif.user.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: "Not authorized" });

    notif.read = true;
    await notif.save();

    res.json({
      success: true,
      message: "Notification marked as read ✅",
      notif,
    });
  } catch (err) {
    console.error("❌ Error updating notification:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update notification" });
  }
};

/* =====================================================
   📦 Mark all notifications as read
===================================================== */
export const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany(
      { user: userId, read: false },
      { $set: { read: true } }
    );

    res.json({
      success: true,
      message: "All notifications marked as read ✅",
    });
  } catch (err) {
    console.error("❌ Error marking all notifications read:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to mark all read" });
  }
};

/* =====================================================
   🗑️ Clear all notifications (optional)
===================================================== */
export const clearNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.deleteMany({ user: userId });

    res.json({
      success: true,
      message: "All notifications cleared 🧹",
    });
  } catch (err) {
    console.error("❌ Error clearing notifications:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to clear notifications" });
  }
};
