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

  try {
    const groq = getGroqClient();
    const prompt = `
      Act as a Lead Technical Interviewer and Code Quality Auditor.
      
      Problem Title: ${problem.title}
      Problem Description: ${problem.description}
      Expected Language: ${language}
      
      Candidate Code Submitted:
      \`\`\`${language}
      ${code}
      \`\`\`
      
      Strict Test Cases to Validate: ${JSON.stringify(problem.testCases)}
      
      Evaluation Guidelines:
      1. CRITICAL: If the code is written in a language OTHER than ${language}, mark all test cases as "failed" with actual output set to "Error: Language Mismatch".
      2. CRITICAL: If the code has a syntax error that would prevent execution, mark as "failed" with actual output set to the specific compiler/runtime error.
      3. LOGIC: Compare the candidate's logic against the test cases. Be extremely precise with output comparison.
      
      Return ONLY a clean JSON object with this structure:
      {
        "status": "Accepted" | "Rejected" | "Partial",
        "score": number (0-100),
        "complexity": { "time": "O(...)", "space": "O(...)" },
        "feedback": "A concise professional summary of the submission.",
        "bugs": ["List any logical flaws or edge cases they missed"],
        "efficiencyTips": ["How to optimize the Big O complexity or code readability"],
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
    console.error("Code Arena Evaluation Error:", error.message, error.stack);
    res.json({ 
        status: "Rejected",
        score: 0,
        complexity: { time: "O(?)", space: "O(?)" },
        feedback: "The AI Judge is temporarily unavailable to grade this submission.",
        bugs: ["Evaluation failed due to network overload.", `Engine Error: ${error.message}`],
        efficiencyTips: ["Please try submitting again in a moment.", text ? `Engine output: ${text.substring(0, 100)}` : ""],
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
