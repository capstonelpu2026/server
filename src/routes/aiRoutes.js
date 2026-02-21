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

export default router;
