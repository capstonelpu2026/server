// routes/recruiterRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import Job from "../models/Job.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import AuditLog from "../models/AuditLog.js";
import { sendEmail } from "../utils/sendEmail.js";
import { notifyUser } from "../utils/notifyUser.js";
import axios from "axios";
import { performAnalysis } from "../utils/atsUtils.js";
import { resetHiringAssessment } from "../controllers/hiringAssessmentController.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const router = express.Router();

/* =====================================================
   💼 Recruiter — Create Job (POST /api/recruiter/jobs)
===================================================== */
router.post("/jobs", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const { title, description, skills = [], location, salary, type, startDate, deadline } = req.body;
    
    // Auto-approve if needed, but for now let's stick with the existing logic of status: "pending"
    const job = await Job.create({
      title,
      description,
      skills,
      location,
      salary,
      type,
      startDate,
      deadline,
      postedBy: req.user._id,
      status: "pending",
    });

    await AuditLog.create({
      action: "CREATE_JOB",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: `Recruiter ${req.user.email} created job "${title}"`,
    });

    res.status(201).json({
      message: "Job created successfully and pending admin approval ✅",
      job,
    });

    // 🚀 Background Task: Notify all candidates about the new opening
    // We do this AFTER sending the response to keep the UI snappy
    try {
      const candidates = await User.find({ role: "candidate" }).select("_id email");
      
      const notifications = candidates.map(candidate => ({
        userId: candidate._id,
        title: "💼 New Job Alert!",
        message: `${req.user.orgName || 'A recruiter'} just posted: "${title}" in ${location || 'Remote'}. Check it out!`,
        link: `/opportunities/jobs`, // Could be `/jobs/${job._id}` if job is approved immediately, but pending for now
        type: "job",
        persist: true,
        realtime: true
      }));

      // Fire and forget individual notifications
      // Note: In a massive app, use a Queue/BullMQ. For now, Promise.all is fine.
      Promise.all(notifications.map(n => notifyUser(n))).catch(err => console.error("Job Broadcast Error:", err));

    } catch (err) {
      console.error("Failed to broadcast job notification:", err);
    }

  } catch (err) {
    console.error("Error creating job:", err);
    res.status(500).json({ message: "Error creating job", error: err.message });
  }
});

/* =====================================================
   📦 Recruiter — Get all My Jobs (GET /api/recruiter/jobs)
===================================================== */
router.get("/jobs", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const jobs = await Job.find({ postedBy: req.user._id }).sort({ createdAt: -1 });
    res.json({ jobs });
  } catch (err) {
    console.error("Error fetching recruiter jobs:", err);
    res.status(500).json({ message: "Error fetching jobs" });
  }
});

/* =====================================================
   📄 Recruiter — Get Single Job (GET /api/recruiter/jobs/:id)
===================================================== */
router.get("/jobs/:id", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    res.json({ job });
  } catch (err) {
    console.error("Error fetching job:", err);
    res.status(500).json({ message: "Error fetching job" });
  }
});

/* =====================================================
   ✏️ Recruiter — Update Job (PATCH /api/recruiter/jobs/:id)
===================================================== */
router.patch("/jobs/:id", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    const allowedFields = ["title", "description", "skills", "location", "salary", "type", "status"];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) job[field] = req.body[field];
    });

    await job.save();

    await AuditLog.create({
      action: "UPDATE_JOB",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: `Recruiter ${req.user.email} updated job "${job.title}" (${job._id})`,
    });

    res.json({ message: "Job updated successfully", job });
  } catch (err) {
    console.error("Error updating job:", err);
    res.status(500).json({ message: "Error updating job" });
  }
});

/* =====================================================
   🔁 Recruiter — Change Job Status (PATCH /jobs/:id/status)
===================================================== */
router.patch("/jobs/:id/status", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["active", "pending", "closed", "archived"];

    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status value" });

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    job.status = status;
    await job.save();

    await AuditLog.create({
      action: "UPDATE_JOB_STATUS",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: `Job "${job.title}" status changed to ${status}`,
    });

    res.json({ message: "Status updated", job });
  } catch (err) {
    console.error("Error updating job status:", err);
    res.status(500).json({ message: "Error updating job status" });
  }
});

/* =====================================================
   🗑 Recruiter — Delete Job (DELETE /jobs/:id)
===================================================== */
router.delete("/jobs/:id", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    await job.deleteOne();

    await AuditLog.create({
      action: "DELETE_JOB",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: `Recruiter ${req.user.email} deleted job "${job.title}" (${job._id})`,
    });

    res.json({ message: "Job deleted" });
  } catch (err) {
    console.error("Error deleting job:", err);
    res.status(500).json({ message: "Error deleting job" });
  }
});

/* =====================================================
   📋 Recruiter — View Applications of a Job
===================================================== */
router.get("/jobs/:id/applications", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    const applications = await Application.find({ job: job._id })
      .populate("candidate", "name email")
      .sort({ createdAt: -1 });

    res.json(applications);
  } catch (err) {
    console.error("Error fetching applications:", err);
    res.status(500).json({ message: "Error fetching applications" });
  }
});

/* =====================================================
   🧠 Recruiter — Update Application Status
===================================================== */
router.patch("/applications/:id/status", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const { status, customMessage, offerDetails, hiredDetails, interviewDetails, rejectionFeedback } = req.body;
    const validStatuses = ["applied", "shortlisted", "assessment", "interviewing", "offered", "hired", "rejected"];

    if (!validStatuses.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const application = await Application.findById(req.params.id)
      .populate("candidate", "name email")
      .populate("job", "title postedBy");

    if (!application) return res.status(404).json({ message: "Application not found" });

    const job = application.job;
    if (String(job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    application.status = status;
    
    if (offerDetails) application.offerDetails = offerDetails;
    if (hiredDetails) application.hiredDetails = hiredDetails;
    if (interviewDetails) application.interviewDetails = interviewDetails;
    if (rejectionFeedback) application.rejectionFeedback = rejectionFeedback;

    await application.save();

    // Email + Notification
    let subject = "";
    let baseBody = "";

    if (status === "shortlisted") {
      subject = "🎯 Application Shortlisted - OneStop Hub";
      baseBody = `Hello ${application.candidate.name},\n\nYour application for "${job.title}" has been shortlisted!`;
    } else if (status === "rejected") {
      subject = "❌ Application Update - OneStop Hub";
      baseBody = `Hello ${application.candidate.name},\n\nYour application for "${job.title}" was not shortlisted.`;
    } else if (status === "hired") {
      subject = "🎉 Congratulations! You're Hired - OneStop Hub";
      baseBody = `Hello ${application.candidate.name},\n\nYou have been hired for "${job.title}".`;
    }

    // Append custom message if provided
    let finalBody = baseBody;
    if (customMessage) {
      finalBody += `\n\nNote from Recruiter:\n"${customMessage}"`;
    }
    finalBody += "\n\n— OneStop Hub";

    await sendEmail(application.candidate.email, subject, finalBody);
    await notifyUser({
      userId: application.candidate._id,
      title: subject,
      message: customMessage || baseBody.replace(/\n/g, " "),
      type: "candidate",
    });

    await AuditLog.create({
      action: "UPDATE_APPLICATION_STATUS",
      performedBy: req.user._id,
      targetUser: application.candidate._id,
      details: `Application for "${job.title}" marked as ${status}`,
    });

    res.json({ message: `Status updated to ${status}`, application });
  } catch (err) {
    console.error("Error updating application status:", err);
    res.status(500).json({ message: "Error updating application status" });
  }
});

/* =====================================================
   💬 Notify Candidate (manual)
===================================================== */
router.post("/applications/:id/notify", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const { message } = req.body;

    const application = await Application.findById(req.params.id)
      .populate("candidate", "name email")
      .populate("job", "title postedBy");

    if (!application) return res.status(404).json({ message: "Application not found" });

    if (String(application.job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    await sendEmail(
      application.candidate.email,
      `Message Regarding "${application.job.title}"`,
      `Hello ${application.candidate.name},\n\n${message}\n\n— ${req.user.name}`
    );
    await notifyUser({
      userId: application.candidate._id,
      title: "New Message from Recruiter",
      message,
      type: "candidate",
    });

    await AuditLog.create({
      action: "NOTIFY_CANDIDATE",
      performedBy: req.user._id,
      targetUser: application.candidate._id,
      details: `Recruiter messaged about "${application.job.title}"`,
    });

    res.json({ message: "Candidate notified" });
  } catch (err) {
    console.error("Error notifying candidate:", err);
    res.status(500).json({ message: "Error notifying candidate" });
  }
});

/* =====================================================
   ⚙ Recruiter Profile (GET & PATCH)
===================================================== */
router.get("/rpanel/profile", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name email mobile orgName avatar companyWebsite companyDescription"
    );

    res.json(user);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Error fetching profile" });
  }
});

router.patch("/rpanel/profile", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const updates = {
      name: req.body.name,
      mobile: req.body.mobile,
      orgName: req.body.orgName,
      avatar: req.body.avatar,
      companyWebsite: req.body.companyWebsite,
      companyDescription: req.body.companyDescription,
    };

    const updated = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      select:
        "name email mobile orgName avatar companyWebsite companyDescription",
    });

    await AuditLog.create({
      action: "UPDATE_RECRUITER_PROFILE",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: "Recruiter updated profile",
    });

    res.json({ message: "Profile updated successfully", recruiter: updated });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ message: "Error updating recruiter profile" });
  }
});

/* =====================================================
   📊 Analytics (GET /api/recruiter/analytics)
===================================================== */
router.get("/analytics", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const jobs = await Job.find({ postedBy: req.user._id }).select("_id");
    const jobIds = jobs.map((j) => j._id);

    const countAgg = await Application.aggregate([
      { $match: { job: { $in: jobIds } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const counts = { applied: 0, shortlisted: 0, rejected: 0, hired: 0 };
    countAgg.forEach((c) => (counts[c._id] = c.count));

    const last7 = new Date();
    last7.setDate(last7.getDate() - 7);

    const trendsAgg = await Application.aggregate([
      { $match: { job: { $in: jobIds }, createdAt: { $gte: last7 } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          applications: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      totalJobs: jobs.length,
      totalApplications:
        counts.applied + counts.shortlisted + counts.rejected + counts.hired,
      hiredCount: counts.hired,
      counts,
      trends: trendsAgg,
    });
  } catch (err) {
    console.error("Error fetching analytics:", err);
    res.status(500).json({ message: "Error fetching analytics" });
  }
});

/* =====================================================
   📊 Overview Dashboard (GET /rpanel/overview)
===================================================== */
router.get("/rpanel/overview", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const recentJobs = await Job.find({ postedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5);

    const totalJobs = await Job.countDocuments({ postedBy: req.user._id });

    const totalApps = await Application.countDocuments({
      job: { $in: recentJobs.map((j) => j._id) },
    });

    const hired = await Application.countDocuments({
      job: { $in: recentJobs.map((j) => j._id) },
      status: "hired",
    });

    res.json({
      totalJobs,
      totalApplications: totalApps,
      hiredCount: hired,
      recentJobs,
    });
  } catch (err) {
    console.error("Error fetching overview:", err);
    res.status(500).json({ message: "Error fetching overview" });
  }
});

/* =====================================================
   📦 All Applications (GET /api/recruiter/applications)
===================================================== */
router.get("/applications", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const jobs = await Job.find({ postedBy: req.user._id }).select("_id");
    const jobIds = jobs.map((j) => j._id);

    const applications =
      jobIds.length === 0
        ? []
        : await Application.find({ job: { $in: jobIds } })
            .populate("job", "title")
            .populate("candidate", "name email")
            .sort({ createdAt: -1 });

    res.json({ applications });
  } catch (err) {
    console.error("Error fetching recruiter applications:", err);
    res.status(500).json({ message: "Error fetching recruiter applications" });
  }
});

/* =====================================================
   🤖 Recruiter — Analyze Resume (AI Scan)
===================================================== */
router.post("/applications/:id/analyze", protect, authorize(["recruiter"]), async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).populate("job");
    if (!application) return res.status(404).json({ message: "Application not found" });

    // Verify ownership
    if (String(application.job.postedBy) !== String(req.user._id))
      return res.status(403).json({ message: "Not authorized" });

    if (!application.resumeUrl)
      return res.status(400).json({ message: "No resume URL found for this application." });

    // 1. Fetch PDF from Cloudinary
    const response = await axios.get(application.resumeUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // 2. Parse PDF
    const data = await pdf(buffer);
    const text = data.text;

    // 3. Analyze
    const result = performAnalysis(text);

    // 4. Update Application
    application.atsScore = result.score;
    application.atsVerdict = result.verdict;
    await application.save();

    res.json({ 
      message: "Resume analyzed successfully", 
      result 
    });

  } catch (err) {
    console.error("Error analyzing application resume:", err);
    res.status(500).json({ message: "Error analyzing resume" });
  }
});

/* =====================================================
   🔄 Recruiter — Reset Assessment (Re-conduct)
===================================================== */
router.post("/applications/:applicationId/assessment/reset", protect, authorize(["recruiter"]), resetHiringAssessment);

export default router;
