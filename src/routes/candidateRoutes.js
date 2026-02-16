import express from "express";
import asyncHandler from "express-async-handler";
import { protect } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import cloudinary from "../utils/cloudinary.js";
import User from "../models/User.js";
import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { notify } from "../utils/notify.js";
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
    if (req.user.role !== "candidate")
      return res.status(403).json({ message: "Candidates only" });

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
    if (req.user.role !== "candidate")
      return res.status(403).json({ message: "Candidates only" });

    if (!req.file?.path)
      return res.status(400).json({ message: "Resume file required" });

    const user = await User.findById(req.user._id);

    // Delete old resume
    if (user.resumePublicId) {
      await cloudinary.uploader.destroy(user.resumePublicId, {
        resource_type: "raw",
      });
    }

    user.resumeUrl = req.file.path;       // ✅ /raw/upload/
    user.resumePublicId = req.file.filename;
    await user.save();

    await notify({
      userId: user._id,
      title: "Resume Uploaded",
      message: "Your resume was uploaded successfully.",
      type: "application",
    });

    res.json({
      message: "Resume uploaded successfully ✅",
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
    if (req.user.role !== "candidate")
      return res.status(403).json({ message: "Candidates only" });

    const applications = await Application.find({
      candidate: req.user._id,
    })
      .populate("job", "title location")
      .sort({ createdAt: -1 });

    res.json(applications);
  })
);

export default router;
