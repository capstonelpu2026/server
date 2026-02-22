import express from "express";
import multer from "multer";
import { 
  generateQuestions, 
  analyzeAnswer, 
  chatWithAI,
  generateJobDescription,
  generateCoverLetter,
  checkJobEligibility,
  enhanceCV,
  generateQuiz,
  analyzeAudioAnswer,
  validateBrand,
  identifyBrand
} from "../controllers/aiController.js";
import { 
  generateProblems, 
  evaluateSolution,
  completeQuest 
} from "../controllers/codeArenaController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Interview Routes
// Interview Routes
router.post("/interview/questions", generateQuestions);
router.post("/interview/validate-brand", validateBrand);
router.post("/interview/identify", identifyBrand);
router.post("/interview/analyze", analyzeAnswer);
router.post("/chat", chatWithAI);

// Audio Analysis (Local Multer)
const upload = multer({ dest: "uploads/" });
router.post("/interview/analyze-audio", upload.single("audio"), analyzeAudioAnswer);

// New AI Features
router.post("/job-description", generateJobDescription);
router.post("/cover-letter", generateCoverLetter);
router.post("/job-eligibility", checkJobEligibility);
/* Aadhaar analysis route removed */
router.post("/enhance-cv", enhanceCV);
router.post("/quiz/generate", generateQuiz);

// 🚀 OneStop Code Arena
router.post("/code-arena/generate", generateProblems);
router.post("/code-arena/evaluate", evaluateSolution);
router.post("/code-arena/save", protect, completeQuest);

export default router;
