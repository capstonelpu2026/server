import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import {
  getMentors,
  getMentorById,
  updateMentorSettings,
  bookSession,
  reviewSession,
  getMySessions,
  updateSessionStatus,
  getMentorStats,
  requestWithdrawal,
  getMyWithdrawals
} from "../controllers/mentorshipController.js";


const router = express.Router();

// 📌 Get All Approved Mentors (Public/Protected)
router.get("/list", protect, getMentors);

// 📌 Get Mentor Stats (Earnings, Hours)
router.get("/stats", protect, authorize(["mentor"]), getMentorStats);

// 📌 Request Withdrawal (Mentor Only)
router.post("/withdraw", protect, authorize(["mentor"]), requestWithdrawal);

// 📌 Get Withdrawal History (Mentor Only)
router.get("/withdrawals/history", protect, authorize(["mentor"]), getMyWithdrawals);


// 📌 Get Specific Mentor Details (Public/Protected)
router.get("/:id", protect, getMentorById);

/* ============================
   📅 Availability & Services
   ============================ */

// 📌 Update Mentor Services & Availability (Mentor Only)
router.put("/settings", protect, authorize(["mentor"]), updateMentorSettings);

/* ============================
   🤝 Booking Sessions
   ============================ */

// 📌 Book a Session (Candidate -> Mentor)
router.post("/book", protect, authorize(["candidate"]), bookSession);

// 📌 Submit Review (Mentee -> Mentor)
router.post("/sessions/:id/review", protect, reviewSession);

// 📌 Get My Sessions (As Mentor or Mentee)
router.get("/sessions/my", protect, getMySessions);



// 📌 Update Session Status (Mentor: Confirm/Cancel/Complete, Candidate: Cancel only)
router.patch("/sessions/:id/status", protect, authorize(["mentor", "candidate", "superadmin"]), updateSessionStatus);

export default router;
