import express from "express";
import asyncHandler from "express-async-handler";
import { protect } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import cloudinary from "../utils/cloudinary.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { notify } from "../utils/notify.js";
import { notifyUser } from "../utils/notifyUser.js";
import { 
  getHiringAssessment, 
  submitHiringAssessment, 
  reportAssessmentViolation 
} from "../controllers/hiringAssessmentController.js";

const router = express.Router();

/**
 * Technical Assessment Routes (Candidate)
 */
router.get("/applications/:applicationId/assessment", protect, getHiringAssessment);
router.post("/applications/:applicationId/assessment/submit", protect, submitHiringAssessment);
router.patch("/applications/:applicationId/assessment/violation", protect, reportAssessmentViolation);


/* =========================
   GET PROFILE (Enhanced)
========================= */
router.get(
  "/profile",
  protect,
  asyncHandler(async (req, res) => {
    // Every authenticated user can have a professional profile view
    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("savedJobs", "title location status")
      .lean();

    // Attach recent applications
    const applications = await Application.find({ candidate: req.user._id })
      .populate("job", "title") // Mini populate
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({ ...user, applications });
  })
);

/* =========================
   UPDATE COVER LETTER
========================= */
router.put(
  "/cover-letter",
  protect,
  asyncHandler(async (req, res) => {
     const { coverLetter } = req.body;
     const user = await User.findById(req.user._id);
     user.coverLetter = coverLetter;
     await user.save();
     res.json({ message: "Cover letter saved ✅", coverLetter });
  })
);

/* =========================
   REMOVE SAVED JOB
========================= */
router.delete(
   "/save/:id",
   protect,
   asyncHandler(async (req, res) => {
      const user = await User.findById(req.user._id);
      user.savedJobs = user.savedJobs.filter(id => id.toString() !== req.params.id);
      await user.save();
      res.json({ message: "Job removed from saved list" });
   })
);

/* =========================
   UPLOAD RESUME
========================= */
router.post(
  "/resume",
  protect,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file?.path)
      return res.status(400).json({ message: "Resume file required" });

    const user = await User.findById(req.user._id);

    // ✅ Robust cleanup: Delete old resume from Cloudinary (Try both raw and image)
    if (user.resumePublicId) {
      try {
        await cloudinary.uploader.destroy(user.resumePublicId, {
          resource_type: "raw",
        });
        // Also try as image just in case it was uploaded differently before
        await cloudinary.uploader.destroy(user.resumePublicId, {
          resource_type: "image",
        });
      } catch (err) {
        console.error("Cloudinary Cleanup Warning:", err.message);
      }
    }

    user.resumeUrl = req.file.path;       // New path from Cloudinary
    user.resumePublicId = req.file.filename;
    await user.save();

    await notify({
      userId: user._id,
      title: "Resume Updated",
      message: "Your profile resume has been successfully replaced.",
      type: "application",
    });

    res.json({
      message: "Resume updated and old one replaced ✅",
      resumeUrl: user.resumeUrl,
    });
  })
);

/* =========================
   GET APPLICATIONS
========================= */
router.get(
  "/applications",
  protect,
  asyncHandler(async (req, res) => {
    const applications = await Application.find({
      candidate: req.user._id,
    })
      .populate({
        path: "job",
        select: "title location postedBy",
        populate: { path: "postedBy", select: "orgName" }
      })
      .sort({ createdAt: -1 });

    res.json(applications);
  })
);

/* =========================
   OFFER RESPONSE
========================= */
router.patch(
  "/applications/:id/offer-response",
  protect,
  asyncHandler(async (req, res) => {
    const { response, signature, reason } = req.body; // response: accepted / declined
    const application = await Application.findOne({
      _id: req.params.id,
      candidate: req.user._id
    }).populate("job", "title");

    if (!application) return res.status(404).json({ message: "Application not found" });
    if (application.status !== "offered") return res.status(400).json({ message: "No active offer" });

    // ⌚ Enforce Legal Expiry Window
    const issuedAt = application.offerDetails.issuedAt || application.updatedAt;
    const expiryHours = application.offerDetails.expiryHours || 72;
    const expiryTime = new Date(issuedAt).getTime() + (expiryHours * 60 * 60 * 1000);
    const isExpired = Date.now() > expiryTime;

    if (isExpired && response === "accepted") {
      return res.status(403).json({ 
        message: "This employment offer has expired. Please contact the recruiter to request a revision.",
        expired: true
      });
    }

    application.offerDetails.status = response;
    
    // If accepted, save signature details and mark as hired
    if (response === "accepted") {
      application.status = "hired";
      if (signature) {
        application.offerDetails.candidateSignature = signature;
        application.offerDetails.signedAt = new Date();
      }
    } else if (response === "declined") {
      application.status = "rejected";
      application.offerDetails.declineReason = reason || "No specific reason provided.";
      application.rejectionFeedback = `Candidate declined offer. Reason: ${reason || "No specific reason provided."}`;
    }

    await application.save();

    // 🔔 Notify candidate (self)
    await notify({
      userId: application.candidate,
      title: `Offer ${response}`,
      message: `You have ${response} the offer for ${application.job?.title}.`,
      type: "application",
    });

    // 🔔 Notify Recruiter about candidate's response
    const job = await Job.findById(application.job?._id || application.job).select("postedBy title");
    if (job && job.postedBy) {
      const candidateUser = await User.findById(req.user._id).select("name");
      const candidateName = candidateUser?.name || "A candidate";
      const statusMessage = response === "accepted" 
        ? `${candidateName} has ACCEPTED your offer for "${job.title}". Onboarding can begin!`
        : `${candidateName} has DECLINED your offer for "${job.title}".`;
      
      await notifyUser({
        userId: job.postedBy,
        title: response === "accepted" ? "✅ Offer Accepted!" : "❌ Offer Declined",
        message: statusMessage,
        link: `/rpanel/jobs/${job._id}/applications`,
        type: "candidate",
        persist: true,
        realtime: true,
        emailSubject: `Offer ${response === "accepted" ? "Accepted" : "Declined"} - ${job.title}`,
        emailEnabled: true,
      }).catch(err => console.error("Recruiter offer-response notify error:", err));
    }

    res.json({ message: `Offer ${response} successfully ✅`, application });
  })
);

/* =========================
   INTERVIEW RESCHEDULE REQUEST
========================= */
router.patch(
  "/applications/:id/reschedule",
  protect,
  asyncHandler(async (req, res) => {
    const { message } = req.body;
    const application = await Application.findOne({
      _id: req.params.id,
      candidate: req.user._id
    }).populate("job", "title postedBy");

    if (!application) return res.status(404).json({ message: "Application not found" });
    
    application.interviewDetails.rescheduleRequested = true;
    application.interviewDetails.rescheduleMessage = message;
    await application.save();

    // 🔔 Notify Recruiter about reschedule request
    if (application.job?.postedBy) {
      const candidateUser = await User.findById(req.user._id).select("name");
      notifyUser({
        userId: application.job.postedBy,
        title: "⚠️ Interview Reschedule Request",
        message: `${candidateUser?.name || "A candidate"} suggested a reschedule for "${application.job.title}": ${message}`,
        link: `/rpanel/jobs/${application.job._id}/applications`,
        type: "candidate",
        persist: true,
        realtime: true
      }).catch(err => console.error("Reschedule notify error:", err));
    }

    res.json({ message: "Reschedule request sent successfully ✅" });
  })
);

/* =========================
   WITHDRAW APPLICATION
========================= */
router.patch(
  "/applications/job/:jobId/status",
  protect,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (status !== "withdrawn") return res.status(400).json({ message: "Invalid status" });

    const application = await Application.findOne({
      job: req.params.jobId,
      candidate: req.user._id
    }).populate("job", "title postedBy");

    if (!application) return res.status(404).json({ message: "Application not found" });
    
    application.status = "withdrawn";
    await application.save();

    // 🔔 Notify Recruiter about withdrawal
    if (application.job?.postedBy) {
      const candidateUser = await User.findById(req.user._id).select("name");
      notifyUser({
        userId: application.job.postedBy,
        title: "Application Withdrawn",
        message: `${candidateUser?.name || "A candidate"} has withdrawn their application for "${application.job.title}".`,
        link: `/rpanel/jobs/${application.job._id}/applications`,
        type: "candidate",
        persist: true,
        realtime: true
      }).catch(err => console.error("Withdraw notify error:", err));
    }

    res.json({ message: "Application withdrawn successfully ❌" });
  })
);

export default router;
