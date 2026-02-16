import express from "express";
import {
  getJobsList,
  getInternshipsList,
  getJobById,
  applyToJob,
  withdrawApplication,
  getRecruiterJobs,
} from "../controllers/jobController.js";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

/* =========================
   JOB LISTING ROUTES (FIRST)
========================= */
router.get("/jobs", getJobsList);
router.get("/internships", getInternshipsList);
router.get("/recruiter/:id/jobs", getRecruiterJobs);

/* =========================
   SINGLE JOB ROUTES (LAST)
========================= */
router.get("/jobs/:id", getJobById);
// 📨 Apply for a Job (Candidate, Mentor, Recruiter for testing)
router.post("/jobs/:id/apply", protect, authorize("candidate", "mentor", "recruiter"), upload.single("resume"), applyToJob); // Modified line
// ❌ Withdraw Application (Candidate & Mentor)
router.delete("/jobs/:id/withdraw", protect, authorize("candidate", "mentor"), withdrawApplication);

export default router;
