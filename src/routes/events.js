// routes/events.js
import express from "express";
import {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  uploadSubmission,
  evaluateSubmission,
  getLeaderboard,
  listSubmissionsForEvent,
  listMyRegistrations,
  eventAdminMetrics,
  upload,
  updateQuiz,
  getQuiz,
  submitQuiz,
  emailCertificate,
} from "../controllers/eventController.js";

import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { getEventRegistrations } from "../controllers/registrationController.js";
import AuditLog from "../models/AuditLog.js";
import Event from "../models/Event.js";
import Submission from "../models/Submission.js";
import cloudinary from "../utils/cloudinary.js";

const router = express.Router();

/* =====================================================
   📊 REGISTRATIONS (Unstop-Style Admin Panel)
===================================================== */

/**
 * @route   GET /api/events/:eventId/registrations
 * @desc    Paginated list of all participants for a specific event
 * @access  Admin / Mentor / SuperAdmin
 */
router.get(
  "/:eventId/registrations",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  getEventRegistrations
);

/* =====================================================
   🧱 EVENT CRUD & PUBLIC ROUTES
===================================================== */

/**
 * @route   POST /api/events
 * @desc    Create new event
 * @access  Admin / Mentor / SuperAdmin
 */
router.post(
  "/",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  upload.single("cover"), // optional banner image
  createEvent
);

/**
 * @route   GET /api/events
 * @desc    Public event listing with optional filters
 * @access  Public
 */
router.get("/", getEvents);

/**
 * @route   GET /api/events/:id
 * @desc    Get single event details
 * @access  Public
 */
router.get("/:id", getEventById);

/**
 * @route   PUT /api/events/:id
 * @desc    Update event details
 * @access  Admin / Mentor / SuperAdmin
 */
router.put(
  "/:id",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  upload.single("cover"),
  updateEvent
);

/**
 * @route   DELETE /api/events/:id
 * @desc    Delete event
 * @access  Admin / Mentor / SuperAdmin
 */
router.delete(
  "/:id",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  deleteEvent
);

/* =====================================================
   🎟️ REGISTRATION & SUBMISSION FLOW
===================================================== */

/**
 * @route   POST /api/events/:id/register
 * @desc    Register a user/team for the event
 * @access  Logged-in users
 */
router.post("/:id/register", protect, registerForEvent);

/**
 * @route   POST /api/events/:id/submit
 * @desc    Submit a project or file for an event
 * @access  Registered users
 */
router.post("/:id/submit", protect, upload.single("file"), uploadSubmission);

/**
 * @route   POST /api/events/:id/evaluate
 * @desc    Admin/Mentor/SuperAdmin evaluates a participant
 * @access  Admin / Mentor / SuperAdmin
 */
router.post(
  "/:id/evaluate",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  evaluateSubmission
);

/**
 * @route   GET /api/events/:id/leaderboard
 * @desc    Get leaderboard for an event
 * @access  Public
 */
router.get("/:id/leaderboard", getLeaderboard);

/* =====================================================
   📈 DASHBOARD & METRICS
===================================================== */

/**
 * @route   GET /api/events/registrations/me
 * @desc    Get events registered by logged-in user
 * @access  Logged-in users
 */
router.get("/registrations/me", protect, listMyRegistrations);

/**
 * @route   GET /api/events/admin/metrics
 * @desc    Admin dashboard metrics overview
 * @access  Admin / Mentor / SuperAdmin
 */
router.get(
  "/admin/metrics",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  eventAdminMetrics
);

/**
 * @route   GET /api/events/:id/submissions
 * @desc    List all submissions for an event (Admin)
 * @access  Admin / Mentor / SuperAdmin
 */
router.get(
  "/:id/submissions",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  listSubmissionsForEvent
);

/* =====================================================
   🗑️ LEGACY UTILITIES (SuperAdmin Only)
===================================================== */

/**
 * @route   DELETE /api/events/bulk/all
 * @desc    Delete all events (SuperAdmin)
 * @access  SuperAdmin only
 */
router.delete(
  "/bulk/all",
  protect,
  authorize(["superadmin"]),
  async (req, res) => {
    try {
      const events = await Event.find({});
      const count = events.length;

      for (const event of events) {
         // Cleanup cover image
         if (event.coverImage?.publicId) {
            await cloudinary.uploader.destroy(event.coverImage.publicId).catch(() => {});
         }
         // Cleanup all submissions for this event
         const subs = await Submission.find({ event: event._id });
         for (const s of subs) {
            if (s.filePublicId) {
               await cloudinary.uploader.destroy(s.filePublicId).catch(() => {});
            }
         }
         await Submission.deleteMany({ event: event._id });
      }

      await Event.deleteMany({});
      
      await AuditLog.create({
        action: "DELETE_ALL_EVENTS",
        performedBy: req.user._id,
        details: `SuperAdmin deleted all ${count} events and associated files`,
      });
      res.json({ message: `Deleted all ${count} events & cleaned storage ✅` });
    } catch (err) {
      console.error("Bulk delete events error:", err);
      res.status(500).json({ message: "Error bulk deleting events" });
    }
  }
);

/* =====================================================
   ❓ QUIZ ROUTES
===================================================== */

/**
 * @route   PUT /api/events/:id/quiz
 * @desc    Add/Update quiz questions
 * @access  Admin / Mentor
 */
router.put(
  "/:id/quiz",
  protect,
  authorize(["admin", "mentor", "superadmin", "recruiter"]),
  updateQuiz
);

/**
 * @route   GET /api/events/:id/quiz
 * @desc    Get quiz questions (without answers)
 * @access  Public / Registered
 */
router.get("/:id/quiz", protect, getQuiz);

/**
 * @route   POST /api/events/:id/quiz/submit
 * @desc    Submit quiz answers and auto-grade
 * @access  Registered users
 */
router.post(
  "/:id/quiz/submit",
  protect,
  submitQuiz
);

/* =====================================================
   🎓 CERTIFICATE ROUTES
===================================================== */

/**
 * @route   POST /api/events/:id/certificate/email
 * @desc    Email certificate to the registered participant
 * @access  Registered users
 */
router.post(
  "/:id/certificate/email",
  protect,
  emailCertificate
);

export default router;
