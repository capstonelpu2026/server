import asyncHandler from "express-async-handler";
import Job from "../models/Job.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";
import { getJobs, getInternships, findJobById, getJobsByRecruiter } from "../services/jobService.js";

/* ============================
   GET JOBS BY RECRUITER
============================ */
export const getRecruiterJobs = asyncHandler(async (req, res) => {
  const jobs = await getJobsByRecruiter(req.params.id);
  res.json(jobs);
});

/* ============================
   GET JOBS
============================ */
export const getJobsList = asyncHandler(async (req, res) => {
  const { type } = req.query;
  const jobs = await getJobs(type);
  res.json(jobs);
});

/* ============================
   GET INTERNSHIPS
============================ */
export const getInternshipsList = asyncHandler(async (req, res) => {
  const internships = await getInternships();
  res.json(internships);
});

/* ============================
   GET JOB BY ID
============================ */
export const getJobById = asyncHandler(async (req, res) => {
  const job = await findJobById(req.params.id);
  if (!job) {
    res.status(404);
    throw new Error("Job not found");
  }
  res.json(job);
});

/* ============================
   APPLY TO JOB
============================ */
export const applyToJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const job = await Job.findById(id);

  // 🌐 Demo / external job
  if (!job) {
    return res.json({
      success: true,
      message: "Application submitted successfully (Demo)",
    });
  }

  const existing = await Application.findOne({
    job: id,
    candidate: userId,
  });

  if (existing) {
    return res.status(400).json({
      success: false,
      message: "Already applied",
    });
  }

  let resumeUrl = req.user.resumeUrl;

  if (req.file) {
    // ✅ Middleware already uploaded to Cloudinary
    resumeUrl = req.file.path; 
  }

  /* 🧠 AI MATCHING ALGORITHM */
  const jobSkills = (job.skills || []).map(s => s.toLowerCase().trim());
  const userSkills = (req.user.skills || []).map(s => s.toLowerCase().trim());

  let atsScore = 0;
  let atsVerdict = "Fair";

  if (jobSkills.length > 0) {
    const matchCount = jobSkills.filter(js => userSkills.includes(js)).length;
    atsScore = Math.round((matchCount / jobSkills.length) * 100);
  } else {
    // If job has no specific skills required, we default to a base score (e.g. 50) or just ignore
    atsScore = 50; 
  }

  if (atsScore >= 80) atsVerdict = "Excellent";
  else if (atsScore >= 50) atsVerdict = "Good";
  else atsVerdict = "Fair";

  const application = await Application.create({
    job: id,
    candidate: userId,
    resumeUrl,
    status: "applied",
    coverLetter: req.body.coverLetter || "I am highly interested in this position and look forward to discussing my qualifications.",
    atsScore,
    atsVerdict
  });

  job.applicants.push(application._id);
  await job.save();

  // ✨ GAMIFICATION: Reward activity
  // 10 XP base for applying, 10 XP bonus for high ATS score (>70)
  const bonus = atsScore >= 70 ? 10 : 0;
  await User.findByIdAndUpdate(userId, {
    $inc: { points: 10 + bonus }
  });

  return res.status(201).json({
    success: true,
    message: "Application sent to recruiter!",
  });
});

/* ============================
   WITHDRAW APPLICATION
============================ */
export const withdrawApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id; // User is authenticated via 'protect'

  const job = await Job.findById(id);
  if (!job) {
    res.status(404);
    throw new Error("Job not found");
  }

  // Find and delete the application
  const application = await Application.findOneAndDelete({
    job: id,
    candidate: userId,
  });

  if (!application) {
    res.status(404);
    throw new Error("Application not found");
  }

  // Remove the application ID from the job's applicants array
  job.applicants = job.applicants.filter(
    (appId) => appId.toString() !== application._id.toString()
  );
  await job.save();

  res.json({
    success: true,
    message: "Application withdrawn successfully",
  });
});
