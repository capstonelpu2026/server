import cron from "node-cron";
import User from "../models/User.js";
import { notifyUser } from "../utils/notifyUser.js";

/**
 * 🎖 OneStop Verification Engine
 * Runs daily at 2:00 AM.
 * 1. Candidates with 30+ days streak -> Elite Status.
 * 2. Mentors with 4.8+ rating and 10+ reviews -> Elite Status.
 */
export const initVerificationCron = () => {
  cron.schedule("0 2 * * *", async () => {
    console.log("🕵️ Auditing platform verification statuses...");
    
    try {
      // 🎓 Candidate Audit
      const candidates = await User.find({ 
        role: "candidate", 
        attendanceStreak: { $gte: 30 },
        verificationStatus: { $ne: "elite" }
      });

      for (const user of candidates) {
        user.verificationStatus = "elite";
        user.isElite = true;
        await user.save();

        await notifyUser({
          userId: user._id,
          title: "🎖 You are officially ELITE!",
          message: "Congratulations! Your 30-day consistency has earned you the OneStop Verified Elite badge. Top recruiters can now see your dedication.",
          type: "system",
          emailEnabled: true,
          emailSubject: "Welcome to the Elite Tier - OneStop Hub"
        });
        console.log(`✅ Awarded ELITE status to Candidate: ${user.email}`);
      }

      // 🧑‍🏫 Mentor Audit
      const mentors = await User.find({ 
        role: "mentor", 
        averageMentorRating: { $gte: 4.8 },
        totalReviews: { $gte: 10 },
        verificationStatus: { $ne: "elite" }
      });

      for (const user of mentors) {
        user.verificationStatus = "elite";
        user.isElite = true;
        await user.save();

        await notifyUser({
          userId: user._id,
          title: "🧑‍🏫 Certified OneStop Master!",
          message: "Your excellent mentorship reviews have earned you the Master badge. You are now a top-tier verified mentor.",
          type: "system"
        });
        console.log(`✅ Awarded ELITE status to Mentor: ${user.email}`);
      }

    } catch (error) {
      console.error("❌ Verification Cron Error:", error);
    }
  });

  console.log("🎖 Verification Audit Cron Job initialized.");
};
