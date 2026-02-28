import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import Job from "../models/Job.js";
import CodingContest from "../models/CodingContest.js";

/**
 * 📡 GET PLATFORM PULSE
 * Returns latest significant activities for the global feed
 */
export const getPlatformPulse = async (req, res) => {
  try {
    const activities = await AuditLog.find({
      action: { $in: ["USER_REGISTERED", "JOB_POSTED", "CONTEST_CREATED", "CERTIFICATE_CLAIMED", "MENTOR_APPROVED", "CONTEST_JOINED", "INTERVIEW_COMPLETED"] }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate("targetUser", "name avatar role")
    .populate("performedBy", "name avatar role");

    res.json(activities);
  } catch (err) {
    console.error("Pulse error:", err);
    res.status(500).json({ message: "Error fetching platform pulse" });
  }
};

/**
 * 📊 GET PLATFORM STATS
 * Returns high-level numbers for the ecosystem monitor
 */
export const getPlatformStats = async (req, res) => {
  try {
    const [userCount, jobCount, contestCount, hireCount] = await Promise.all([
      User.countDocuments(),
      Job.countDocuments(),
      CodingContest.countDocuments(),
      AuditLog.countDocuments({ action: "CANDIDATE_HIRED" })
    ]);

    res.json({
      activeProfessionals: userCount + 1240, // baseline + real
      globalOpportunities: jobCount + 45,
      competitionsLive: contestCount,
      careerMilestones: hireCount + 890
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ message: "Error fetching stats" });
  }
};
/**
 * 🎓 GET TOP TALENT
 * Returns highest performing candidates across all contests
 */
export const getTopTalent = async (req, res) => {
  try {
    // 1. Get all participants from all contests to aggregate scores
    const contests = await CodingContest.find({}, { participants: 1 });
    const talentMap = {};

    contests.forEach(contest => {
      (contest.participants || []).forEach(p => {
        const uid = p.userId.toString();
        if (!talentMap[uid]) {
          talentMap[uid] = {
            name: p.name,
            totalScore: 0,
            userId: p.userId,
            count: 0
          };
        }
        talentMap[uid].totalScore += (p.totalScore || 0);
        talentMap[uid].count += 1;
      });
    });

    // 2. Sort and take top performers
    let topPerformers = Object.values(talentMap)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 5);

    // 3. Fallback: If no contest data yet, pull latest registered candidates
    if (topPerformers.length < 3) {
      const latestUsers = await User.find({ role: { $in: ["candidate", "student"] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name avatar");
      
      const converted = latestUsers.map((u, i) => ({
        name: u.name,
        score: 90 - (i * 2),
        role: "New Pioneer",
        userId: u._id,
        avatar: u.avatar
      }));
      
      // Combine but prioritize real performers
      topPerformers = [...topPerformers.map(t => ({
        name: t.name,
        score: 95 + Math.floor(Math.random() * 5),
        role: "Elite Defender",
        userId: t.userId
      })), ...converted].slice(0, 5);
    }

    res.json(topPerformers);
  } catch (err) {
    console.error("Top talent error:", err);
    res.status(500).json({ message: "Error fetching talent" });
  }
};
