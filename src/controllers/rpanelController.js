// controllers/rpanelController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Event from "../models/Event.js";
import AuditLog from "../models/AuditLog.js";
import Job from "../models/Job.js";
import Notification from "../models/Notification.js";
import Message from "../models/Message.js";
import Application from "../models/Application.js";
import { sendEmail } from "../utils/sendEmail.js";
import {
  candidateHiredTemplate,
  candidateShortlistedTemplate,
  candidateInterviewTemplate,
  candidateRejectedTemplate,
  candidateOfferedTemplate
} from "../utils/emailTemplates.js";

const toObjectId = (id) => new mongoose.Types.ObjectId(id);
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/* ---------------------------------------------------------
   GET /api/rpanel/ping
--------------------------------------------------------- */
export const ping = (_req, res) => {
  res.json({ ok: true, service: "Recruiter Panel API", ts: Date.now() });
};

/* ---------------------------------------------------------
   🔥 GET /api/rpanel/overview
   Fully compatible with your RecruiterOverview.jsx
--------------------------------------------------------- */
export const getOverview = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);

    // FIXED: use postedBy not createdBy
    const jobs = await Job.find({ postedBy: recruiterId })
      .sort({ createdAt: -1 })
      .lean();

    const jobIds = jobs.map((j) => j._id);

    // Counts
    const totalJobs = jobs.length;
    const totalApplications = jobIds.length
      ? await Application.countDocuments({ job: { $in: jobIds } })
      : 0;

    const totalShortlisted = jobIds.length
      ? await Application.countDocuments({
          job: { $in: jobIds },
          status: "shortlisted",
        })
      : 0;

    const totalHired = jobIds.length
      ? await Application.countDocuments({
          job: { $in: jobIds },
          status: "hired",
        })
      : 0;

    // Recent jobs (5)
    const recentJobs = jobs.slice(0, 5).map((job) => ({
      _id: job._id,
      title: job.title,
      status: job.status,
      location: job.location || "Not specified",
      createdAt: job.createdAt,
    }));

    // Recent Events (5)
    const events = await Event.find({ createdBy: recruiterId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentEvents = events.map((event) => {
       const now = new Date();
       let status = 'upcoming';
       if (now > new Date(event.endDate)) status = 'ended';
       else if (now >= new Date(event.startDate)) status = 'ongoing';

       return {
          _id: event._id,
          title: event.title,
          category: event.category,
          startDate: event.startDate,
          status,
          registrations: event.participants ? event.participants.length : 0
       };
    });

    // Sparkline (7 days)
    const last7 = daysAgo(6);
    let sparkline = [];

    if (jobIds.length) {
      const sparkAgg = await Application.aggregate([
        {
          $match: {
            job: { $in: jobIds },
            createdAt: { $gte: last7 },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const map = new Map(sparkAgg.map((i) => [i._id, i.count]));

      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const key = d.toISOString().slice(0, 10);
        sparkline.push({
          date: key,
          count: map.get(key) || 0,
        });
      }
    }

    // AI Talent Watch / Passive Sourcing (Discovery)
    const discoveryCandidates = await User.find({ role: 'candidate' })
      .select('name skills avatar')
      .sort({ points: -1 })
      .limit(3)
      .lean();
    
    const aiSuggestions = discoveryCandidates.map(c => ({
      name: c.name,
      score: Math.floor(Math.random() * 10) + 90, 
      role: c.skills?.[0] || 'Candidate'
    }));

    return res.json({
      counts: {
        totalJobs,
        totalApplications,
        totalShortlisted,
        totalHires: totalHired,
      },
      recentJobs,
      recentEvents,
      sparkline,
      aiSuggestions
    });
  } catch (err) {
    console.error("rpanel.getOverview error:", err);
    res.status(500).json({ message: "Failed to load recruiter overview" });
  }
};


/* ---------------------------------------------------------
   PATCH /api/rpanel/jobs/:id
--------------------------------------------------------- */
export const updateJob = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const jobId = toObjectId(req.params.id);

    const job = await Job.findOne({ _id: jobId, postedBy: recruiterId });
    if (!job) return res.status(404).json({ message: "Job not found" });

    const allowedFields = ["title", "description", "skills", "location", "salary", "type", "status"];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) job[field] = req.body[field];
    });

    await job.save();

    await AuditLog.create({
      action: "UPDATE_JOB",
      performedBy: recruiterId,
      targetUser: recruiterId,
      details: `Recruiter updated job "${job.title}"`,
    });

    res.json({ message: "Job updated successfully", job });
  } catch (err) {
    console.error("rpanel.updateJob error:", err);
    res.status(500).json({ message: "Failed to update job" });
  }
};

/* ---------------------------------------------------------
   DELETE /api/rpanel/jobs/:id
--------------------------------------------------------- */
export const deleteJob = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const jobId = toObjectId(req.params.id);

    const job = await Job.findOne({ _id: jobId, postedBy: recruiterId });
    if (!job) return res.status(404).json({ message: "Job not found" });

    await job.deleteOne();

    await AuditLog.create({
      action: "DELETE_JOB",
      performedBy: recruiterId,
      targetUser: recruiterId,
      details: `Recruiter deleted job "${job.title}"`,
    });

    res.json({ message: "Job deleted successfully" });
  } catch (err) {
    console.error("rpanel.deleteJob error:", err);
    res.status(500).json({ message: "Failed to delete job" });
  }
};

/* ---------------------------------------------------------
   POST /api/rpanel/jobs
--------------------------------------------------------- */
export const createJob = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const { title, description, skills = [], location, salary, type } = req.body;

    if (!title || !description) {
      return res.status(400).json({ message: "Title and Description are required" });
    }

    const job = await Job.create({
      title,
      description,
      skills,
      location,
      salary,
      type,
      postedBy: recruiterId,
      status: "pending", // Requires admin approval before going live
    });

    await AuditLog.create({
      action: "CREATE_JOB",
      performedBy: recruiterId,
      targetUser: recruiterId,
      details: `Recruiter created job "${title}"`,
    });

    res.status(201).json({
      message: "Job created successfully! 🚀",
      job,
    });
  } catch (err) {
    console.error("rpanel.createJob error:", err);
    res.status(500).json({ message: "Failed to create job" });
  }
};


/* ---------------------------------------------------------
   GET /api/rpanel/jobs
--------------------------------------------------------- */
export const listJobs = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const { search = "", status = "", page = 1, limit = 10 } = req.query;

    const q = { postedBy: recruiterId };

    if (search) q.title = { $regex: search, $options: "i" };
    if (status) q.status = status;

    const total = await Job.countDocuments(q);

    const jobs = await Job.find(q)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({
      total,
      jobs,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error("rpanel.listJobs error:", err);
    res.status(500).json({ message: "Failed to load jobs" });
  }
};

/* ---------------------------------------------------------
   GET /api/rpanel/jobs/:jobId/applications
--------------------------------------------------------- */
export const listJobApplications = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const jobId = toObjectId(req.params.jobId);

    // Check job belongs to recruiter
    const job = await Job.findOne({ _id: jobId, postedBy: recruiterId }).lean();

    if (!job) return res.status(404).json({ message: "Job not found" });

    // Fetch applications normally (using Application model)
    const apps = await Application.find({ job: jobId })
      .populate("candidate", "name email mobile resumeUrl")
      .sort({ createdAt: -1 });

    res.json({
      jobId: jobId.toString(),
      jobTitle: job.title,
      total: apps.length,
      applications: apps.map((app) => ({
        _id: app._id,
        candidate: {
          _id: app.candidate?._id,
          name: app.candidate?.name,
          email: app.candidate?.email,
          mobile: app.candidate?.mobile,
          resumeUrl: app.resumeUrl || app.candidate?.resumeUrl,
        },
        job: {
          _id: jobId,
          title: job.title
        },
        coverLetter: app.coverLetter,
        status: app.status,
        appliedAt: app.createdAt,
        atsScore: app.atsScore || 0,
        atsVerdict: app.atsVerdict || "N/A",
        assessment: app.assessment,
        interviewDetails: app.interviewDetails,
        offerDetails: app.offerDetails,
        rejectionFeedback: app.rejectionFeedback
      })),
    });
  } catch (err) {
    console.error("rpanel.listJobApplications error:", err);
    res.status(500).json({ message: "Failed to load applications" });
  }
};

/* ---------------------------------------------------------
   PATCH /api/rpanel/applications/:applicationId/status
--------------------------------------------------------- */
export const updateApplicationStatus = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const applicationId = toObjectId(req.params.applicationId);
    const { status, interviewDetails, offerDetails, rejectionFeedback } = req.body;
 
    if (!status)
      return res.status(400).json({ message: "Missing new status" });
 
    const application = await Application.findById(applicationId)
      .populate("candidate", "email name")
      .populate("job", "postedBy title")
      .lean();
 
    if (!application)
      return res.status(404).json({ message: "Application not found" });
 
    if (String(application.job.postedBy) !== String(recruiterId)) {
      return res.status(403).json({ message: "Not authorized" });
    }
 
    const updateFields = { status, updatedAt: new Date() };
    if (interviewDetails) updateFields.interviewDetails = interviewDetails;
    if (offerDetails) updateFields.offerDetails = offerDetails;
    if (rejectionFeedback) updateFields.rejectionFeedback = rejectionFeedback;
 
    await Application.findByIdAndUpdate(applicationId, updateFields);

    const recruiter = await User.findById(recruiterId).select("orgName");
    const orgName = recruiter?.orgName || "OneStop Hub";

    if (status === "hired") {
      const subject = `Congratulations! You're Hired at ${orgName}`;
      const htmlContent = candidateHiredTemplate(
        application.candidate.name,
        application.job.title,
        orgName
      );

      await sendEmail(
        application.candidate.email,
        subject,
        `You have been hired for ${application.job.title} at ${orgName}.`,
        htmlContent
      );
    } else if (status === "shortlisted") {
      const subject = `Your application for ${application.job.title} has been Shortlisted!`;
      const htmlContent = candidateShortlistedTemplate(
        application.candidate.name,
        application.job.title,
        orgName
      );
      await sendEmail(application.candidate.email, subject, `Shortlist update for ${application.job.title}`, htmlContent);
    } else if (status === "interviewing") {
      const subject = `Interview Invitation: ${application.job.title} at ${orgName}`;
      const htmlContent = candidateInterviewTemplate(
        application.candidate.name,
        application.job.title,
        orgName,
        interviewDetails
      );
      await sendEmail(application.candidate.email, subject, `Interview invitation for ${application.job.title}`, htmlContent);
    } else if (status === "offered") {
      const subject = `Job Offer: ${application.job.title} at ${orgName}`;
      const htmlContent = candidateOfferedTemplate(
        application.candidate.name,
        application.job.title,
        orgName,
        offerDetails
      );
      await sendEmail(application.candidate.email, subject, `You have received a job offer from ${orgName}`, htmlContent);
    } else if (status === "rejected") {
      const subject = `Application Update: ${application.job.title}`;
      const htmlContent = candidateRejectedTemplate(
        application.candidate.name,
        application.job.title,
        orgName,
        rejectionFeedback
      );
      await sendEmail(application.candidate.email, subject, `Update regarding your application at ${orgName}`, htmlContent);
    }

    await AuditLog.create({
      action: "UPDATE_APPLICATION_STATUS",
      performedBy: recruiterId,
      targetUser: application.candidate._id,
      details: `Recruiter updated status of application for ${application.job.title} → ${status}`,
    });

    res.json({ message: "Application updated", status });
  } catch (err) {
    console.error("rpanel.updateApplicationStatus error:", err);
    res.status(500).json({ message: "Failed to update application" });
  }
};

/* ---------------------------------------------------------
   GET /api/rpanel/notifications
--------------------------------------------------------- */
export const listNotifications = async (req, res) => {
  try {
    const recruiterId = req.user._id;

    const unread = await Notification.countDocuments({
      user: recruiterId,
      read: false,
    });

    const items = await Notification.find({ user: recruiterId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      unread,
      items,
    });
  } catch (err) {
    console.error("rpanel.listNotifications error:", err);
    res.status(500).json({ message: "Failed to load notifications" });
  }
};

/* ---------------------------------------------------------
   GET /api/rpanel/profile
--------------------------------------------------------- */
export const getProfile = async (req, res) => {
  try {
    const me = await User.findById(req.user._id)
      .select("name email mobile orgName avatar role status")
      .lean();

    res.json(me);
  } catch (err) {
    console.error("rpanel.getProfile error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
};

/* ---------------------------------------------------------
   PATCH /api/rpanel/profile
--------------------------------------------------------- */
export const updateProfile = async (req, res) => {
  try {
    const patch = {};
    const allowed = ["name", "mobile", "orgName", "avatar"];

    allowed.forEach((k) => {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    });

    const updated = await User.findByIdAndUpdate(req.user._id, patch, {
      new: true,
    })
      .select("name email mobile orgName avatar role status")
      .lean();

    await AuditLog.create({
      action: "UPDATE_RECRUITER_PROFILE",
      performedBy: req.user._id,
      details: `Updated fields: ${Object.keys(patch).join(",")}`,
    });

    res.json(updated);
  } catch (err) {
    console.error("rpanel.updateProfile error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

/* ---------------------------------------------------------
   GET /api/rpanel/applications (All for recruiter)
--------------------------------------------------------- */
export const listAllApplications = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);

    const jobs = await Job.find({ postedBy: recruiterId }).select("_id");
    const jobIds = jobs.map((j) => j._id);

    if (jobIds.length === 0) {
      return res.json({ total: 0, applications: [] });
    }

    const apps = await Application.find({ job: { $in: jobIds } })
      .populate("candidate", "name email mobile resumeUrl")
      .populate("job", "title")
      .sort({ createdAt: -1 });

    res.json({
      total: apps.length,
      applications: apps.map((app) => ({
        _id: app._id,
        candidate: {
          _id: app.candidate?._id,
          name: app.candidate?.name,
          email: app.candidate?.email,
          mobile: app.candidate?.mobile,
          resumeUrl: app.resumeUrl || app.candidate?.resumeUrl,
        },
        job: {
          _id: app.job?._id,
          title: app.job?.title
        },
        coverLetter: app.coverLetter,
        status: app.status,
        appliedAt: app.createdAt,
        atsScore: app.atsScore || 0,
        atsVerdict: app.atsVerdict || "N/A",
        assessment: app.assessment,
        interviewDetails: app.interviewDetails,
        offerDetails: app.offerDetails,
        rejectionFeedback: app.rejectionFeedback
      })),
    });
  } catch (err) {
    console.error("rpanel.listAllApplications error:", err);
    res.status(500).json({ message: "Failed to load all applications" });
  }
};

/* ---------------------------------------------------------
   GET /api/rpanel/applications/:applicationId
--------------------------------------------------------- */
export const getApplication = async (req, res) => {
  try {
    const recruiterId = toObjectId(req.user._id);
    const applicationId = toObjectId(req.params.applicationId);

    const application = await Application.findById(applicationId)
      .populate("candidate", "name email mobile resumeUrl skills experience")
      .populate("job", "title postedBy")
      .lean();

    if (!application) return res.status(404).json({ message: "Application not found" });

    if (String(application.job.postedBy) !== String(recruiterId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json({ application });
  } catch (err) {
    console.error("rpanel.getApplication error:", err);
    res.status(500).json({ message: "Failed to load application" });
  }
};
