import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import Job from "../models/Job.js";
import Application from "../models/Application.js";

const router = express.Router();

router.get("/", protect, authorize("recruiter"), async (req, res) => {
  try {
    const recruiterId = req.user._id;

    const jobs = await Job.find({ postedBy: recruiterId });
    const jobIds = jobs.map((j) => j._id);

    if (jobIds.length === 0)
      return res.json({
        pending: 0,
        shortlisted: 0,
        rejected: 0,
        hired: 0,
        conversionRate: 0,
        trends: [],
        topJobs: [],
      });

    const statusCounts = await Application.aggregate([
      { $match: { job: { $in: jobIds } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const counts = {
      pending: statusCounts.find((s) => s._id === "applied")?.count || 0,
      shortlisted: statusCounts.find((s) => s._id === "shortlisted")?.count || 0,
      rejected: statusCounts.find((s) => s._id === "rejected")?.count || 0,
      hired: statusCounts.find((s) => s._id === "hired")?.count || 0,
    };

    const conversionRate =
      counts.shortlisted > 0 ? Math.round((counts.hired / counts.shortlisted) * 100) : 0;

    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);

    const trends = await Application.aggregate([
      { $match: { job: { $in: jobIds }, createdAt: { $gte: last30 } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          applications: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const topJobs = await Application.aggregate([
      { $match: { job: { $in: jobIds } } },
      { $group: { _id: "$job", applications: { $sum: 1 } } },
      { $sort: { applications: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "jobs",
          localField: "_id",
          foreignField: "_id",
          as: "jobInfo",
        },
      },
      { $unwind: "$jobInfo" },
      {
        $project: {
          title: "$jobInfo.title",
          applications: 1,
        },
      },
    ]);

    const totalApplications = counts.pending + counts.shortlisted + counts.rejected + counts.hired;

    res.json({
      totalJobs: jobs.length,
      totalApplications,
      hiredCount: counts.hired,
      counts: {
        applied: counts.pending,
        shortlisted: counts.shortlisted,
        rejected: counts.rejected,
        hired: counts.hired
      },
      conversionRate,
      trends,
      topJobs,
    });
  } catch (err) {
    console.error("Analytics Error:", err);
    res.status(500).json({ message: "Server error loading analytics" });
  }
});

export default router;
