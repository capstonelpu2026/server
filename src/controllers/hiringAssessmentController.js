import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { generateHiringTest } from "./aiController.js";
import asyncHandler from "express-async-handler";

/**
 * @desc Recruiter sends assessment to candidate
 * @route POST /api/rpanel/applications/:applicationId/assessment/send
 */
export const sendHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  
  const application = await Application.findById(applicationId).populate("job");
  if (!application) return res.status(404).json({ message: "Application not found" });

  // Generate questions via AI
  const questions = await generateHiringTest(application.job.title, application.job.description);

  application.assessment = {
    status: "sent",
    questions,
    violations: 0
  };

  await application.save();
  res.json({ message: "Assessment generated and sent successfully", questionsCount: questions.length });
});

/**
 * @desc Candidate gets assessment questions (without answers)
 * @route GET /api/candidate/applications/:applicationId/assessment
 */
export const getHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const application = await Application.findById(applicationId).select("assessment candidate");

  if (!application || String(application.candidate) !== String(req.user._id)) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  if (application.assessment.status === "completed") {
    return res.status(400).json({ message: "Assessment already completed" });
  }

  // Hide correct answers before sending to candidate
  const safeQuestions = application.assessment.questions.map(q => ({
    _id: q._id,
    question: q.question,
    options: q.options
  }));

  res.json({ questions: safeQuestions });
});

/**
 * @desc Candidate submits assessment
 * @route POST /api/candidate/applications/:applicationId/assessment/submit
 */
export const submitHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { responses, violations } = req.body;

  const application = await Application.findById(applicationId);
  if (!application) return res.status(404).json({ message: "Not found" });

  const questions = application.assessment.questions;
  let score = 0;

  responses.forEach((userAnswer, index) => {
    if (userAnswer === questions[index].answer) {
      score++;
    }
  });

  const finalScore = Math.round((score / questions.length) * 100);

  application.assessment.status = "completed";
  application.assessment.responses = responses;
  application.assessment.score = finalScore;
  application.assessment.violations = violations || 0;
  application.assessment.completedAt = new Date();

  await application.save();

  res.json({ 
    message: "Assessment submitted", 
    score: finalScore,
    violations: application.assessment.violations
  });
});

/**
 * @desc Track violations (tab switches) in real-time
 */
export const reportAssessmentViolation = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  await Application.findByIdAndUpdate(applicationId, {
    $inc: { "assessment.violations": 1 }
  });
  res.json({ success: true });
});
