import express from "express";
import mongoose from "mongoose";
import { protect, authorize } from "../middleware/auth.js";
import User from "../models/User.js";
import Job from "../models/Job.js";
import Application from "../models/Application.js";

const router = express.Router();

/* =====================================================
   ⚙️ Utility Helper
===================================================== */
const safeAggregate = async (model, pipeline, fallbackName) => {
  try {
    if (model) return await model.aggregate(pipeline);
  } catch (err) {
    console.warn(`Aggregate failed for ${fallbackName}:`, err.message);
  }
  try {
    return await mongoose.connection.collection(fallbackName).aggregate(pipeline).toArray();
  } catch {
    return [];
  }
};

/* =====================================================
   👑 Global Admin Analytics
   @route   GET /api/admin/analytics
   @access  Private (Admin / Superadmin)
===================================================== */
router.get(
  "/analytics",
  protect,
  authorize("admin", "superadmin"),
  async (req, res) => {
    try {
      /* =============================
         1️⃣ User Stats
      ============================== */
      const totalUsers = await User.countDocuments({});
      const totalCandidates = await User.countDocuments({ role: "candidate" });
      const totalRecruiters = await User.countDocuments({ role: "recruiter" });
      const totalMentors = await User.countDocuments({ role: "mentor" });
      const totalAdmins = await User.countDocuments({ role: "admin" });

      /* =============================
         2️⃣ Job & Application Stats
      ============================== */
      const totalJobs = await Job.countDocuments({});
      const activeJobs = await Job.countDocuments({ status: { $in: ["active", "approved"] } });
      const pendingJobs = await Job.countDocuments({ status: "pending" });
      const closedJobs = await Job.countDocuments({ status: "closed" });

      const totalApplications = await Application.countDocuments({});
      const hiredApplications = await Application.countDocuments({ status: "hired" });
      const shortlistedApplications = await Application.countDocuments({ status: "shortlisted" });
      const rejectedApplications = await Application.countDocuments({ status: "rejected" });

      /* =============================
         3️⃣ Monthly Job Growth (last 6 months)
      ============================== */
      const now = new Date();
      const start = new Date(now);
      start.setMonth(start.getMonth() - 5);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      const jobTrendAgg = await safeAggregate(
        Job,
        [
          { $match: { createdAt: { $gte: start } } },
          {
            $group: {
              _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
              jobs: { $sum: 1 },
            },
          },
          { $sort: { "_id.y": 1, "_id.m": 1 } },
        ],
        "jobs"
      );

      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const jobTrends = [];
      const iter = new Date(start);
      for (let i = 0; i < 6; i++) {
        const key = `${iter.getFullYear()}-${iter.getMonth() + 1}`;
        const found = jobTrendAgg.find(
          (d) => d._id.y === iter.getFullYear() && d._id.m === iter.getMonth() + 1
        );
        jobTrends.push({
          month: months[iter.getMonth()],
          year: iter.getFullYear(),
          jobs: found?.jobs || 0,
        });
        iter.setMonth(iter.getMonth() + 1);
      }

      /* =============================
         4️⃣ Top 5 Recruiters (by total job posts)
      ============================== */
      const topRecruitersAgg = await safeAggregate(
        Job,
        [
          { $group: { _id: "$postedBy", jobs: { $sum: 1 } } },
          { $sort: { jobs: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "recruiter",
            },
          },
          { $unwind: "$recruiter" },
          {
            $project: {
              _id: 0,
              name: "$recruiter.name",
              email: "$recruiter.email",
              orgName: "$recruiter.orgName",
              jobs: 1,
            },
          },
        ],
        "jobs"
      );

      const topRecruiters = topRecruitersAgg.map((r) => ({
        name: r.name || "Recruiter",
        orgName: r.orgName || "N/A",
        email: r.email,
        jobs: r.jobs,
      }));

      /* =============================
         ✅ Response
      ============================== */
      res.json({
        success: true,
        data: {
          users: {
            totalUsers,
            totalCandidates,
            totalRecruiters,
            totalMentors,
            totalAdmins,
          },
          jobs: {
            totalJobs,
            activeJobs,
            pendingJobs,
            closedJobs,
          },
          applications: {
            totalApplications,
            shortlistedApplications,
            rejectedApplications,
            hiredApplications,
          },
          jobTrends,
          topRecruiters,
        },
      });
    } catch (err) {
      console.error("Admin analytics error:", err);
      res.status(500).json({
        success: false,
        message: "Server error fetching admin analytics",
      });
    }
  }
);

export default router;
