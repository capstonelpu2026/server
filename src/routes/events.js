import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  upload,
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  uploadSubmission,
  evaluateSubmission,
  getLeaderboard,
  listMyRegistrations,
  listSubmissionsForEvent,
  eventAdminMetrics,
  updateQuiz,
  getQuiz,
  submitQuiz,
  emailCertificate,
  updateCoding,
  getCoding,
  submitCoding,
} from "../controllers/eventController.js";
import { getEventRegistrations } from "../controllers/registrationController.js";

const router = express.Router();

/* =====================================================
   🌍 PUBLIC ROUTES
===================================================== */

// Get all events (with filtering, pagination, category)
router.get("/", getEvents);

// Get user's own registrations (MUST BE BEFORE /:id)
router.get("/my/registrations", protect, listMyRegistrations);

// Admin metrics (MUST BE BEFORE /:id)
router.get(
  "/admin/metrics",
  protect,
  authorize("admin", "superadmin"),
  eventAdminMetrics
);

// Get single event by ID
router.get("/:id", getEventById);

// Get leaderboard for an event
router.get("/:id/leaderboard", getLeaderboard);

/* =====================================================
   🎯 QUIZ (Protected - Participant)
===================================================== */

// Get quiz questions (sanitized for participants)
router.get("/:id/quiz", protect, getQuiz);

// Submit quiz answers
router.post("/:id/quiz/submit", protect, submitQuiz);

/* =====================================================
   🎟️ REGISTRATION & SUBMISSION (Protected)
===================================================== */

// Register for an event
router.post("/:id/register", protect, registerForEvent);

// Upload a submission (file or link)
router.post(
  "/:id/submit",
  protect,
  upload.single("file"),
  uploadSubmission
);



// Email certificate to user
router.post("/:id/email-certificate", protect, emailCertificate);

/* =====================================================
   🛠️ ADMIN / EVENT MANAGEMENT ROUTES
===================================================== */

// Create event (admin/superadmin/recruiter/mentor)
router.post(
  "/",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  upload.single("cover"),
  createEvent
);

// Update event details
router.put(
  "/:id",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  upload.single("cover"),
  updateEvent
);

// Delete event
router.delete(
  "/:id",
  protect,
  authorize("admin", "superadmin"),
  deleteEvent
);

// Evaluate a participant's submission
router.post(
  "/:id/evaluate",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  evaluateSubmission
);

// Get all submissions for an event (admin view)
router.get(
  "/:id/submissions",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  listSubmissionsForEvent
);

// Get all registered participants for an event
router.get(
  "/:eventId/registrations",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  getEventRegistrations
);



/* =====================================================
   🎯 QUIZ MANAGEMENT (Admin)
===================================================== */

// Save/update quiz for an event
router.put(
  "/:id/quiz",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  updateQuiz
);

/* =====================================================
   💻 CODING (kept for legacy quiz-style events if any)
===================================================== */

// Get coding problems for event (sanitized)
router.get("/:id/coding", protect, getCoding);

// Update coding problems (admin)
router.put(
  "/:id/coding",
  protect,
  authorize("admin", "superadmin", "recruiter", "mentor"),
  updateCoding
);

// Submit coding solution
router.post("/:id/coding/submit", protect, submitCoding);

export default router;
