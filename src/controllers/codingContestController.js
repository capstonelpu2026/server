import CodingContest from "../models/CodingContest.js";
import AuditLog from "../models/AuditLog.js";
import cloudinary from "../utils/cloudinary.js";
import multer from "multer";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendEmail } from "../utils/sendEmail.js";

/* -------------------------------------------------------
   📦 Multer — banner upload
------------------------------------------------------- */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const uploadToCloudinary = (buffer, folder, name) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", public_id: `${Date.now()}_${name}` },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(buffer);
  });

/* -------------------------------------------------------
   🤖 AI Helpers
------------------------------------------------------- */
const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });
const getGemini = () => new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractJSON = (text, isArray = false) => {
  const s = isArray ? "[" : "{";
  const e = isArray ? "]" : "}";
  const si = text.indexOf(s);
  const ei = text.lastIndexOf(e);
  if (si !== -1 && ei > si) text = text.substring(si, ei + 1);
  else text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(text);
};

/* -------------------------------------------------------
   🤖 POST /api/code-arena/ai-meta
   Generate full contest METADATA from a natural-language prompt
   (title, subtitle, description, company, difficulty, tags, rules, prizes)
------------------------------------------------------- */
export const aiGenerateContestMeta = async (req, res) => {
  try {
    const { prompt: userPrompt = "" } = req.body;

    if (!userPrompt.trim()) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    const prompt = `
You are an expert contest organizer and engineering director. A super-admin from an ed-tech platform has described the 24-hour coding contest they want to create. Generate complete, professional contest metadata based on their description.

Super-admin description: "${userPrompt}"

Generate a JSON object with this EXACT structure:
{
  "title": "A compelling, specific contest title (max 60 chars)",
  "subtitle": "A punchy tagline/motto for the contest (max 120 chars)",
  "description": "A professional 2-3 paragraph contest description explaining objectives, target audience, and what makes it unique. Use corporate tone.",
  "company": "Organizing company/institution name (infer from description or use 'OneStop')",
  "difficulty": "Beginner" | "Intermediate" | "Advanced" | "Expert",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "rules": [
    "Rule 1 (NO plagiarism, fair play, etc.)",
    "Rule 2",
    "Rule 3",
    "Rule 4",
    "Rule 5"
  ],
  "prizes": [
    { "rank": 1, "title": "🥇 First Place", "amount": "₹10,000 / Swag Kit", "perks": ["Certificate of Excellence", "Featured profile badge"] },
    { "rank": 2, "title": "🥈 Second Place", "amount": "₹5,000", "perks": ["Certificate of Merit"] },
    { "rank": 3, "title": "🥉 Third Place", "amount": "₹2,500", "perks": ["Certificate of Participation"] }
  ],
  "aiSuggestedTopic": "Recommended topic for problem generation (e.g. 'Graph Algorithms, Dynamic Programming')",
  "aiSuggestedLanguage": "javascript" | "python" | "cpp" | "java",
  "aiSuggestedCount": 3
}

Return ONLY valid JSON. No markdown. No explanation. Start immediately with {.
`;

    let text = "";
    try {
      const groq = getGroq();
      const resp = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.75,
        max_tokens: 2500,
      });
      text = resp.choices[0]?.message?.content || "";
    } catch (groqErr) {
      console.warn("Groq meta-gen failed, falling back to Gemini:", groqErr.message);
      const gemini = getGemini();
      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      text = result.response.text();
    }

    const meta = extractJSON(text, false);
    res.json({ meta });
  } catch (err) {
    console.error("aiGenerateContestMeta error:", err.message);
    res.status(500).json({ message: "AI generation failed. Please try again." });
  }
};

/* -------------------------------------------------------
   🤖 POST /api/code-arena/ai-generate
   Generate full contest problems via AI
------------------------------------------------------- */
export const aiGenerateContest = async (req, res) => {
  try {
    const {
      topic = "Data Structures & Algorithms",
      difficulty = "Intermediate",
      count = 3,
      language = "javascript",
      companyStyle = "Google",
      context = "",
    } = req.body;

    const prompt = `
You are a Senior Engineering Director at ${companyStyle}. Design ${count} coding contest problems for a 24-hour online competition.

Topic: ${topic}
Difficulty Level: ${difficulty}
Programming Language: ${language}
${context ? `Special Requirements: ${context}` : ""}

Create EXACTLY ${count} problems. Each problem should escalate in difficulty. For a ${difficulty} contest:
- Problem 1: Warm-up (Easy-Medium)
- Problem 2+: Core challenge (Medium-Hard)

For each problem, generate:
{
  "title": "Catchy, creative problem name like a FAANG interview question",
  "description": "Full problem statement with examples, input/output format, and at least 2 worked examples",
  "difficulty": "Easy" | "Medium" | "Hard",
  "constraints": ["Time: O(n log n)", "1 <= n <= 10^5", "etc"],
  "inputFormat": "Describe the input format",
  "outputFormat": "Describe the expected output",
  "starterCode": "// Language: ${language}\\nfunction solve(input) {\\n  // Your solution here\\n}",
  "testCases": [
    { "input": "actual input string", "expectedOutput": "expected output string", "isHidden": false, "marks": 25 },
    { "input": "edge case input", "expectedOutput": "edge output", "isHidden": true, "marks": 25 }
  ],
  "points": 100
}

Return ONLY a valid JSON array. No markdown, no explanation. Start immediately with [.
`;

    let text = "";
    try {
      const groq = getGroq();
      const resp = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        max_tokens: 6000,
      });
      text = resp.choices[0]?.message?.content || "";
    } catch (groqErr) {
      console.warn("Groq failed, falling back to Gemini:", groqErr.message);
      const gemini = getGemini();
      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      text = result.response.text();
    }

    const problems = extractJSON(text, true);
    res.json({ problems });
  } catch (err) {
    console.error("AI Contest Generate Error:", err.message);
    // Fallback sample problems
    res.json({
      problems: [
        {
          title: "Two Sum Variant",
          description: "Given an array of integers nums and an integer target, return indices of the two numbers that add up to target.\n\nExample:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]",
          difficulty: "Easy",
          constraints: ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9"],
          inputFormat: "Line 1: space-separated integers\nLine 2: target integer",
          outputFormat: "Two space-separated indices",
          starterCode: `function twoSum(nums, target) {\n  // Your solution here\n}`,
          testCases: [
            { input: "[2,7,11,15]\n9", expectedOutput: "[0,1]", isHidden: false, marks: 50 },
            { input: "[3,2,4]\n6", expectedOutput: "[1,2]", isHidden: true, marks: 50 },
          ],
          points: 100,
        },
        {
          title: "Maximum Subarray",
          description: "Given an integer array nums, find the subarray with the largest sum and return its sum.\n\nExample:\nInput: nums = [-2,1,-3,4,-1,2,1,-5,4]\nOutput: 6",
          difficulty: "Medium",
          constraints: ["1 <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4"],
          inputFormat: "Space-separated integers",
          outputFormat: "Single integer — maximum subarray sum",
          starterCode: `function maxSubArray(nums) {\n  // Your solution here\n}`,
          testCases: [
            { input: "[-2,1,-3,4,-1,2,1,-5,4]", expectedOutput: "6", isHidden: false, marks: 50 },
            { input: "[1]", expectedOutput: "1", isHidden: true, marks: 50 },
          ],
          points: 200,
        },
      ],
    });
  }
};

/* -------------------------------------------------------
   📋 GET /api/code-arena/contests
   Public: list all published, non-draft contests
------------------------------------------------------- */
export const listContests = async (req, res) => {
  try {
    const { status, page = 1, limit = 12 } = req.query;
    const now = new Date();

    const query = { isPublished: true };
    if (status === "upcoming") query.startAt = { $gt: now };
    if (status === "live")     { query.startAt = { $lte: now }; query.endAt = { $gte: now }; }
    if (status === "completed") query.endAt = { $lt: now };

    const total = await CodingContest.countDocuments(query);
    const contests = await CodingContest
      .find(query, { problems: 0, participants: 0 }) // lean — no heavy fields
      .sort({ startAt: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("createdBy", "name")
      .lean({ virtuals: true });

    res.json({ contests, total, page: Number(page), pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("listContests error:", err);
    res.status(500).json({ message: "Error fetching contests" });
  }
};

/* -------------------------------------------------------
   🔍 GET /api/code-arena/contests/:id
   Public: single contest detail (problems sanitized — no hidden test cases)
------------------------------------------------------- */
export const getContestById = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id)
      .populate("createdBy", "name")
      .lean({ virtuals: true });

    if (!contest) return res.status(404).json({ message: "Contest not found" });

    // Sanitize: remove hidden test cases from problems for public response
    const sanitizedProblems = (contest.problems || []).map(p => ({
      ...p,
      testCases: (p.testCases || []).filter(tc => !tc.isHidden),
    }));

    res.json({ ...contest, problems: sanitizedProblems });
  } catch (err) {
    console.error("getContestById error:", err);
    res.status(500).json({ message: "Error fetching contest" });
  }
};

/* -------------------------------------------------------
   ➕ POST /api/code-arena/contests
   Admin/SuperAdmin: create contest (manual or AI-assisted)
------------------------------------------------------- */
export const createContest = async (req, res) => {
  try {
    let body = req.body;

    // Parse JSON fields if sent as FormData strings
    const jsonFields = ["problems", "prizes", "rules", "tags", "languages"];
    jsonFields.forEach(field => {
      if (typeof body[field] === "string") {
        try { body[field] = JSON.parse(body[field]); } catch { /* keep as string */ }
      }
    });

    // Parse startAt
    if (!body.startAt) {
      return res.status(400).json({ message: "startAt is required" });
    }

    const contest = new CodingContest({
      ...body,
      createdBy: req.user._id,
      durationHours: 24,        // always 24h
    });

    // Banner upload
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.buffer, "onestop/arenas", "banner");
      contest.banner = { url: uploaded.secure_url, publicId: uploaded.public_id };
    }

    await contest.save();

    await AuditLog.create({
      action: "CREATE_CODING_CONTEST",
      performedBy: req.user._id,
      details: `Created coding contest "${contest.title}" — starts ${contest.startAt}`,
    });

    res.status(201).json({ message: "Contest created successfully!", contest });
  } catch (err) {
    console.error("createContest error:", err);
    import("fs").then(fs => fs.writeFileSync("last_error.txt", err.stack + "\n\n" + JSON.stringify(err.errors || {})));
    res.status(500).json({ message: "Error creating contest", error: err.message, validationErrors: err.errors });
  }
};

/* -------------------------------------------------------
   ✏️ PUT /api/code-arena/contests/:id
   Admin: update contest
------------------------------------------------------- */
export const updateContest = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const now = new Date();
    if (now >= contest.startAt && contest.isPublished) {
      return res.status(400).json({ message: "Cannot edit a live/completed contest" });
    }

    let body = req.body;
    const jsonFields = ["problems", "prizes", "rules", "tags", "languages"];
    jsonFields.forEach(field => {
      if (typeof body[field] === "string") {
        try { body[field] = JSON.parse(body[field]); } catch { /* keep */ }
      }
    });

    const updatable = ["title", "subtitle", "description", "company", "difficulty",
      "tags", "startAt", "durationHours", "registrationDeadline", "status",
      "problems", "prizes", "rules", "maxParticipants", "isPublished", "languages", "mode"];

    updatable.forEach(k => {
      if (body[k] !== undefined) contest[k] = body[k];
    });

    if (req.file) {
      if (contest.banner?.publicId) {
        try { await cloudinary.uploader.destroy(contest.banner.publicId); } catch {}
      }
      const uploaded = await uploadToCloudinary(req.file.buffer, "onestop/arenas", "banner");
      contest.banner = { url: uploaded.secure_url, publicId: uploaded.public_id };
    }

    await contest.save();
    res.json({ message: "Contest updated", contest });
  } catch (err) {
    console.error("updateContest error:", err);
    res.status(500).json({ message: "Error updating contest" });
  }
};

/* -------------------------------------------------------
   🗑️ DELETE /api/code-arena/contests/:id
------------------------------------------------------- */
export const deleteContest = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    if (contest.banner?.publicId) {
      try { await cloudinary.uploader.destroy(contest.banner.publicId); } catch {}
    }

    await contest.deleteOne();
    await AuditLog.create({
      action: "DELETE_CODING_CONTEST",
      performedBy: req.user._id,
      details: `Deleted coding contest "${contest.title}"`,
    });

    res.json({ message: "Contest deleted" });
  } catch (err) {
    console.error("deleteContest error:", err);
    res.status(500).json({ message: "Error deleting contest" });
  }
};

/* -------------------------------------------------------
   🎟️ POST /api/code-arena/contests/:id/register
   Authenticated user registers for contest
------------------------------------------------------- */
export const registerForContest = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const now = new Date();

    // Auto-fix: if endAt is missing, compute it from startAt + 24h
    if (!contest.endAt && contest.startAt) {
      contest.endAt = new Date(new Date(contest.startAt).getTime() + 24 * 3600 * 1000);
    }

    // Auto-fix: if registrationDeadline was incorrectly set to startAt (old bug), reset to endAt
    if (contest.registrationDeadline && contest.endAt) {
      const dlMs = new Date(contest.registrationDeadline).getTime();
      const startMs = new Date(contest.startAt).getTime();
      if (Math.abs(dlMs - startMs) < 60000) {
        // deadline ≈ startAt → the old bad default; fix it to endAt
        contest.registrationDeadline = contest.endAt;
      }
    }

    // Check contest hasn't ended
    if (contest.endAt && now > contest.endAt) {
      return res.status(400).json({ message: "Contest has already ended" });
    }

    // Check registration deadline (now correctly = endAt)
    if (contest.registrationDeadline && now > contest.registrationDeadline) {
      return res.status(400).json({ message: "Registration deadline has passed" });
    }

    const alreadyIn = contest.participants.some(
      p => String(p.userId) === String(req.user._id)
    );
    if (alreadyIn) return res.status(400).json({ message: "Already registered" });

    if (contest.maxParticipants > 0 && contest.participants.length >= contest.maxParticipants) {
      return res.status(400).json({ message: "Contest is full" });
    }

    contest.participants.push({
      userId: req.user._id,
      name:   req.user.name  || "Participant",
      email:  req.user.email || "",
    });

    await contest.save();
    res.status(201).json({ message: "Registered successfully!" });
  } catch (err) {
    console.error("registerForContest error:", err);
    res.status(500).json({ message: "Error registering" });
  }
};


/* -------------------------------------------------------
   💾 POST /api/code-arena/contests/:id/submit
   Submit solution for a problem (AI-evaluated)
------------------------------------------------------- */
export const submitSolution = async (req, res) => {
  try {
    const { problemId, code, language, evaluation } = req.body;
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const now = new Date();
    if (now < contest.startAt) return res.status(400).json({ message: "Contest hasn't started yet" });
    if (now > contest.endAt)   return res.status(400).json({ message: "Contest has ended" });

    const participant = contest.participants.find(
      p => String(p.userId) === String(req.user._id)
    );
    if (!participant) return res.status(403).json({ message: "You are not registered for this contest" });

    if (participant.isDisqualified) {
      return res.status(403).json({ message: "Your access has been revoked due to proctoring violations." });
    }

    // Find the problem definition to get max points
    const problem = contest.problems.id(problemId);
    const maxPoints = problem?.points || 100;
    const score = Math.round((evaluation?.score || 0) / 100 * maxPoints);

    // Update or add submission
    const existingIdx = participant.submissions.findIndex(
      s => String(s.problemId) === String(problemId)
    );

    const submissionData = {
      problemId,
      code,
      language,
      status:      (evaluation?.status || "rejected").toLowerCase(),
      score,
      submittedAt: new Date(),
      evaluation,
    };

    if (existingIdx >= 0) {
      // Only update if new score is better
      if (score > participant.submissions[existingIdx].score) {
        participant.submissions[existingIdx] = submissionData;
      }
    } else {
      participant.submissions.push(submissionData);
    }

    // Recompute totals
    participant.totalScore = participant.submissions.reduce((s, sub) => s + (sub.score || 0), 0);
    participant.solvedCount = participant.submissions.filter(s => s.status === "accepted").length;
    participant.lastSubmissionAt = new Date();

    await contest.save();

    // ✨ GAMIFICATION: Reward XP only if this is the FIRST time they solve this problem
    if (submissionData.status === "accepted") {
      const isFirstSuccess = participant.submissions.filter(s => 
        String(s.problemId) === String(problemId) && s.status === "accepted"
      ).length === 1;

      if (isFirstSuccess) {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: { 
            "points": 50,
            "arenaStats.totalXP": 50,
            "arenaStats.solvedChallenges": 1
          }
        });
      }
    }

    res.json({ message: "Solution submitted!", score, status: submissionData.status });
  } catch (err) {
    console.error("submitSolution error:", err);
    res.status(500).json({ message: "Error submitting solution" });
  }
};

/* -------------------------------------------------------
   📊 GET /api/code-arena/contests/:id/leaderboard
------------------------------------------------------- */
export const getLeaderboard = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id)
      .select("participants title startAt endAt")
      .lean();
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const sorted = [...contest.participants]
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        // Tie-break: earlier last submission wins
        const timeA = a.lastSubmissionAt ? new Date(a.lastSubmissionAt).getTime() : Infinity;
        const timeB = b.lastSubmissionAt ? new Date(b.lastSubmissionAt).getTime() : Infinity;
        if (timeA !== timeB) return timeA - timeB;
        return a.joinedAt - b.joinedAt;
      });

    const leaderboard = sorted.map((p, idx) => ({
      rank:        idx + 1,
      userId:      p.userId,
      name:        p.name,
      email:       p.email,
      totalScore:  p.totalScore,
      solvedCount: p.solvedCount,
      attemptCount: p.submissions?.length || 0,
      joinedAt:    p.joinedAt,
      // Proctoring fields
      violationLogs:  p.violationLogs || [],
      certificateUniqueId: p.certificateUniqueId || null,
    }));

    // Generate unique IDs for those who don't have it
    let modified = false;
    for (const p of contest.participants) {
      if (!p.certificateUniqueId) {
        p.certificateUniqueId = `CERT-ARENA-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        modified = true;
      }
    }
    if (modified) {
      await CodingContest.updateOne({ _id: contest._id }, { participants: contest.participants });
    }

    res.json({ leaderboard, totalParticipants: contest.participants.length });
  } catch (err) {
    console.error("getLeaderboard error:", err);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
};

/* -------------------------------------------------------
   📋 GET /api/code-arena/contests/admin/all
   Admin: full list including drafts
------------------------------------------------------- */
export const adminListContests = async (req, res) => {
  try {
    const contests = await CodingContest.find()
      .populate("createdBy", "name email")
      .select("-participants -problems.testCases")
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    res.json({ contests });
  } catch (err) {
    console.error("adminListContests error:", err);
    res.status(500).json({ message: "Error fetching admin contests" });
  }
};

/* -------------------------------------------------------
   🏆 POST /api/code-arena/contests/admin/:id/certificates
   Admin: Generate and email physical-looking HTML certificates
------------------------------------------------------- */
export const generateAndSendCertificates = async (req, res) => {
  try {
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    // filter out disqualified participants
    const eligibleParticipants = contest.participants.filter(p => !p.isDisqualified);

    if (eligibleParticipants.length === 0) {
      return res.status(400).json({ message: "No eligible participants found for certificates." });
    }

    // Sort eligible participants to find 1st place
    const sorted = [...eligibleParticipants].sort(
      (a, b) => b.totalScore - a.totalScore || a.joinedAt - b.joinedAt
    );

    let sentCount = 0;
    const errors = [];

    // Loop through sorted participants array where index 0 is 1st place
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (!p.email) continue;

      const isWinner = i === 0 && p.totalScore > 0; // Must have actually scored
      const roleText = isWinner ? "1st Place Winner" : "Participant";
      const subject = isWinner
        ? `🏆 Golden Certificate: 1st Place - ${contest.title}`
        : `📜 Certificate of Participation - ${contest.title}`;

      // HTML Certificate styled block
      let certHtml = "";

      if (isWinner) {
        // Golden Certificate
        certHtml = `
          <div style="font-family: 'Times New Roman', serif; padding: 40px; background: linear-gradient(135deg, #18181b 0%, #000000 100%); color: #fff; text-align: center; border: 8px solid #cca152; border-radius: 10px; max-width: 800px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="border: 1px solid #cca152; padding: 30px;">
              <h1 style="color: #cca152; font-size: 36px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 4px;">Code Arena<br/>Golden Certificate</h1>
              <p style="color: #a1a1aa; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">Award of Excellence</p>
              
              <div style="margin: 40px 0;">
                <p style="font-style: italic; font-size: 18px; color: #e4e4e7;">This is proudly presented to</p>
                <h2 style="font-size: 42px; margin: 15px 0; color: #cca152; font-family: 'Brush Script MT', cursive, serif;">${p.name}</h2>
                <p style="font-size: 18px; color: #e4e4e7;">For achieving <strong>1st Place</strong> in the highly competitive</p>
                <h3 style="font-size: 24px; color: #fff; margin-top: 10px; font-family: Arial, sans-serif;">${contest.title}</h3>
                <p style="font-size: 16px; color: #a1a1aa; margin-top: 10px; font-family: Arial, sans-serif;">with a total score of <strong>${p.totalScore}</strong> resolving <strong>${p.solvedCount}</strong> problems.</p>
              </div>
              
              <table style="width: 100%; margin-top: 50px; font-family: Arial, sans-serif;">
                <tr>
                  <td style="text-align: left; width: 33%;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 24px; color: #cca152; padding-left: 20px;">Chaithanya</div>
                    <div style="border-top: 1px solid #cca152; width: 140px; padding-top: 5px; font-size: 12px; color: #a1a1aa; text-transform: uppercase;">Platform Director</div>
                  </td>
                  <td style="text-align: center; width: 34%;">
                    <div style="font-size: 40px;">🏆</div>
                    <div style="font-size: 14px; margin-top: 10px; color: #cca152; font-weight: bold; letter-spacing: 2px;">ONESTOP HUB</div>
                  </td>
                  <td style="text-align: right; width: 33%;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 24px; color: #cca152; padding-right: 20px; text-align: right;">OneStop</div>
                    <div style="border-top: 1px solid #cca152; width: 140px; float: right; padding-top: 5px; font-size: 12px; color: #a1a1aa; text-align: center; text-transform: uppercase;">Event Coordinator</div>
                  </td>
                </tr>
              </table>
            </div>
          </div>
        `;
      } else {
        // Standard Certificate
        certHtml = `
          <div style="font-family: Arial, sans-serif; padding: 40px; background: #ffffff; color: #333; text-align: center; border: 8px solid #4f46e5; border-radius: 10px; max-width: 800px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
            <div style="border: 1px solid #e2e8f0; padding: 40px; background: #f8fafc;">
              <h1 style="color: #4f46e5; font-size: 36px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 2px;">Code Arena<br/>Certificate of Participation</h1>
              
              <div style="margin: 40px 0;">
                <p style="font-size: 18px; color: #64748b;">This acknowledges that</p>
                <h2 style="font-size: 36px; margin: 15px 0; color: #0f172a;">${p.name}</h2>
                <p style="font-size: 18px; color: #64748b;">has successfully participated in</p>
                <h3 style="font-size: 24px; color: #334155; margin-top: 10px;">${contest.title}</h3>
                <p style="font-size: 14px; color: #94a3b8; margin-top: 10px;">Scored ${p.totalScore} Points • Solved ${p.solvedCount} Problems</p>
              </div>
              
              <table style="width: 100%; margin-top: 50px; font-family: Arial, sans-serif;">
                <tr>
                  <td style="text-align: left; width: 33%;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 24px; color: #4f46e5; padding-left: 20px;">Chaithanya</div>
                    <div style="border-top: 1px solid #cbd5e1; width: 140px; padding-top: 5px; font-size: 12px; color: #64748b; text-transform: uppercase;">Platform Director</div>
                  </td>
                  <td style="text-align: center; width: 34%;">
                    <div style="font-size: 30px; color: #4f46e5;">💻</div>
                    <div style="font-size: 12px; margin-top: 8px; color: #4f46e5; font-weight: bold; letter-spacing: 2px;">ONESTOP HUB</div>
                  </td>
                  <td style="text-align: right; width: 33%;">
                    <div style="font-family: 'Brush Script MT', cursive; font-size: 24px; color: #4f46e5; padding-right: 20px; text-align: right;">OneStop</div>
                    <div style="border-top: 1px solid #cbd5e1; width: 140px; float: right; padding-top: 5px; font-size: 12px; color: #64748b; text-align: center; text-transform: uppercase;">Event Coordinator</div>
                  </td>
                </tr>
              </table>
            </div>
          </div>
        `;
      }

      // Wrap in standard layout
      const fullEmailHtml = `
        <div style="background: #f1f5f9; padding: 40px 20px;">
           <p style="text-align: center; font-size: 16px; color: #475569; margin-bottom: 30px;">
             Hello ${p.name}, congratulations on your performance in <strong>${contest.title}</strong>!
             Your official e-certificate is included below.
           </p>
           ${certHtml}
        </div>
      `;

      const result = await sendEmail(p.email, subject, "Please view this email in an HTML compatible client.", fullEmailHtml);
      if (result.success) sentCount++;
      else errors.push({ user: p.name, email: p.email, error: result.error });
    }

    await AuditLog.create({
      action: "GENERATE_CODE_ARENA_CERTS",
      performedBy: req.user._id,
      details: `Sent ${sentCount} certificates for '${contest.title}'`,
    });

    res.json({ message: `Successfully generated and sent ${sentCount} certificates.`, sentCount, errors });
  } catch (err) {
    console.error("generateAndSendCertificates error:", err);
    res.status(500).json({ message: "Failed to generate certificates. Check logs." });
  }
};

/* -------------------------------------------------------
   🛡️ POST /api/code-arena/contests/:id/violation
   Candidate: Report a violation detected by AI
------------------------------------------------------- */
export const logViolation = async (req, res) => {
  try {
    const { category, details } = req.body;
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const participant = contest.participants.find(p => String(p.userId) === String(req.user._id));
    if (!participant) return res.status(403).json({ message: "Not registered." });

    if (participant.isDisqualified) {
      return res.status(403).json({ message: "Your access has been revoked due to proctoring violations." });
    }

    // The original check for disqualified participant, now returning a different message/status
    // if (participant.isDisqualified) {
    //   return res.json({ disqualified: true, message: "Participant is already disqualified." });
    // }

    participant.violationCount = (participant.violationCount || 0) + 1;
    participant.violationLogs.push({ category, details, timestamp: new Date() });

    // Auto-disqualify if 3 violations reached
    if (participant.violationCount >= 3) {
      participant.isDisqualified = true;
    }

    await contest.save();
    res.json({
      violationCount: participant.violationCount,
      disqualified:   participant.isDisqualified,
      message: participant.isDisqualified ? "VIOLATION_LIMIT_REACHED" : "VIOLATION_RECORDED"
    });
  } catch (err) {
    console.error("logViolation error:", err);
    res.status(500).json({ message: "Failed to record violation" });
  }
};

/* -------------------------------------------------------
   ⚠️ POST /api/code-arena/contests/admin/:id/warning
   Admin: Send warning email to specific participant
------------------------------------------------------- */
export const sendWarningEmail = async (req, res) => {
  try {
    const { userId } = req.body;
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const participant = contest.participants.find(p => String(p.userId) === String(userId));
    if (!participant) return res.status(403).json({ message: "Participant not found." });

    const html = `
      <div style="font-family: Arial, sans-serif; background: #fff1f2; border: 4px solid #f43f5e; padding: 40px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e11d48; margin-top: 0;">⚠️ FINAL WARNING</h1>
        <p style="font-size: 18px; color: #1e293b;">Dear <strong>${participant.name}</strong>,</p>
        <p style="font-size: 16px; color: #475569; line-height: 1.6;">
          Our AI proctoring system has detected suspicious activity during your attempt at <strong>${contest.title}</strong>.
        </p>
        <div style="background: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fb7185;">
          <p style="margin: 0; color: #e11d48; font-weight: bold;">VIOLATION NOTICE:</p>
          <p style="margin: 5px 0 0 0; color: #475569;">Multiple gaze deviations or unauthorized object detected. One more violation will result in <strong>immediate disqualification</strong>.</p>
        </div>
        <p style="margin-top: 30px; font-weight: bold; color: #1e293b;">Please maintain focus on your screen and ensure you are in a quiet, well-lit environment with no other people or mobile devices present.</p>
        <hr style="border: 0; border-top: 1px solid #fda4af; margin: 30px 0;"/>
        <p style="font-size: 12px; color: #94a3b8;">This is an automated security notice from OneStop Hub Proctoring Command.</p>
      </div>
    `;

    const result = await sendEmail(participant.email, `⚠️ Critical Proctoring Warning - ${contest.title}`, " SUSPICIOUS ACTIVITY DETECTED", html);
    
    if (result.success) {
      participant.warningSent = true;
      await contest.save();
      res.json({ message: "Warning email sent successfully." });
    } else {
      res.status(500).json({ message: "Failed to send email." });
    }
  } catch (err) {
    console.error("sendWarningEmail error:", err);
    res.status(500).json({ message: "Error sending warning" });
  }
};

/* -------------------------------------------------------
   🔒 POST /api/code-arena/contests/admin/:id/disqualify
   Admin: Manually disqualify/ban participant
------------------------------------------------------- */
export const disqualifyParticipant = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const contest = await CodingContest.findById(req.params.id);
    if (!contest) return res.status(404).json({ message: "Contest not found" });

    const participant = contest.participants.find(p => String(p.userId) === String(userId));
    if (!participant) return res.status(404).json({ message: "Participant not found." });

    participant.isDisqualified = true;
    participant.violationLogs.push({ category: "admin_manual_ban", details: reason || "Manual disqualification by admin.", timestamp: new Date() });

    await contest.save();
    res.json({ message: "Participant has been disqualified and locked out." });
  } catch (err) {
    console.error("disqualifyParticipant error:", err);
    res.status(500).json({ message: "Failed to disqualify participant" });
  }
};
