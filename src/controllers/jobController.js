import asyncHandler from "express-async-handler";
import Job from "../models/Job.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import AuditLog from "../models/AuditLog.js";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";
import Groq from "groq-sdk";
import { createRequire } from "module";
import { getJobs, getInternships, findJobById, getJobsByRecruiter } from "../services/jobService.js";
import { notifyUser } from "../utils/notifyUser.js";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

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
    if (existing.status === 'withdrawn') {
      // Candidate withdrew previously but wants to try again. 
      // Clean up the archived withdrawn logic to allow a completely fresh application state.
      await Application.findByIdAndDelete(existing._id);
      job.applicants = job.applicants.filter(appId => appId.toString() !== existing._id.toString());
    } else {
      return res.status(400).json({
        success: false,
        message: "Already applied",
      });
    }
  }

  let resumeUrl = req.user.resumeUrl;

  if (req.file) {
    // ✅ Middleware already uploaded to Cloudinary
    resumeUrl = req.file.path; 
  }

  /* 🧠 AI MATCHING ALGORITHM VIA GROQ & PDF PARSE */
  let atsScore = 0;
  let atsVerdict = "Fair";
  const jobSkills = (job.skills || []).map(s => s.toLowerCase().trim());
  const userSkills = (req.user.skills || []).map(s => s.toLowerCase().trim());

  if (resumeUrl && process.env.GROQ_API_KEY) {
    try {
      console.log(`[ATS Tracker] Fetching resume buffer for job application from: ${resumeUrl}`);
      // Fetch the PDF from cloudinary URL
      const response = await fetch(resumeUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Extract content
        const data = await pdf(buffer);
        const text = data.text;

        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const prompt = `
          Act as an expert ATS (Applicant Tracking System) and Senior Technical Recruiter.
          Analyze this resume text against the target job skills, and output ONLY a JSON evaluation.
          
          JOB SKILLS REQUIRED: ${jobSkills.join(", ")}
          
          CANDIDATE RESUME:
          ${text.substring(0, 15000)}

          RETURN STRICT JSON ONLY (No markdown, no explanation, no backticks):
          {
            "score": number (0-100 representing exact alignment),
            "verdict": string ("Excellent", "Good", "Needs Improvement", "Poor")
          }
        `;

        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
        });

        const outputText = chatCompletion.choices[0]?.message?.content || "";
        const jsonString = outputText.replace(/```json/g, "").replace(/```/g, "").trim();
        const aiAnalysis = JSON.parse(jsonString);

        atsScore = aiAnalysis.score || 0;
        atsVerdict = aiAnalysis.verdict || "Fair";

        // Map textual verdicts strictly to formatting thresholds
        if (atsVerdict.includes("Excellent") || atsScore >= 80) atsVerdict = "Excellent";
        else if (atsVerdict.includes("Good") || atsScore >= 50) atsVerdict = "Good";
        else atsVerdict = "Fair";
        
      } else {
         console.error("[ATS Tracker] Failed to fetch document from cloud:", response.statusText);
      }
    } catch (err) {
      console.error("[ATS Tracker] Groq AI parsing failed, falling back to basic array comparison.", err.message);
      // Fallback
      if (jobSkills.length > 0) {
        const matchCount = jobSkills.filter(js => userSkills.includes(js)).length;
        atsScore = Math.round((matchCount / jobSkills.length) * 100);
      } else {
        atsScore = 50; 
      }
      if (atsScore >= 80) atsVerdict = "Excellent";
      else if (atsScore >= 50) atsVerdict = "Good";
      else atsVerdict = "Fair";
    }
  } else {
    // Basic fallback logic
    if (jobSkills.length > 0) {
      const matchCount = jobSkills.filter(js => userSkills.includes(js)).length;
      atsScore = Math.round((matchCount / jobSkills.length) * 100);
    } else {
      atsScore = 50; 
    }
    if (atsScore >= 80) atsVerdict = "Excellent";
    else if (atsScore >= 50) atsVerdict = "Good";
    else atsVerdict = "Fair";
  }

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

  // ✅ Sync User.applications subdocument
  const me = await User.findById(userId);
  if (me && me.applications) {
    me.applications.push({ job: id, status: "applied" });
    await me.save();
  }

  // ✨ GAMIFICATION: Reward activity
  // 10 XP base for applying, 10 XP bonus for high ATS score (>70)
  const bonus = atsScore >= 70 ? 10 : 0;
  await User.findByIdAndUpdate(userId, {
    $inc: { points: 10 + bonus }
  });

  // 🧾 Audit Log
  await AuditLog.create({
    action: "JOB_APPLY",
    performedBy: userId,
    targetUser: userId,
    details: `Candidate ${req.user.name} applied to job "${job.title}" (${job._id})`,
  }).catch(() => {});

  // 🔔 Notify Candidate (self)
  notifyUser({
    userId: userId,
    email: req.user.email,
    title: "Application Submitted ✅",
    message: `You successfully applied to "${job.title}".`,
    link: `/candidate/applications`,
    type: "application",
    emailSubject: "Application Submitted - OneStop Hub",
  }).catch(err => console.error("Candidate notify error:", err));

  // 🔔 Notify Recruiter
  const recruiter = await User.findById(job.postedBy).select("_id email");
  if (recruiter) {
    notifyUser({
      userId: recruiter._id,
      email: recruiter.email,
      title: "New Application Received 👤",
      message: `${req.user.name} applied for your job "${job.title}".`,
      link: `/rpanel/jobs/${job._id}/applications`,
      type: "candidate",
      emailSubject: `New Application - ${job.title}`,
    }).catch(err => console.error("Recruiter notify error:", err));
  }

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
  const userId = req.user._id;

  const job = await Job.findById(id).select("title postedBy");
  if (!job) {
    res.status(404);
    throw new Error("Job not found");
  }

  // Soft-delete: set status to 'withdrawn' (preserves audit trail)
  const application = await Application.findOne({
    job: id,
    candidate: userId,
  });

  if (!application) {
    res.status(404);
    throw new Error("Application not found");
  }

  application.status = "withdrawn";
  await application.save();

  // 🔔 Notify Recruiter about withdrawal
  if (job.postedBy) {
    notifyUser({
      userId: job.postedBy,
      title: "Application Withdrawn",
      message: `${req.user.name || "A candidate"} has withdrawn their application for "${job.title}".`,
      link: `/rpanel/jobs/${job._id}/applications`,
      type: "candidate",
      persist: true,
      realtime: true
    }).catch(err => console.error("Withdraw notify error:", err));
  }

  res.json({
    success: true,
    message: "Application withdrawn successfully",
  });
});
