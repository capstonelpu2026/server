import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import Job from "../models/Job.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { sendEmail } from "../utils/sendEmail.js";
import { notifyUser } from "../utils/notifyUser.js";

const router = express.Router();

/* =====================================================
   👑 Admin — Get All Jobs
===================================================== */
router.get("/jobs", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const jobs = await Job.find().populate("postedBy", "name email role orgName mobile").populate("applicants");
    res.json(jobs);
  } catch (err) {
    console.error("Error fetching jobs:", err);
    res.status(500).json({ message: "Error fetching jobs" });
  }
});

/* =====================================================
   ✅ Approve Job
===================================================== */
router.patch("/jobs/:id/approve", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate("postedBy", "name email");
    if (!job) return res.status(404).json({ message: "Job not found" });

    job.status = "approved";
    await job.save();

    await AuditLog.create({
      action: "APPROVE_JOB",
      performedBy: req.user._id,
      targetUser: job.postedBy._id,
      details: `Job "${job.title}" approved by admin`,
    });

    // ✉️ Notify Recruiter via Email
    await sendEmail(
      job.postedBy.email,
      "Job Approved - OneStop Hub",
      `Hello ${job.postedBy.name},\n\nYour job "${job.title}" has been approved and is now live!\n\n— OneStop Hub`
    );

    // 🔔 In-App Notification
    await notifyUser({
      userId: job.postedBy._id,
      title: "Job Approved ✅",
      message: `Your job "${job.title}" has been approved and is now visible to candidates.`,
      type: "job",
    });

    res.json({ message: "Job approved successfully ✅" });
  } catch (err) {
    console.error("Approve job error:", err);
    res.status(500).json({ message: "Error approving job" });
  }
});

/* =====================================================
   🛑 Close Job (Admin)
===================================================== */
router.patch("/jobs/:id/close", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate("postedBy", "name email");
    if (!job) return res.status(404).json({ message: "Job not found" });

    job.status = "closed";
    await job.save();

    await AuditLog.create({
      action: "CLOSE_JOB",
      performedBy: req.user._id,
      targetUser: job.postedBy._id,
      details: `Job "${job.title}" closed by admin`,
    });

    // ✉️ Email Recruiter
    await sendEmail(
      job.postedBy.email,
      "Job Closed - OneStop Hub",
      `Hello ${job.postedBy.name},\n\nYour job "${job.title}" has been closed by admin.\nFor more info, contact support.\n\n— OneStop Hub`
    );

    // 🔔 In-App Notification
    await notifyUser({
      userId: job.postedBy._id,
      title: "Job Closed ⚠️",
      message: `Your job "${job.title}" has been closed by admin.`,
      type: "job",
    });

    res.json({ message: "Job closed successfully ⚠️" });
  } catch (err) {
    console.error("Close job error:", err);
    res.status(500).json({ message: "Error closing job" });
  }
});

/* =====================================================
   📤 Admin — Notify Candidate Manually (Optional)
===================================================== */
router.post("/jobs/:id/notify-candidate", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const { candidateId, message } = req.body;
    const job = await Job.findById(req.params.id);
    const candidate = await User.findById(candidateId);

    if (!job || !candidate)
      return res.status(404).json({ message: "Job or candidate not found" });

    // ✉️ Send Email
    await sendEmail(
      candidate.email,
      "Job Application Update",
      `Hello ${candidate.name},\n\n${message}\n\n— OneStop Hub`
    );

    // 🔔 In-App Notification
    await notifyUser({
      userId: candidate._id,
      title: "Job Application Update 📩",
      message: message || `Your application for "${job.title}" has been updated.`,
      type: "candidate",
    });

    res.json({ message: "Candidate notified successfully 📩" });
  } catch (err) {
    console.error("Notify candidate error:", err);
    res.status(500).json({ message: "Error notifying candidate" });
  }
});

/* =====================================================
   🗑️ Delete Job (SuperAdmin Only)
      PERMANENTLY DELETE FROM DATABASE
===================================================== */
router.delete("/jobs/:id", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const jobTitle = job.title;
    const postedBy = job.postedBy;

    // Permanently Delete
    await Job.findByIdAndDelete(req.params.id);

    // Audit Log
    await AuditLog.create({
      action: "DELETE_JOB",
      performedBy: req.user._id,
      targetUser: postedBy,
      details: `Job "${jobTitle}" permanently deleted by SuperAdmin`,
    });

    res.json({ message: "Job permanently deleted along with all applications." });
  } catch (err) {
    console.error("Delete job error:", err);
    res.status(500).json({ message: "Error deleting job" });
  }
});

export default router;
