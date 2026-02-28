import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  upload,
  aiGenerateContest,
  aiGenerateContestMeta,
  listContests,
  getContestById,
  createContest,
  updateContest,
  deleteContest,
  registerForContest,
  submitSolution,
  getLeaderboard,
  adminListContests,
  generateAndSendCertificates,
  logViolation,
  sendWarningEmail,
  disqualifyParticipant,
} from "../controllers/codingContestController.js";

const router = express.Router();

/* -------------------------------------------------------
   🤖 AI GENERATION (SuperAdmin only)
------------------------------------------------------- */
router.post(
  "/ai-generate",
  protect,
  authorize("admin", "superadmin"),
  aiGenerateContest
);

router.post(
  "/ai-meta",
  protect,
  authorize("admin", "superadmin"),
  aiGenerateContestMeta
);

/* -------------------------------------------------------
   📋 PUBLIC LISTING
------------------------------------------------------- */
router.get("/contests", listContests);
router.get("/contests/:id", getContestById);
router.get("/contests/:id/leaderboard", getLeaderboard);

/* -------------------------------------------------------
   🎟️ REGISTRATION (Any authenticated user)
------------------------------------------------------- */
router.post("/contests/:id/register", protect, registerForContest);

/* -------------------------------------------------------
   💾 SUBMISSION (Registered participants)
------------------------------------------------------- */
router.post("/contests/:id/submit", protect, submitSolution);

/* -------------------------------------------------------
   👑 ADMIN MANAGEMENT
------------------------------------------------------- */
router.get(
  "/admin/contests",
  protect,
  authorize("admin", "superadmin"),
  adminListContests
);

router.post("/contests/admin/:id/certificates", protect, authorize("admin", "superadmin"), generateAndSendCertificates);
router.post("/contests/admin/:id/warning", protect, authorize("admin", "superadmin"), sendWarningEmail);
router.post("/contests/admin/:id/disqualify", protect, authorize("admin", "superadmin"), disqualifyParticipant);

// Participant routes
router.post("/contests/:id/violation", protect, logViolation);

router.post(
  "/contests",
  protect,
  authorize("admin", "superadmin"),
  upload.single("banner"),
  createContest
);

router.put(
  "/contests/:id",
  protect,
  authorize("admin", "superadmin"),
  upload.single("banner"),
  updateContest
);

router.delete(
  "/contests/:id",
  protect,
  authorize("admin", "superadmin"),
  deleteContest
);

export default router;
