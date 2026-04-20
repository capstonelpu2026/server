import express from "express";
import {
  createAssessment,
  getAssessments,
  getAssessment,
  startAttempt,
  saveAnswer,
  submitAssessment,
  reportTabSwitch,
  getMyAttempts,
  getAttemptResult
} from "../controllers/assessmentController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

// 📝 Assessment Management (Recruiter/Admin)
router.post("/", protect, authorize("recruiter", "admin", "superadmin"), createAssessment);

// 📊 Results & History — MUST come before /:id to avoid route shadowing
// ⚠️  GET /my/attempts would be captured by /:id as id="my" if placed after
router.get("/my/attempts", protect, getMyAttempts);
router.get("/attempt/:attemptId/result", protect, getAttemptResult);

// 🎯 Taking Assessment — attempt actions (PUT/POST don't conflict with GET /:id)
router.put("/attempt/:attemptId/answer", protect, saveAnswer);
router.post("/attempt/:attemptId/submit", protect, submitAssessment);
router.post("/attempt/:attemptId/tab-switch", protect, reportTabSwitch);

// 📋 Browse & Access — dynamic /:id LAST to avoid shadowing static paths above
router.get("/", protect, getAssessments);
router.get("/:id", protect, getAssessment);
router.post("/:id/start", protect, startAttempt);

export default router;
