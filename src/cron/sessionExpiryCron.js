import cron from "node-cron";
import Session from "../models/Session.js";
import { notifyUser } from "../utils/notifyUser.js";

/**
 * 🧛 Session Expiry Engine
 * Runs every 30 minutes to clean up pending requests that passed their scheduled time.
 */
export const initSessionExpiryCron = () => {
  cron.schedule("*/30 * * * *", async () => {
    console.log("🧛 Scanning for expired mentorship sessions...");

    try {
      const now = new Date();
      
      // Find all pending sessions
      const pendingSessions = await Session.find({ status: "pending" })
        .populate("mentor", "name email")
        .populate("mentee", "name email");

      for (const session of pendingSessions) {
        try {
          // Parse date and time to check if it has passed
          const timeStr = typeof session.scheduledTime === 'object' ? session.scheduledTime.startTime : session.scheduledTime;
          if (!timeStr) continue;

          const [time, modifier] = timeStr.split(' ');
          let [hours, minutes] = time.split(':');
          if (hours === '12') hours = '00';
          if (modifier === 'PM') hours = (parseInt(hours, 10) + 12).toString();
          
          const datePart = session.scheduledDate.split('T')[0];
          const scheduled = new Date(`${datePart}T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`);

          if (scheduled < now) {
            console.log(`💀 Session ${session._id} has expired. Updating status...`);
            
            session.status = "expired";
            await session.save();

            // 🔔 Notify Mentor (The "Professional Nudge")
            await notifyUser({
              userId: session.mentor._id,
              title: "⚠️ Session Request Expired",
              message: `A booking request from ${session.mentee?.name} for "${session.serviceTitle}" has expired because it wasn't accepted in time. Please update your availability to avoid missed sessions.`,
              type: "system",
              emailEnabled: true,
              emailSubject: "Action Required: Expired Session Request - OneStop Hub",
            }).catch(e => console.error("Mentor expiry notify error:", e.message));

            // 🔔 Notify Mentee (The "Soft Landing")
            await notifyUser({
              userId: session.mentee._id,
              title: "⌛ Mentorship Request Expired",
              message: `Your request to ${session.mentor?.name} for "${session.serviceTitle}" has expired. We recommend exploring other experts to find a slot that fits your schedule!`,
              link: "/mentorship/find",
              type: "system",
              emailEnabled: true,
              emailSubject: "Update on your Mentorship Request - OneStop Hub",
            }).catch(e => console.error("Mentee expiry notify error:", e.message));
          }
        } catch (innerErr) {
          console.error(`Error processing session ${session._id}:`, innerErr.message);
        }
      }

    } catch (error) {
      console.error("❌ Session Expiry Cron Error:", error);
    }
  });

  console.log("🧛 Session Expiry Engine initialized (Every 30 mins).");
};
