import cron from "node-cron";
import User from "../models/User.js";
import { notifyUser } from "../utils/notifyUser.js";

/**
 * ⏰ Contest Reminder Engine
 * Runs every 5 minutes and checks if any user has a reminder for a contest 
 * starting in the next 30-35 minutes.
 */
export const initContestReminderCron = () => {
  cron.schedule("*/5 * * * *", async () => {
    console.log("🔔 Checking for upcoming contest reminders...");
    
    try {
      const now = new Date();
      const thirtyMinutesFromNow = new Date(now.getTime() + 35 * 60000);
      const threshold = new Date(now.getTime() + 25 * 60000);

      // Find users who have reminders in this window and haven't been notified
      const users = await User.find({
        "contestReminders": {
          $elemMatch: {
            startTime: { $gte: threshold, $lte: thirtyMinutesFromNow },
            notified: false
          }
        }
      });

      for (const user of users) {
        for (const reminder of user.contestReminders) {
          // Check if this specific reminder is in the window and not notified
          if (
            reminder.startTime >= threshold && 
            reminder.startTime <= thirtyMinutesFromNow && 
            !reminder.notified
          ) {
            console.log(`📡 Sending reminder to ${user.email} for ${reminder.title}`);

            // Send Real-time Socket + DB Persistence + Email
            await notifyUser({
              userId: user._id,
              title: "🚀 Contest Starting Soon!",
              message: `Your contest "${reminder.title}" on ${reminder.platform} starts in about 30 minutes. Get ready!`,
              type: "system", // Use 'system' so it bypasses social filters if they have them off
              emailEnabled: true,
              emailSubject: `Reminder: ${reminder.title} starts in 30 mins!`,
            });

            // Mark as notified in DB
            reminder.notified = true;
          }
        }
        await user.save();
      }
    } catch (error) {
      console.error("❌ Contest Reminder Cron Error:", error);
    }
  });

  console.log("⏰ Contest Reminder Cron Job initialized (Runs every 5 mins).");
};
