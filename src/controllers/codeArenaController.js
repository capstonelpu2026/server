import Groq from "groq-sdk";
import asyncHandler from "express-async-handler";
import { GoogleGenerativeAI } from "@google/generative-ai";
import User from "../models/User.js";
import { parseAIJson } from "../utils/parseAIJson.js";

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in environment variables.");
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

const getGeminiClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};

const extractJSON = (text, isArray = false) => {
    let cleanText = text;
    const startChar = isArray ? "[" : "{";
    const endChar = isArray ? "]" : "}";
    
    const startIdx = text.indexOf(startChar);
    const endIdx = text.lastIndexOf(endChar);
    
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleanText = text.substring(startIdx, endIdx + 1);
    } else {
        cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    }
    
    try {
        return JSON.parse(cleanText);
    } catch (e) {
        // Simple repair
        if (cleanText.startsWith(startChar) && !cleanText.endsWith(endChar)) {
            const lastIdx = cleanText.lastIndexOf(endChar === "]" ? "}" : `"`);
            if (lastIdx !== -1) {
                const repairedText = cleanText.substring(0, lastIdx + 1) + (isArray ? "}]" : "}");
                return JSON.parse(repairedText);
            }
        }
        throw e;
    }
};

/**
 * @desc Generate contest metadata (title, prizes, rules) for CreateContest
 * @route POST /api/ai/code-arena/ai-meta
 * @access Private
 */
export const generateContestMeta = asyncHandler(async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        res.status(400);
        throw new Error("Prompt is required");
    }

    try {
        const groq = getGroqClient();
        const aiPrompt = `
      Act as a Lead Technical Program Manager and Contest Architect. 
      Generate a complete coding contest configuration based on this requirement: "${prompt}"

      Provide the following:
      1. title: Professional and catchy name for the contest.
      2. subtitle: A short inspiring tagline.
      3. description: Detailed objectives and introduction (2-3 paragraphs).
      4. company: The organization name (e.g., "Google", "OneStop Hub").
      5. difficulty: Beginner, Intermediate, Advanced, or Expert.
      6. tags: Array of 3-5 technical tags (e.g., ["Python", "DSA", "Logic"]).
      7. rules: Array of 5 professional contest rules.
      8. prizes: Array of 3 prize objects with "rank" (number), "title", "amount", and "perks" (array of strings).
      9. aiSuggestedTopic: A specific technical topic for problems (e.g. "Dynamic Programming").
      10. aiSuggestedLanguage: Recommended language (e.g. "python").
      11. aiSuggestedCount: Suggested number of problems (3-5).

      Return ONLY a JSON object. No markdown.
      
      Structure:
      {
        "title": "...",
        "subtitle": "...",
        "description": "...",
        "company": "...",
        "difficulty": "...",
        "tags": ["...", "..."],
        "rules": ["...", "..."],
        "prizes": [
           { "rank": 1, "title": "...", "amount": "...", "perks": ["..."] }
        ],
        "aiSuggestedTopic": "...",
        "aiSuggestedLanguage": "...",
        "aiSuggestedCount": 3
      }
    `;

        let text = "";
        try {
            const chatCompletion = await groq.chat.completions.create({
                messages: [{ role: "user", content: aiPrompt }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.7,
                max_tokens: 2048,
            });
            text = chatCompletion.choices[0]?.message?.content || "";
        } catch (err) {
            const gemini = getGeminiClient();
            const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(aiPrompt);
            text = result.response.text();
        }

        const meta = parseAIJson(text);
        res.json({ meta });

    } catch (error) {
        console.error("AI Meta Generation Error:", error);
        res.status(500).json({ message: "AI failed to generate contest metadata" });
    }
});

/**
 * @desc Generate coding problems for Code Arena
 * @route POST /api/ai/code-arena/generate
 * @access Public
 */
export const generateProblems = asyncHandler(async (req, res) => {
  const { topic = "General", language = "JavaScript", count = 3, difficulty = "Medium", context = "" } = req.body;

  try {
    const groq = getGroqClient();
    const prompt = `
      Act as a Senior Software Engineer at a FAANG company. Generate ${count} coding problems for a LeetCode-style arena.
      
      Topic: ${topic}
      Language: ${language}
      Difficulty: ${difficulty}
      ${context ? `Extra Directives / Context: ${context}` : ''}
      
      For each problem, provide:
      1. title: A catchy problem name.
      2. difficulty: Easy, Medium, or Hard.
      3. description: A clear problem statement with examples.
      4. constraints: A list of constraints (e.g., time/space complexity).
      5. starterCode: ONLY provide the function signature/boilerplate in ${language}. DO NOT WRITE THE SOLUTION. The function body MUST ONLY contain a comment like "// Write your code here" and a default return statement. ANY logic or algorithm implementation is STRICTLY FORBIDDEN.
      6. testCases: 3-5 hidden test cases with "input" and "output" fields.
      
      Return ONLY a JSON array of objects. No markdown.
      
      Format:
      [
        {
          "title": "...",
          "difficulty": "...",
          "description": "...",
          "constraints": ["..."],
          "starterCode": "...",
          "testCases": [{"input": "...", "output": "..."}]
        }
      ]
    `;

    let text = "";
    
    try {
        const groq = getGroqClient();
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
          max_tokens: 4096,
        });
        text = chatCompletion.choices[0]?.message?.content || "";
    } catch (groqError) {
        console.warn("Groq failed, falling back to Gemini:", groqError.message);
        const gemini = getGeminiClient();
        const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        text = result.response.text();
    }
    
    const problems = parseAIJson(text);
    res.json({ problems });

  } catch (error) {
    const getStarterCode = (lang, funcName) => {
        const l = lang.toLowerCase();
        if (l === 'python') return `def ${funcName}(nums):\n    # Write your logic here\n    pass`;
        if (l === 'cpp') return `int ${funcName}(vector<int>& nums) {\n    // Write your logic here\n    return 0;\n}`;
        if (l === 'java') return `public int ${funcName}(int[] nums) {\n    // Write your logic here\n    return 0;\n}`;
        return `function ${funcName}(nums) {\n    // Write your logic here\n}`;
    };

    const getStringStarter = (lang, funcName) => {
        const l = lang.toLowerCase();
        if (l === 'python') return `def ${funcName}(s):\n    # Write your logic here\n    pass`;
        if (l === 'cpp') return `string ${funcName}(string s) {\n    // Write your logic here\n    return s;\n}`;
        if (l === 'java') return `public String ${funcName}(String s) {\n    // Write your logic here\n    return s;\n}`;
        return `function ${funcName}(s) {\n    // Write your logic here\n}`;
    };

    // Hard fallback pool so the UI never crashes and respects the quest count
    const fallbackPool = [
        {
            title: `${language} Array Master`,
            difficulty: "Easy",
            description: `Write a function to find the maximum element in a given array.\n\nExample:\nInput: nums = [1,5,3,9,2]\nOutput: 9`,
            constraints: ["1 <= nums.length <= 10^5"],
            starterCode: getStarterCode(language, "findMax"),
            testCases: [{ input: "[1,5,3,9,2]", output: "9" }, { input: "[10, 20, 5]", output: "20" }]
        },
        {
            title: `${language} Logic Validator`,
            difficulty: "Easy",
            description: `Write a function to validate if a given array contains any duplicate elements.\n\nExample:\nInput: nums = [1,2,3,1]\nOutput: true`,
            constraints: ["1 <= nums.length <= 10^5", "-10^9 <= nums[i] <= 10^9"],
            starterCode: getStarterCode(language, "containsDuplicate"),
            testCases: [{ input: "[1,2,3,1]", output: "true" }, { input: "[1,2,3,4]", output: "false" }]
        },
        {
            title: `${language} String Reverser`,
            difficulty: "Easy",
            description: `Write a function to reverse a given string.\n\nExample:\nInput: s = "hello"\nOutput: "olleh"`,
            constraints: ["1 <= s.length <= 10^5"],
            starterCode: getStringStarter(language, "reverseString"),
            testCases: [{ input: '"hello"', output: '"olleh"' }, { input: '"world"', output: '"dlrow"' }]
        }
    ];

    const countInt = parseInt(count) || 1;
    let selectedProblems = [];
    for(let i=0; i < countInt; i++) {
        selectedProblems.push(fallbackPool[i % fallbackPool.length]);
    }

    res.json({ problems: selectedProblems });
  }
});

/**
 * @desc Evaluate a coding solution
 * @route POST /api/ai/code-arena/evaluate
 * @access Public
 */
export const evaluateSolution = asyncHandler(async (req, res) => {
  const { problem, code, language = "JavaScript" } = req.body;

  let text = "";
  try {
    const prompt = `
      You are an expert programming judge. Evaluate the correctness of the submitted code.

      Problem Title: ${problem.title}
      Problem Statement: ${problem.description || problem.scenario || ''}
      ${problem.task ? 'Task: ' + problem.task : ''}
      Submitted Language Selected by Candidate: ${language}

      Candidate's Code:
      \`\`\`
      ${code}
      \`\`\`

      Test Cases (you MUST evaluate EVERY one of these):
      ${JSON.stringify(problem.testCases, null, 2)}

      EVALUATION RULES:
      1. Carefully trace / mentally execute the code against each test case.
      2. Focus purely on LOGIC and CORRECTNESS. Do not penalise for language naming or style.
      3. If the code is empty or contains only placeholder comments with no logic, mark ALL cases as failed with actual = "No implementation submitted".
      4. If there is an obvious syntax error, mark ALL cases as failed with actual = the specific error message.
      5. Otherwise, determine the actual output for each case and set passed = true ONLY when actual exactly matches expected.
      6. MANDATORY: You MUST include one entry per test case in testCaseResults. Never return an empty array.

      Return ONLY valid JSON. No markdown. No explanation outside the JSON. Use this exact structure:
      {
        "status": "Accepted" | "Rejected" | "Partial",
        "score": <integer 0 to 100>,
        "complexity": { "time": "O(...)", "space": "O(...)" },
        "feedback": "<concise professional summary of the submission>",
        "bugs": ["<logical flaw or missed edge case, or empty array if none>"],
        "efficiencyTips": ["<optimisation suggestion, or empty array if none>"],
        "testCaseResults": [
          { "input": "<test input string>", "expected": "<expected output string>", "actual": "<actual output from running the code>", "passed": true }
        ]
      }`;


    try {
        const groq = getGroqClient();
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          max_tokens: 4096,
        });
        text = chatCompletion.choices[0]?.message?.content || "";
    } catch (groqError) {
        console.warn("Groq Evaluation failed, falling back to Gemini:", groqError.message);
        const gemini = getGeminiClient();
        const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        text = result.response.text();
    }
    
    const evaluation = parseAIJson(text);
    res.json(evaluation);

  } catch (error) {
    console.error("Code Arena Evaluation Error:", error.message, error.stack);
    // Build testCaseResults from the problem's own test cases so the UI always shows something
    const fallbackTestResults = (problem?.testCases || []).map(tc => ({
        input: typeof tc.input === 'object' ? JSON.stringify(tc.input) : (tc.input || 'N/A'),
        expected: typeof tc.output === 'object' ? JSON.stringify(tc.output) : (tc.output || tc.expected || 'N/A'),
        actual: `Error: AI Judge unavailable — ${error.message?.slice(0, 80) || 'Try again'}`,
        passed: false
    }));
    res.json({ 
        status: "Rejected",
        score: 0,
        complexity: { time: "O(?)", space: "O(?)" },
        feedback: "The AI Judge encountered an error grading this submission. Please try again.",
        bugs: [`Engine Error: ${error.message}`],
        efficiencyTips: ["Please try submitting again in a moment."],
        testCaseResults: fallbackTestResults
    });
  }
});

/**
 * @desc Save completed quest XP
 * @route POST /api/ai/code-arena/save
 * @access Private
 */
export const completeQuest = asyncHandler(async (req, res) => {
  const { xpEarned, solvedCount, challengeId, score, evaluation } = req.body;
  const userId = req.user._id;

  try {
      const user = await User.findById(userId);
      if (!user) {
          return res.status(404).json({ message: "User not found to stamp XP." });
      }

      // Initialize if missing
      if (!user.arenaStats) {
          user.arenaStats = { totalXP: 0, solvedChallengesCount: 0, solvedChallengesList: [] };
      }

      user.arenaStats.totalXP += Number(xpEarned) || 0;
      user.arenaStats.solvedChallengesCount += Number(solvedCount) || 0;
      
      // 🔥 STREAK LOGIC
      const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const lastDate = user.arenaStats.lastSolvedDate;

      if (lastDate !== today) {
          if (lastDate === yesterday) {
              user.arenaStats.currentStreak += 1;
          } else {
              user.arenaStats.currentStreak = 1;
          }
          user.arenaStats.lastSolvedDate = today;
          
          if (user.arenaStats.currentStreak > (user.arenaStats.maxStreak || 0)) {
              user.arenaStats.maxStreak = user.arenaStats.currentStreak;
          }
      }

      if (challengeId) {
          const existingIdx = user.arenaStats.solvedChallengesList.findIndex(item => item.challengeId === challengeId);
          const solveData = {
              challengeId,
              score: Number(score) || 0,
              feedback: evaluation?.feedback || "",
              complexity: evaluation?.complexity || { time: "O(?)", space: "O(?)" },
              testCases: evaluation?.testCaseResults || []
          };

          if (existingIdx !== -1) {
              if (Number(score) >= (user.arenaStats.solvedChallengesList[existingIdx].score || 0)) {
                  user.arenaStats.solvedChallengesList[existingIdx] = {
                      ...user.arenaStats.solvedChallengesList[existingIdx],
                      ...solveData
                  };
              }
          } else {
              user.arenaStats.solvedChallengesList.push(solveData);
          }
      }

      await user.save();

      res.json({
          message: "Arena Mastery Saved",
          totalXP: user.arenaStats.totalXP,
          solvedChallengesCount: user.arenaStats.solvedChallengesCount,
          currentStreak: user.arenaStats.currentStreak,
          maxStreak: user.arenaStats.maxStreak,
          solvedChallengesList: user.arenaStats.solvedChallengesList
      });
  } catch (error) {
      console.error("Save Arena Error:", error);
      res.status(500).json({ message: "Network interference saving XP." });
  }
});
