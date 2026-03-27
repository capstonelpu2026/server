import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { generateHiringTest } from "./aiController.js";
import asyncHandler from "express-async-handler";
import { notifyUser } from "../utils/notifyUser.js";

/**
 * @desc Recruiter sends assessment to candidate
 * @route POST /api/rpanel/applications/:applicationId/assessment/send
 */
export const sendHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { proctoringMode = "ai", duration = 3600 } = req.body;
  
  const application = await Application.findById(applicationId).populate("job").populate("candidate", "name email");
  if (!application) return res.status(404).json({ message: "Application not found" });

  // Generate questions + coding problems via AI
  const { questions, codingProblems } = await generateHiringTest(application.job.title, application.job.description);

  application.assessment = {
    status: "sent",
    duration, 
    questions,
    codingProblems: codingProblems || [],
    violations: 0,
    faceViolations: 0,
    cameraEnabled: false,
    proctoringMode
  };

  // Advance pipeline stage to 'assessment'
  application.status = 'assessment';

  await application.save();

  // 🔔 Notify candidate via email + in-app notification
  if (application.candidate) {
    const durationMins = Math.round(duration / 60);
    await notifyUser({
      userId: application.candidate._id,
      email: application.candidate.email,
      title: "📋 Technical Assessment Assigned",
      message: `You have a ${durationMins}-minute technical assessment for "${application.job.title}". Complete it from your Applications dashboard.`,
      link: `/candidate/assessment/${applicationId}`,
      type: "application",
      persist: true,
      realtime: true,
      emailSubject: `Action Required: Technical Assessment for ${application.job.title} - OneStop Hub`,
      emailEnabled: true
    }).catch(err => console.error("Assessment notification error:", err));
  }

  res.json({ 
    message: "Assessment generated and sent successfully", 
    questionsCount: questions.length,
    codingCount: (codingProblems || []).length
  });
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

  // Hide test cases from coding problems (candidate only sees examples)
  const safeCodingProblems = (application.assessment.codingProblems || []).map(p => ({
    _id: p._id,
    title: p.title,
    difficulty: p.difficulty,
    description: p.description,
    examples: p.examples,
    starterCode: p.starterCode,
    language: p.language
    // testCases intentionally excluded
  }));

  res.json({ 
    questions: safeQuestions, 
    codingProblems: safeCodingProblems,
    duration: application.assessment.duration || 3600,
    proctoringMode: application.assessment.proctoringMode || "ai"
  });
});

/**
 * @desc Candidate submits assessment
 * @route POST /api/candidate/applications/:applicationId/assessment/submit
 */
export const submitHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { responses, codingResponses, violations, faceViolations, cameraEnabled, trustScore, aiConfidence, gazeDeviationHistory, faceSnapshotCount, aiEngineType } = req.body;

  const application = await Application.findById(applicationId)
    .populate("candidate", "name email")
    .populate("job", "title postedBy");
    
  if (!application) return res.status(404).json({ message: "Not found" });

  // Score MCQs
  const questions = application.assessment.questions;
  let mcqScore = 0;
  (responses || []).forEach((userAnswer, index) => {
    if (index < questions.length && userAnswer === questions[index].answer) {
      mcqScore++;
    }
  });
  const mcqPercentage = questions.length > 0 ? Math.round((mcqScore / questions.length) * 100) : 0;

  // Coding evaluation: Ensure completion only if code was actually modified from starter
  const codingProblems = application.assessment.codingProblems || [];
  const codingCount = codingProblems.length;
  
  const actualCompletions = (codingResponses || []).filter((r, idx) => {
    if (!r || !r.code) return false;
    const starter = codingProblems[idx]?.starterCode || "";
    const submitted = r.code.trim();
    // Must be different from starter and have reasonable length
    return submitted.length > 10 && submitted !== starter.trim();
  });

  const codingCompletionScore = codingCount > 0 ? Math.round((actualCompletions.length / codingCount) * 100) : 100;

  // Adaptive Scoring Logic
  let finalScore = 0;
  if (questions.length > 0 && codingCount > 0) {
    // Both exist: 70/30 split
    finalScore = Math.round(mcqPercentage * 0.7 + codingCompletionScore * 0.3);
  } else if (questions.length > 0) {
    // Only MCQs: 100%
    finalScore = mcqPercentage;
  } else if (codingCount > 0) {
    // Only Coding: 100%
    finalScore = codingCompletionScore;
  }

  application.assessment.status = "completed";
  application.assessment.responses = responses || [];
  application.assessment.codingResponses = codingResponses || [];
  application.assessment.score = finalScore;
  application.assessment.mcqScore = questions.length > 0 ? mcqPercentage : undefined;
  application.assessment.codingScore = codingCount > 0 ? codingCompletionScore : undefined;
  application.assessment.violations = violations || 0;
  application.assessment.faceViolations = faceViolations || 0;
  application.assessment.cameraEnabled = cameraEnabled || false;
  application.assessment.trustScore = trustScore || 0;
  application.assessment.aiConfidence = aiConfidence || 0;
  application.assessment.faceSnapshotCount = faceSnapshotCount || 0;
  application.assessment.aiEngineType = aiEngineType || "canvas";
  application.assessment.completedAt = new Date();

  // Keep status as 'assessment' (recruiter manually advances to 'interviewing')
  if (application.status !== 'assessment') {
    application.status = 'assessment';
  }

  await application.save();

  // 🔔 Notify Recruiter that assessment was completed
  if (application.job?.postedBy) {
    notifyUser({
      userId: application.job.postedBy,
      title: "Assessment Completed 📋",
      message: `${application.candidate?.name || "A candidate"} scored ${finalScore}% on the technical assessment for "${application.job.title}".`,
      link: `/rpanel/jobs/${application.job._id}/applications`,
      type: "candidate",
      persist: true,
      realtime: true,
      emailEnabled: true,
      emailSubject: `Assessment Completed: ${application.candidate?.name} - ${application.job.title}`,
    }).catch(err => console.error("Recruiter assessment notify error:", err));
  }

  res.json({ 
    message: "Assessment submitted", 
    score: finalScore,
    mcqScore: mcqPercentage,
    codingScore: codingCompletionScore,
    violations: application.assessment.violations,
    faceViolations: application.assessment.faceViolations
  });
});

/**
 * @desc Track violations (tab switches) in real-time
 */
export const reportAssessmentViolation = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { type } = req.body; // "tab" or "face"
  
  const updateField = type === "face" ? "assessment.faceViolations" : "assessment.violations";
  
  await Application.findByIdAndUpdate(applicationId, {
    $inc: { [updateField]: 1 }
  });
  res.json({ success: true });
});

/**
 * @desc Reset assessment for re-take (Recruiter only)
 */
export const resetHiringAssessment = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;

  const application = await Application.findById(applicationId).populate("candidate", "name email").populate("job", "title description");
  if (!application) return res.status(404).json({ message: "Application not found" });

  // Generate completely new questions + coding problems via AI so the retake is unique!
  const { questions, codingProblems } = await generateHiringTest(application.job.title, application.job.description);

  // Reset assessment state and apply new questions
  application.assessment.status = "sent"; 
  application.assessment.questions = questions;
  application.assessment.codingProblems = codingProblems || [];
  application.assessment.score = undefined;
  application.assessment.mcqScore = undefined;
  application.assessment.codingScore = undefined;
  application.assessment.responses = [];
  application.assessment.codingResponses = [];
  application.assessment.violations = 0;
  application.assessment.faceViolations = 0;
  application.assessment.completedAt = undefined;

  await application.save();

  // Notify Candidate
  await notifyUser({
    userId: application.candidate._id,
    email: application.candidate.email,
    title: "Assessment Reset: You have a new test!",
    message: `The recruiter for "${application.job.title}" has reset your technical assessment. You have been assigned a completely fresh set of questions. You can now re-attempt the test from your dashboard. Good luck!`,
    type: "application",
    emailEnabled: true,
    emailSubject: "Action Required: Assessment Re-conducted - OneStop Hub"
  });

  res.json({ message: "Assessment reset successfully! A completely new AI test has been generated for the candidate. ✅" });
});
