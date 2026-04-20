import cron from "node-cron";
import DailyChallenge from "../models/DailyChallenge.js";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY });
const getGemini = () => new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractJSON = (text) => {
  const si = text.indexOf("{");
  const ei = text.lastIndexOf("}");
  if (si !== -1 && ei > si) return JSON.parse(text.substring(si, ei + 1));
  return JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
};

export const generateOneStopDailyChallenge = async () => {
  try {
    console.log("🤖 Generating OneStop AI Daily Challenge...");

    const TOPICS = [
      { topic: "Arrays & Hashing",       type: "DSA" },
      { topic: "Sliding Window",          type: "DSA" },
      { topic: "Two Pointers",            type: "DSA" },
      { topic: "Binary Search",           type: "DSA" },
      { topic: "Linked Lists",            type: "DSA" },
      { topic: "Trees & BFS/DFS",         type: "DSA" },
      { topic: "Dynamic Programming",     type: "DSA" },
      { topic: "Graph Algorithms",        type: "DSA" },
      { topic: "String Manipulation",     type: "JS"  },
      { topic: "Async/Promises",          type: "JS"  },
      { topic: "DOM & Event Logic",       type: "JS"  },
      { topic: "CSS Layout & Flexbox",    type: "CSS" },
      { topic: "SQL Joins & Aggregation", type: "SQL" },
    ];

    const pick = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    const difficulties = ["Easy", "Medium", "Hard"];
    const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];

    const COMPANY_STYLES = [
      "Google", "Amazon", "Meta", "Microsoft", "Goldman Sachs",
      "Stripe", "Uber", "Netflix", "Airbnb", "PhonePe"
    ];
    const company = COMPANY_STYLES[Math.floor(Math.random() * COMPANY_STYLES.length)];

    const prompt = `
You are a Senior Staff Engineer at ${company}. Generate ONE professional daily coding challenge in the exact style of LeetCode/HackerRank problems used in FAANG technical interviews.

Topic: ${pick.topic}
Type: ${pick.type}
Difficulty: ${difficulty}

═══════════════════════════════════════════════
MANDATORY CORPORATE PROBLEM FORMAT — FOLLOW EXACTLY
═══════════════════════════════════════════════

Each field MUST follow this exact standard:

1. "title"     → Short, creative, industry-specific name. NOT a generic math title.
                  Good: "Session Expiry Manager", "Freight Route Optimizer", "Real-Time Bid Tracker"
                  Bad: "Find Max Element", "Sort Array"

2. "scenario"  → 2–3 sentences. Describe a REAL business situation at a tech company.
                  Set the scene: what the company does, what problem they face, WHY this matters.
                  Example: "At ${company}'s payments gateway, millions of transactions are processed per second.
                  A recent audit revealed that expired session tokens are not being evicted efficiently,
                  causing memory overhead and security vulnerabilities in the auth pipeline."

3. "task"      → ONE precise sentence. Exactly what the candidate must implement.
                  Start with: "Given..., implement a function that..."
                  This is the ONLY place to state the core problem.

4. "inputFormat"  → Describe EACH parameter. Use bullet points with dashes.
                     Example:
                     "- sessions: Array of objects, each with { id: string, expiry: number }
                      - currentTime: number, the current Unix timestamp in milliseconds"

5. "outputFormat" → Exactly what to return and in what format.
                     Example: "Return an array of session IDs (strings) that have expired, sorted alphabetically."

6. "examples" → Array of EXACTLY 2 examples. Each must have:
   - "input": The raw function call or input representation (realistic values)
   - "output": The exact expected return value
   - "explanation": Step-by-step walkthrough explaining WHY this output is correct.
                    Must be 2-4 sentences. Trace through the logic clearly.
                    Example: "Session 'abc' has expiry 1000 which is less than currentTime 1500, so it's expired.
                    Session 'xyz' has expiry 2000 which is greater, so it's active. Only 'abc' is returned."

7. "constraints" → Array of 3-5 professional constraints. Mix algorithmic AND domain:
                   Examples:
                   - "1 ≤ sessions.length ≤ 10⁵"
                   - "Time complexity must not exceed O(n log n)"
                   - "All timestamps are valid Unix epoch milliseconds"
                   - "Session IDs are unique, non-empty strings"
                   - "Memory limit: 64 MB"

8. "notes" → Array of 1-2 important clarifications that affect edge cases.
              Example: ["Sessions expiring exactly at currentTime are considered expired.",
                        "The output order matters — return sorted alphabetically."]

9. "hints" → Array of 1-2 hints for Medium/Hard. Empty array for Easy.
              Example: ["Consider using a hash map for O(1) lookup.",
                        "Think about the sliding window pattern to avoid nested loops."]

10. "starterCode" → Clean, documented JavaScript function signature.
    MUST include:
    - JSDoc comment with @param and @return
    - All parameter names matching inputFormat
    - A meaningful, corporate-style function name
    - Body: // your implementation here
    Example:
    "/**
     * @param {Array<{id: string, expiry: number}>} sessions
     * @param {number} currentTime
     * @return {string[]}
     */
    function getExpiredSessions(sessions, currentTime) {
        // your implementation here
    }"

11. "testCases" → Array of 3 test cases (2 visible examples + 1 hidden edge case).
    The 3rd must test an important edge case (empty array, single element, duplicates, boundaries).

Return ONLY valid JSON. No markdown. No explanation. Start immediately with {.

{
  "title": "...",
  "scenario": "...",
  "task": "...",
  "inputFormat": "...",
  "outputFormat": "...",
  "examples": [
    { "input": "...", "output": "...", "explanation": "..." },
    { "input": "...", "output": "...", "explanation": "..." }
  ],
  "constraints": ["...", "...", "..."],
  "notes": ["..."],
  "hints": ["..."],
  "starterCode": "...",
  "testCases": [
    { "input": "...", "output": "..." },
    { "input": "...", "output": "..." },
    { "input": "...", "output": "..." }
  ],
  "difficulty": "${difficulty}",
  "type": "${pick.type}",
  "points": ${difficulty === "Easy" ? 25 : difficulty === "Medium" ? 50 : 100}
}
`;

    let rawText = "";
    try {
      const groq = getGroq();
      const resp = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        max_tokens: 3000,
      });
      rawText = resp.choices[0]?.message?.content || "";
    } catch (e) {
      console.warn("Groq failed, falling back to Gemini:", e.message);
      const gemini = getGemini();
      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      rawText = result.response.text();
    }

    const data = extractJSON(rawText);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await DailyChallenge.findOneAndUpdate(
      { date: today },
      { ...data, date: today },
      { upsert: true, new: true }
    );

    console.log(`✅ OneStop AI Daily Challenge generated: "${data.title}" [${data.difficulty}]`);
  } catch (err) {
    console.error("❌ Failed to generate Daily Challenge:", err);
  }
};

export const initDailyChallengeCron = () => {
  // Run daily at midnight IST (18:30 UTC)
  cron.schedule("30 18 * * *", generateOneStopDailyChallenge);
  console.log("⏰ OneStop AI Daily Challenge Cron initialized (midnight IST).");
};

