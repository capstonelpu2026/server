import Groq from "groq-sdk";
import asyncHandler from "express-async-handler";
import { GoogleGenerativeAI } from "@google/generative-ai";
import User from "../models/User.js";

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
      5. starterCode: A boilerplate function in ${language} for the user to start with.
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
    
    const problems = extractJSON(text, true);
    res.json({ problems });

  } catch (error) {
    console.error("Code Arena Generation Error:", error.message);
    // Hard fallback so the UI never crashes
    res.json({ 
        problems: [
            {
                title: `${language} Logic Validator`,
                difficulty: difficulty,
                description: `Write a function to validate if a given array contains any duplicate elements.\n\nExample 1:\nInput: nums = [1,2,3,1]\nOutput: true\n\nExample 2:\nInput: nums = [1,2,3,4]\nOutput: false`,
                constraints: ["1 <= nums.length <= 10^5", "-10^9 <= nums[i] <= 10^9"],
                starterCode: language.toLowerCase() === 'python' ? `def containsDuplicate(nums):\n    # Write your logic here\n    pass` : `function containsDuplicate(nums) {\n    // Write your logic here\n}`,
                testCases: [
                    { input: "[1,2,3,1]", output: "true" },
                    { input: "[1,2,3,4]", output: "false" }
                ]
            }
        ] 
    });
  }
});

/**
 * @desc Evaluate a coding solution
 * @route POST /api/ai/code-arena/evaluate
 * @access Public
 */
export const evaluateSolution = asyncHandler(async (req, res) => {
  const { problem, code, language = "JavaScript" } = req.body;

  try {
    const groq = getGroqClient();
    const prompt = `
      Act as a Lead Technical Interviewer. Evaluate the following coding solution.
      
      Problem Title: ${problem.title}
      Problem Description: ${problem.description}
      Language: ${language}
      Candidate Code:
      \`\`\`${language}
      ${code}
      \`\`\`
      
      Hidden Test Cases: ${JSON.stringify(problem.testCases)}
      
      Analyze:
      1. Correctness: Does it solve the problem and pass the hidden test cases?
      2. Complexity: What is the Time and Space complexity?
      3. Quality: Is the code clean, readable, and efficient?
      
      Return ONLY a JSON object:
      {
        "status": "Accepted" | "Rejected" | "Partial",
        "score": number (0-100),
        "complexity": { "time": "...", "space": "..." },
        "feedback": "...",
        "bugs": ["..."],
        "efficiencyTips": ["..."],
        "testCaseResults": [
            { "input": "...", "expected": "...", "actual": "...", "passed": boolean }
        ]
      }
    `;

    let text = "";
    
    try {
        const groq = getGroqClient();
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.4,
          max_tokens: 2048,
        });
        text = chatCompletion.choices[0]?.message?.content || "";
    } catch (groqError) {
        console.warn("Groq Evaluation failed, falling back to Gemini:", groqError.message);
        const gemini = getGeminiClient();
        const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        text = result.response.text();
    }
    
    const evaluation = extractJSON(text, false);
    res.json(evaluation);

  } catch (error) {
    console.error("Code Arena Evaluation Error:", error.message);
    res.json({ 
        status: "Rejected",
        score: 0,
        complexity: { time: "O(?)", space: "O(?)" },
        feedback: "The AI Judge is temporarily unavailable to grade this submission.",
        bugs: ["Evaluation failed due to network overload."],
        efficiencyTips: ["Please try submitting again in a moment."],
        testCaseResults: []
    });
  }
});

/**
 * @desc Save completed quest XP
 * @route POST /api/ai/code-arena/save
 * @access Private
 */
export const completeQuest = asyncHandler(async (req, res) => {
  const { xpEarned, solvedCount } = req.body;
  const userId = req.user._id;

  try {
      const user = await User.findById(userId);
      if (!user) {
          return res.status(404).json({ message: "User not found to stamp XP." });
      }

      // Initialize if missing
      if (!user.arenaStats) {
          user.arenaStats = { totalXP: 0, solvedChallenges: 0 };
      }

      user.arenaStats.totalXP += Number(xpEarned) || 0;
      user.arenaStats.solvedChallenges += Number(solvedCount) || 0;

      await user.save();

      res.json({
          message: "Arena Mastery Saved",
          totalXP: user.arenaStats.totalXP,
          solvedChallenges: user.arenaStats.solvedChallenges
      });
  } catch (error) {
      console.error("Save Arena Error:", error);
      res.status(500).json({ message: "Network interference saving XP." });
  }
});
