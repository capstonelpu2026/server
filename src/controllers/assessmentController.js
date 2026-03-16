import { Assessment, AssessmentAttempt } from "../models/Assessment.js";
import User from "../models/User.js";

/* =====================================================
   📝 CREATE ASSESSMENT (Recruiter/Admin)
===================================================== */
export const createAssessment = async (req, res) => {
  try {
    const { title, description, questions, duration, passingScore, category, difficulty, tags, isPublic, settings } = req.body;

    if (!title || !questions || questions.length === 0 || !duration) {
      return res.status(400).json({ message: "Title, questions, and duration are required" });
    }

    const assessment = await Assessment.create({
      title,
      description,
      questions,
      duration,
      passingScore: passingScore || 60,
      category: category || "General",
      difficulty: difficulty || "Medium",
      tags: tags || [],
      isPublic: isPublic !== false,
      createdBy: req.user._id,
      creatorRole: req.user.role,
      publishedAt: new Date(),
      ...settings
    });

    res.status(201).json({
      message: "Assessment created successfully ✅",
      assessment
    });
  } catch (err) {
    console.error("createAssessment error:", err);
    res.status(500).json({ message: "Error creating assessment" });
  }
};

/* =====================================================
   📋 GET ALL ASSESSMENTS (Public + User's Private)
===================================================== */
export const getAssessments = async (req, res) => {
  try {
    const { category, difficulty, search } = req.query;
    
    const query = {
      isActive: true,
      $or: [
        { isPublic: true },
        { allowedUsers: req.user._id }
      ]
    };

    if (category) query.category = category;
    if (difficulty) query.difficulty = difficulty;
    if (search) query.title = { $regex: search, $options: 'i' };

    const assessments = await Assessment.find(query)
      .populate("createdBy", "name orgName")
      .select("-questions.correctAnswer -questions.explanation") // Hide answers
      .sort({ createdAt: -1 });

    res.json(assessments);
  } catch (err) {
    console.error("getAssessments error:", err);
    res.status(500).json({ message: "Error fetching assessments" });
  }
};

/* =====================================================
   🎯 GET SINGLE ASSESSMENT (For Taking Test)
===================================================== */
export const getAssessment = async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .populate("createdBy", "name orgName")
      .select("-questions.correctAnswer -questions.explanation"); // Hide answers

    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }

    // Check access
    if (!assessment.isPublic && !assessment.allowedUsers.includes(req.user._id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if user already attempted
    const existingAttempt = await AssessmentAttempt.findOne({
      assessment: assessment._id,
      user: req.user._id,
      status: "in-progress"
    });

    res.json({
      assessment,
      hasActiveAttempt: !!existingAttempt,
      attemptId: existingAttempt?._id
    });
  } catch (err) {
    console.error("getAssessment error:", err);
    res.status(500).json({ message: "Error fetching assessment" });
  }
};

/* =====================================================
   ▶️ START ASSESSMENT ATTEMPT
===================================================== */
export const startAttempt = async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    
    if (!assessment || !assessment.isActive) {
      return res.status(404).json({ message: "Assessment not available" });
    }

    // Check for existing in-progress attempt
    const existing = await AssessmentAttempt.findOne({
      assessment: assessment._id,
      user: req.user._id,
      status: "in-progress"
    });

    if (existing) {
      return res.json({
        message: "Resuming existing attempt",
        attempt: existing
      });
    }

    // Create new attempt
    const attempt = await AssessmentAttempt.create({
      assessment: assessment._id,
      user: req.user._id,
      answers: [],
      startedAt: new Date()
    });

    // Increment total attempts
    assessment.totalAttempts += 1;
    await assessment.save();

    res.status(201).json({
      message: "Assessment started ✅",
      attempt,
      duration: assessment.duration
    });
  } catch (err) {
    console.error("startAttempt error:", err);
    res.status(500).json({ message: "Error starting assessment" });
  }
};

/* =====================================================
   💾 SAVE ANSWER (Auto-save during test)
===================================================== */
export const saveAnswer = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const { questionId, answer, timeTaken } = req.body;

    const attempt = await AssessmentAttempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in-progress"
    });

    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found or already submitted" });
    }

    // Update or add answer
    const existingIndex = attempt.answers.findIndex(a => a.questionId.toString() === questionId);
    
    if (existingIndex >= 0) {
      attempt.answers[existingIndex].answer = answer;
      attempt.answers[existingIndex].timeTaken = timeTaken;
    } else {
      attempt.answers.push({ questionId, answer, timeTaken });
    }

    await attempt.save();

    res.json({ message: "Answer saved", attempt });
  } catch (err) {
    console.error("saveAnswer error:", err);
    res.status(500).json({ message: "Error saving answer" });
  }
};

/* =====================================================
   📊 SUBMIT ASSESSMENT
===================================================== */
export const submitAssessment = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const attempt = await AssessmentAttempt.findOne({
      _id: attemptId,
      user: req.user._id
    }).populate("assessment");

    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }

    if (attempt.status === "submitted") {
      return res.status(400).json({ message: "Already submitted" });
    }

    const assessment = attempt.assessment;

    // Grade the assessment
    let totalPoints = 0;
    let earnedPoints = 0;

    attempt.answers.forEach(userAnswer => {
      const question = assessment.questions.id(userAnswer.questionId);
      if (!question) return;

      totalPoints += question.points;

      // Check if correct
      let isCorrect = false;
      if (question.type === "MCQ" || question.type === "True/False" || question.type === "Short Answer") {
        isCorrect = userAnswer.answer?.toString().toLowerCase() === question.correctAnswer?.toString().toLowerCase();
      } else if (question.type === "Multiple Select") {
        const correct = Array.isArray(question.correctAnswer) ? question.correctAnswer.sort() : [];
        const user = Array.isArray(userAnswer.answer) ? userAnswer.answer.sort() : [];
        isCorrect = JSON.stringify(correct) === JSON.stringify(user);
      }

      if (isCorrect) {
        earnedPoints += question.points;
        userAnswer.pointsEarned = question.points;
      } else {
        userAnswer.pointsEarned = 0;
      }

      userAnswer.isCorrect = isCorrect;
    });

    const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    const passed = percentage >= assessment.passingScore;

    attempt.totalScore = earnedPoints;
    attempt.percentage = Math.round(percentage * 100) / 100;
    attempt.passed = passed;
    attempt.submittedAt = new Date();
    attempt.timeSpent = Math.floor((attempt.submittedAt - attempt.startedAt) / 1000);
    attempt.status = "submitted";

    await attempt.save();

    // Update assessment average score
    const allAttempts = await AssessmentAttempt.find({
      assessment: assessment._id,
      status: "submitted"
    });

    const avgScore = allAttempts.reduce((sum, a) => sum + a.percentage, 0) / allAttempts.length;
    assessment.averageScore = Math.round(avgScore * 100) / 100;
    await assessment.save();

    // ✨ GAMIFICATION: Reward XP for passing
    if (passed) {
      const bonus = percentage === 100 ? 50 : 0; // Perfect score bonus
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { "points": 100 + bonus }
      });
    }

    res.json({
      message: passed ? "Congratulations! You passed! 🎉" : "Assessment submitted",
      result: {
        score: earnedPoints,
        totalPoints,
        percentage: attempt.percentage,
        passed,
        timeSpent: attempt.timeSpent
      },
      attempt
    });
  } catch (err) {
    console.error("submitAssessment error:", err);
    res.status(500).json({ message: "Error submitting assessment" });
  }
};

/* =====================================================
   🚨 REPORT TAB SWITCH
===================================================== */
export const reportTabSwitch = async (req, res) => {
  try {
    const { attemptId } = req.params;

    const attempt = await AssessmentAttempt.findOne({
      _id: attemptId,
      user: req.user._id
    }).populate("assessment");

    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }

    attempt.tabSwitches += 1;

    if (attempt.tabSwitches >= attempt.assessment.tabSwitchLimit) {
      attempt.flagged = true;
      attempt.flagReason = `Exceeded tab switch limit (${attempt.tabSwitches}/${attempt.assessment.tabSwitchLimit})`;
      attempt.status = "flagged";
      await attempt.save();

      return res.json({
        message: "Assessment flagged for suspicious activity",
        flagged: true,
        autoSubmit: true
      });
    }

    await attempt.save();

    res.json({
      message: "Tab switch recorded",
      tabSwitches: attempt.tabSwitches,
      limit: attempt.assessment.tabSwitchLimit,
      warning: attempt.tabSwitches >= attempt.assessment.tabSwitchLimit - 1
    });
  } catch (err) {
    console.error("reportTabSwitch error:", err);
    res.status(500).json({ message: "Error reporting tab switch" });
  }
};

/* =====================================================
   📈 GET MY ATTEMPTS
===================================================== */
export const getMyAttempts = async (req, res) => {
  try {
    const attempts = await AssessmentAttempt.find({
      user: req.user._id
    })
      .populate("assessment", "title category difficulty duration")
      .sort({ createdAt: -1 });

    res.json(attempts);
  } catch (err) {
    console.error("getMyAttempts error:", err);
    res.status(500).json({ message: "Error fetching attempts" });
  }
};

/* =====================================================
   🎓 GET ATTEMPT RESULT (After Submission)
===================================================== */
export const getAttemptResult = async (req, res) => {
  try {
    const attempt = await AssessmentAttempt.findOne({
      _id: req.params.attemptId,
      user: req.user._id
    }).populate("assessment");

    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }

    if (attempt.status !== "submitted") {
      return res.status(400).json({ message: "Assessment not yet submitted" });
    }

    res.json({
      attempt,
      assessment: attempt.assessment
    });
  } catch (err) {
    console.error("getAttemptResult error:", err);
    res.status(500).json({ message: "Error fetching result" });
  }
};
