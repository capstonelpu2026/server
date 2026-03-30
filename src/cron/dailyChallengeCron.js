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
  return JSON.parse(text);
};

export const generateOneStopDailyChallenge = async () => {
    try {
        console.log("🤖 Generating OneStop AI Daily Challenge...");
        
        const topics = ["Data Structures", "Frontend Logic", "Database Design", "System Architecture", "Security Patterns"];
        const topic = topics[Math.floor(Math.random() * topics.length)];
        const types = ["DSA", "CSS", "JS", "SQL"];
        const type = types[Math.floor(Math.random() * types.length)];

        const prompt = `
Generate a professional, high-fidelity daily coding challenge for a corporate recruitment platform.
Topic: ${topic}
Type: ${type}
Difficulty: Medium

Rules for Generation:
1. TITLE: Must be professional and industry-specific (e.g., "High-Frequency Trading Pipeline Optimizer" instead of "Sort Array").
2. DESCRIPTION: Must use corporate storytelling. Describe a real-world scenario (Bank, High-Growth Startup, Logistics Hub) where this problem needs to be solved. 
   - Use professional terminology.
   - Clearly state the business objective.
   - Include a "Example" section with detailed walk-through of input and output.
3. CONSTRAINTS: List 3-4 professional constraints (e.g., "Must handle O(log n) time complexity", "Memory limit: 256MB").
4. STARTER CODE: Provide a clean, documented function signature in JavaScript.

Return EXACTLY this JSON structure:
{
  "title": "Corporate Title",
  "description": "Professional scenario description...",
  "difficulty": "Medium",
  "type": "${type}",
  "points": 50,
  "starterCode": "// Starter code here",
  "constraints": ["Constraint 1", "Constraint 2"],
  "testCases": [
    { "input": "input here", "output": "output here" }
  ]
}
Return only clean JSON.
`;

        let rawText = "";
        try {
            const groq = getGroq();
            const resp = await groq.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: "llama-3.3-70b-versatile",
            });
            rawText = resp.choices[0]?.message?.content || "";
        } catch (e) {
            const gemini = getGemini();
            const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            rawText = result.response.text();
        }

        const data = extractJSON(rawText);
        const today = new Date();
        today.setHours(0,0,0,0);

        // Save to DB
        await DailyChallenge.findOneAndUpdate(
            { date: today },
            { ...data, date: today },
            { upsert: true, new: true }
        );

        console.log(`✅ OneStop AI Daily Challenge generated: ${data.title}`);
    } catch (err) {
        console.error("❌ Failed to generate Daily Challenge:", err);
    }
};

export const initDailyChallengeCron = () => {
    // Run daily at midnight
    cron.schedule("1 0 * * *", generateOneStopDailyChallenge);
    console.log("⏰ OneStop AI Daily Challenge Cron initialized.");
};
