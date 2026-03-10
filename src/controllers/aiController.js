import Groq from "groq-sdk";
import asyncHandler from "express-async-handler";
import { GoogleGenerativeAI } from "@google/generative-ai";
import nodeFetch from "node-fetch";
import fs from "fs";

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in environment variables.");
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  return new GoogleGenerativeAI(apiKey);
};

/**
 * @desc Generate interview questions based on role/topic
 * @route POST /api/ai/interview/questions
 * @access Public
 */
export const generateQuestions = asyncHandler(async (req, res) => {
  const { 
    role = "Software Engineer", 
    topic, 
    difficulty = "Standard", 
    company = "Tech Industry", 
    experience = "Intermediate", 
    personality = "Professional",
    questionCount = 5
  } = req.body;

  if (!process.env.GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY missing. Using fallback interview questions.");
    return res.json({ 
      questions: [
        { type: "text", question: "Tell me about a challenging project you worked on." },
        { type: "mcq", question: "What is the time complexity of binary search?", options: ["O(n)", "O(log n)", "O(n^2)", "O(1)"], answer: "O(log n)" },
        { type: "text", question: "What is your greatest strength as a developer?" },
        { type: "mcq", question: "Which HTTP method is used to update a resource?", options: ["GET", "POST", "PUT", "DELETE"], answer: "PUT" },
        { type: "mcq", question: "In React, what hook is used for side effects?", options: ["useState", "useEffect", "useMemo", "useCallback"], answer: "useEffect" }
      ],
      isFallback: true 
    });
  }

  try {
    const groq = getGroqClient();
    
    // Calculate split for question types
    const textCount = Math.max(1, Math.floor(questionCount * 0.4));
    const mcqCount = questionCount - textCount;

    // Updated prompt with dynamic question count
    const prompt = `
      Act as a Senior Technical Recruiter at ${company} with a ${personality} personality. 
      You are conducting a mock interview for a "${role}" position (Experience Level: ${experience}). 
      
      Generate a realistic interview set of EXACTLY ${questionCount} questions that ${company} is likely to ask for this role.
      Topic Focus: ${topic || "General"}
      Difficulty: ${difficulty}
      Interviewer Tone: ${personality} (Adjust the language of questions to match this tone)
      
      Structure:
      - ${textCount} Deep Behavioral/Technical Questions (type: "text") tailored to ${company}'s culture and your ${personality} persona.
      - ${mcqCount} Multiple Choice Questions (type: "mcq") with 4 options and the correct answer, testing technical fundamentals at ${difficulty} level.
      
      CRITICAL: You must provide EXACTLY ${questionCount} questions in total.
      
      Return ONLY a JSON array of objects. No markdown.
      Format:
      [
        { "type": "text", "question": "..." },
        { "type": "mcq", "question": "...", "options": ["Option A", "Option B", "Option C", "Option D"], "answer": "Exact text of correct option" }
      ]
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile", // High performance model
      temperature: 0.7,
      max_tokens: 2048
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let questions;
    try {
        questions = JSON.parse(cleanText);
    } catch (e) {
        console.error("JSON Parse Error:", e);
        // Fallback robust parsing if AI returns malformed or truncated JSON
        if (cleanText.startsWith("[") && !cleanText.endsWith("]")) {
            try {
                const repaired = cleanText.substring(0, cleanText.lastIndexOf("}") + 1) + "]";
                questions = JSON.parse(repaired);
            } catch (inner) {
                questions = [
                    { type: "text", question: `Explain a complex technical challenge you solved as a ${role}.` }
                ];
            }
        } else {
            questions = [
                { type: "text", question: `Explain a complex technical challenge you solved as a ${role}.` }
            ];
        }
    }
    
    res.json({ questions });

  } catch (error) {
    console.error("AI Generation Error:", error.message);
    res.json({ 
      questions: [
        { type: "text", question: `Tell me about a time you faced a challenge as a ${role}.` },
        { type: "mcq", question: "What does CSS stand for?", options: ["Cascading Style Sheets", "Creative Style System", "Computer Style Sheets", "Colorful Style Sheets"], answer: "Cascading Style Sheets" },
        { type: "text", question: "Describe a difficult bug you fixed recently." }
      ],
      isFallback: true 
    });
  }
});


/**
 * @desc Generate Topic-Specific Quiz (MCQs)
 * @route POST /api/ai/quiz/generate
 * @access Public
 */
export const generateQuiz = asyncHandler(async (req, res) => {
  const { topic = "React", difficulty = "Intermediate", count = 10 } = req.body;

  if (!process.env.GROQ_API_KEY) {
     return res.json({
        topic,
        questions: Array.from({ length: count }).map((_, i) => ({
           id: i,
           question: `Sample Fallback Question ${i + 1} about ${topic}`,
           options: ["Option A", "Option B", "Option C", "Option D"],
           correctAnswer: "Option A",
           explanation: "This is a fallback explanation because the AI service is unavailable."
        })),
        isFallback: true
     });
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      Create a quiz on "${topic}". Difficulty: ${difficulty}. 
      Count: EXACTLY ${count} questions.
      Format: [ { "q": "Question?", "o": ["A", "B", "C", "D"], "a": "Correct Text", "e": "Brief explain" } ]
      Return ONLY raw JSON array. NO markdown.
      Requirements: 
      1. Explanations MUST be under 15 words.
      2. Use keys: q, o, a, e for question, options, answer, explanation.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a quiz JSON generator. You use short keys (q, o, a, e) and output ONLY the JSON array. No markdown, no preamble." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 8192,
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    
    // Robust extraction of JSON array
    let cleanText = text;
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    
    if (arrayStart !== -1) {
        if (arrayEnd !== -1 && arrayEnd > arrayStart) {
            cleanText = text.substring(arrayStart, arrayEnd + 1);
        } else {
            cleanText = text.substring(arrayStart).trim();
        }
    } else {
        cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    }
    
    let rawQuestions;
    try {
        rawQuestions = JSON.parse(cleanText);
    } catch (parseError) {
        if (cleanText.startsWith("[") && !cleanText.endsWith("]")) {
            try {
                const lastCompleteIndex = cleanText.lastIndexOf("}");
                if (lastCompleteIndex !== -1) {
                    const repairedText = cleanText.substring(0, lastCompleteIndex + 1) + "]";
                    rawQuestions = JSON.parse(repairedText);
                } else {
                    throw parseError;
                }
            } catch (repairError) {
                throw parseError;
            }
        } else {
            throw parseError;
        }
    }

    // Map short keys back to long keys for the frontend
    const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map(q => ({
        question: q.q || q.question,
        options: q.o || q.options || [],
        correctAnswer: q.a || q.correctAnswer || q.answer,
        explanation: q.e || q.explanation || "No explanation provided."
    })).slice(0, count);

    res.json({ topic, questions });

  } catch (error) {
    console.error("AI Quiz Gen Error:", error.message);
    res.json({
       topic,
       questions: [
          {
             question: `Error generating quiz for "${topic}". Would you like to try again with fewer questions?`,
             options: ["Try again (10 Questions)", "Try again (20 Questions)", "Try Different Topic", "Report Issue"],
             correctAnswer: "Try again (10 Questions)",
             explanation: `The AI service encountered an issue: ${error.message}. Large question counts (like 50) are more prone to timeouts.`
          }
       ],
       isFallback: true,
       error: error.message
    });
  }
});

/**
 * @desc Analyze interview answer
 * @route POST /api/ai/interview/analyze
 * @access Public
 */
export const analyzeAnswer = asyncHandler(async (req, res) => {
  const { question, answer, company = "General Tech", role = "Developer", personality = "Professional" } = req.body;

  if (!question || !answer) {
    res.status(400);
    throw new Error("Question and answer are required");
  }

  try {
    const groq = getGroqClient();
    
    // Updated prompt for company-specific fit analysis
    const prompt = `
      Act as a Hiring Manager at ${company} with a ${personality} personality. Analyze the following candidate answer for a ${role} position.
      
      Question: "${question}"
      Candidate's Answer: "${answer}"
      
      Provide a comprehensive evaluation in valid JSON format:
      {
        "score": number (0-100),
        "sentiment": "Excellent" | "Good" | "Average" | "Needs Improvement",
        "hiringDecision": "Strong Hire" | "Hire" | "Weak Hire" | "No Hire",
        "cultureFit": "High" | "Medium" | "Low",
        "feedback": "Professional feedback focusing on technical accuracy and communication clarity. Speak in your ${personality} tone.",
        "strengths": ["list..."],
        "weaknesses": ["list..."],
        "improvements": "Actionable tips.",
        "sampleAnswer": "Ideal answer."
      }
      
      Be strictly professional and objective. Return ONLY JSON.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      max_tokens: 1500
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const analysis = JSON.parse(cleanText);
    res.json(analysis);

  } catch (error) {
    console.error("AI Analysis Error:", error.message);
    const wordCount = answer.split(" ").length;
    res.json({
      score: Math.min(85, wordCount * 2),
      sentiment: "Average",
      feedback: "We are currently experiencing high traffic with our AI service. This is a simulated analysis based on answer length and structure.",
      strengths: ["Attempted to answer the question", "Provided some relevant information"],
      weaknesses: ["Could provide more specific examples", "Could elaborate further"],
      improvements: "Try to use the STAR method (Situation, Task, Action, Result) to structure your answers with specific examples from your experience.",
      sampleAnswer: "A strong answer would include specific examples, quantifiable results, and demonstrate clear problem-solving skills relevant to the question.",
      corrections: "Unable to provide detailed corrections at this time. Please try again.",
      keywords: ["communication", "experience", "skills"],
      detailedAnalysis: {
        clarity: 70,
        relevance: 75,
        depth: 65,
        communication: 70
      },
      isFallback: true
    });
  }
});

/**
 * @desc Analyze Audio Answer (Transcribe -> Analyze)
 * @route POST /api/ai/interview/analyze-audio
 * @access Public
 */

export const analyzeAudioAnswer = asyncHandler(async (req, res) => {
  const { question, company = "General Tech", role = "Developer", personality = "Professional" } = req.body;
  const audioFile = req.file;

  if (!audioFile) {
     res.status(400); 
     throw new Error("Audio file is required");
  }

  let transcript = "";
  let tempPath = audioFile.path;

  try {
     const groq = getGroqClient();
     
     // Ensure file has webm extension if not already present
     if (!tempPath.endsWith('.webm') && !tempPath.endsWith('.wav') && !tempPath.endsWith('.mp3')) {
        const newPath = `${audioFile.path}.webm`;
        try {
           fs.renameSync(audioFile.path, newPath);
           tempPath = newPath;
        } catch (e) {
           console.warn("Could not rename file, using original path:", e.message);
        }
     }

     console.log(`[AI] Transcribing: ${tempPath} (${audioFile.size} bytes, original type: ${audioFile.mimetype})`);

     // 1. Transcribe
     const translation = await groq.audio.transcriptions.create({
       file: fs.createReadStream(tempPath),
       model: "whisper-large-v3",
       response_format: "json",
       temperature: 0.0
     });
     
     transcript = translation.text;
     console.log(`[AI] Transcript received: ${transcript.substring(0, 50)}...`);
     
     // Cleanup temp file
     try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
     } catch (e) {
        console.warn("Could not delete temp file:", e.message);
     }
     
  } catch (err) {
     console.error("Transcription Error Full:", err);
     // Cleanup files
     if (fs.existsSync(audioFile.path)) {
        try { fs.unlinkSync(audioFile.path); } catch (e) { console.warn(e.message); }
     }
     if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) { console.warn(e.message); }
     }
     
     // Return detailed error to help debugging
     return res.status(500).json({
        message: "Transcription failed",
        error: err.message,
        details: err.response?.data || "No extra details"
     });
  }

  // 2. Analyze (Re-using logic from analyzeAnswer but inline for now to avoid refactor complexity)
  if (!transcript || transcript.trim().length < 2) {
     return res.json({
        score: 0,
        sentiment: "Neutral",
        feedback: "Could not hear any clear answer. Please try speaking closer to the microphone.",
        transcription: transcript
     });
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      Act as a Hiring Manager at ${company} with a ${personality} personality. 
      CRITICAL TASK: Evaluate if the candidate's answer is RELEVANT to the question and TECHNICALLY CORRECT.
      
      Question: "${question}"
      Candidate's Spoken Answer (Transcribed): "${transcript}"
      
      Evaluation Criteria:
      1. Relevance: If the answer is off-topic or fails to address the specific question, the score MUST be below 40.
      2. Accuracy: Check for technical correctness for the "${role}" position.
      3. Tone: Respond in your ${personality} persona.
      
      Provide a comprehensive evaluation in valid JSON format:
      {
        "score": number (0-100),
        "relevance": number (0-100),
        "sentiment": "Excellent" | "Good" | "Average" | "Needs Improvement",
        "hiringDecision": "Strong Hire" | "Hire" | "Weak Hire" | "No Hire",
        "feedback": "Speak in your ${personality} tone. Be honest if they dodged the question.",
        "strengths": ["list..."],
        "weaknesses": ["list..."],
        "improvements": "Actionable tips.",
        "sampleAnswer": "The ideal relevant answer."
      }
      
      Return ONLY JSON.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      max_tokens: 2048
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let analysis;
    try {
        analysis = JSON.parse(cleanText);
    } catch (e) {
        // Try repair
        if (cleanText.startsWith("{") && !cleanText.endsWith("}")) {
            try {
                analysis = JSON.parse(cleanText + "}");
            } catch (inner) {
                throw e;
            }
        } else {
            throw e;
        }
    }
    
    // Append the transcription so UI can show what AI heard
    res.json({ ...analysis, transcription: transcript });

  } catch (err) {
    console.error("Analysis Error:", err);
    res.json({
       score: 50,
       feedback: "Error analyzing the transcribed text.",
       transcription: transcript,
       isFallback: true
    });
  }
});

/**
 * @desc Auto-generate Job Description for Recruiters
 * @route POST /api/ai/job-description
 * @access Public
 */
export const generateJobDescription = asyncHandler(async (req, res) => {
  const { title, skills, location, type } = req.body;
  
  if (!title) {
    res.status(400);
    throw new Error("Job Title is required");
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      You are a senior HR professional. Write a polished job description for this role.

      Role: ${title}
      Location: ${location || "Not specified"}
      Type: ${type || "Full-time"}
      Key Skills: ${(skills || []).join(", ") || "General"}

      FORMAT RULES (VERY IMPORTANT):
      - Use PLAIN TEXT only. No markdown. No asterisks. No hashtags. No bold syntax.
      - Use section headers as standalone lines ending with a colon, like:
          About the Role:
          Key Responsibilities:
          Requirements:
          Nice to Have:
          Why Join Us:
      - Use a dash (- ) at the start of each bullet point.
      - Keep it professional, engaging, and modern.
      - Length: 250-350 words.

      Begin directly with "About the Role:" — no preamble.
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You write professional job descriptions in clean plain text. Never use markdown formatting like #, ##, **, or *. Use plain section headers followed by a colon, and dashes for bullet points." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
    });

    let description = completion.choices[0]?.message?.content || "";
    
    // Strip any remaining markdown that the AI might have included
    description = description
      .replace(/^#{1,6}\s*/gm, "")       // Remove # headers
      .replace(/\*\*(.*?)\*\*/g, "$1")    // Remove **bold** → bold
      .replace(/\*(.*?)\*/g, "$1")        // Remove *italic* → italic
      .replace(/^```[\s\S]*?```$/gm, "")  // Remove code blocks
      .trim();

    res.json({ description });

  } catch (error) {
    console.error("AI Gen Description Error:", error.message);
    res.status(500).json({ description: "Failed to generate description. Please try again." });
  }
});

/**
 * @desc Generate Cover Letter for Candidates
 * @route POST /api/ai/cover-letter
 * @access Public
 */
export const generateCoverLetter = asyncHandler(async (req, res) => {
  const { jobTitle, company, userProfile } = req.body;

  if (!jobTitle || !userProfile) {
    res.status(400);
    throw new Error("Missing required fields");
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      Write a professional cover letter in corporate business format.

      Candidate Details:
      - Name: ${userProfile.name}
      - Skills: ${userProfile.skills?.join(", ") || "General"}
      - Experience: ${userProfile.experience || "Fresher"}

      Applying for: ${jobTitle} at ${company || "the company"}

      FORMAT RULES (VERY IMPORTANT):
      - Use PLAIN TEXT only. NO markdown, NO asterisks, NO hashtags, NO bold syntax.
      - Structure EXACTLY like this (each section on its own line, separated by blank lines):

      Dear Hiring Manager,

      [Opening paragraph: Express enthusiasm for the specific role and company. 2-3 sentences.]

      [Middle paragraph: Connect your key skills and experience to the role requirements. Show how you add value. 3-4 sentences.]

      [Closing paragraph: Express eagerness for an interview. Thank them. 1-2 sentences.]

      Best Regards,
      ${userProfile.name}

      - Keep it under 200 words total.
      - Be specific, not generic. Reference the actual role title and company name.
      - Tone: Confident, professional, warm — like a real executive application.
      - Start directly with "Dear Hiring Manager," — no subject line or date.
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You write corporate cover letters in clean plain text. Never use markdown. Each paragraph must be separated by a blank line. Always end with a sign-off and the candidate's name on separate lines." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
    });

    let coverLetter = completion.choices[0]?.message?.content || "";
    
    // Strip any markdown the AI might have included
    coverLetter = coverLetter
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/^Subject:.*$/gm, "")
      .replace(/^\[.*\]$/gm, "")
      .trim();

    res.json({ coverLetter });

  } catch (error) {
    console.error("AI Cover Letter Error:", error.message);
    res.status(500).json({ coverLetter: `Dear Hiring Manager,\n\nI am writing to express my strong interest in the ${jobTitle} position${company ? ` at ${company}` : ''}. With my background and skills, I am confident I would be a valuable addition to your team.\n\nI look forward to the opportunity to discuss how I can contribute to your organization's success.\n\nBest Regards,\n${userProfile?.name || 'Candidate'}` });
  }
});

/**
 * @desc Check Job Eligibility / Match Score
 * @route POST /api/ai/job-eligibility
 * @access Public
 */
export const checkJobEligibility = asyncHandler(async (req, res) => {
  const { jobDescription, userSkills, userExperience } = req.body;

  try {
    const groq = getGroqClient();
    const prompt = `
      Compare the Candidate vs Job Description and provide a Match Score.
      
      Job Description Snippet: "${jobDescription.substring(0, 1000)}..."
      Candidate Skills: ${userSkills.join(", ")}
      Candidate Experience: ${userExperience}

      Return JSON ONLY:
      {
        "matchScore": number (0-100),
        "reason": "1 sentence explanation of why",
        "missingSkills": ["skill1", "skill2"]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
    });

    const text = completion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    res.json(JSON.parse(cleanText));

  } catch (error) {
    console.error("AI Eligibility Error:", error.message);
    res.json({ 
      matchScore: 75, 
      reason: "Analysis unavailable. Score based on general profile match.", 
      missingSkills: [] 
    });
  }
});

/**
 * @desc Chat with AI Career Coach
 * @route POST /api/ai/chat
 * @access Public
 */
export const chatWithAI = asyncHandler(async (req, res) => {
  const { message, context } = req.body;

  if (!message) {
    res.status(400);
    throw new Error("Message is required");
  }

  try {
    const groq = getGroqClient();
    
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a professional, status-driven, and expert AI Career Strategist. Your goal is to help students and job seekers with high-level career strategy, roadmap execution, and professional growth. Keep answers professional and expert-grade. Use emojis sparingly."
        },
        { role: "user", content: message }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 300
    });

    const text = chatCompletion.choices[0]?.message?.content || "I'm speechless!";
    res.json({ reply: text });

  } catch (error) {
    console.error("❌ AI Chat Error:", error.message);
    
    if (error.message.includes("API_KEY")) {
      res.json({ reply: "I need a brain! 🧠 (Please add GROQ_API_KEY to server .env)" });
    } else {
      res.json({ reply: "I'm having trouble thinking right now! 🤯 Please try again." });
    }
  }
});
/* analyzeAadhaar removed */

/**
 * @desc Enhance CV with AI suggestions
 * @route POST /api/ai/enhance-cv
 * @access Public
 */
export const enhanceCV = asyncHandler(async (req, res) => {
  const { resumeText, targetRole, experience } = req.body;

  if (!resumeText) {
    res.status(400);
    throw new Error("Resume text is required");
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      You are an expert Career Coach and Resume Writer with 15+ years of experience helping candidates land their dream jobs.
      
      Analyze this resume and provide comprehensive enhancement suggestions:
      
      TARGET ROLE: ${targetRole || "General"}
      EXPERIENCE LEVEL: ${experience || "Mid-level"}
      
      RESUME CONTENT:
      ${resumeText.substring(0, 8000)}
      
      Provide a detailed analysis in valid JSON format with these keys:
      
      {
        "overallScore": number,
        "enhancedSummary": "Rewritten summary",
        "rewrittenResume": {
          "personal": { "name": "...", "email": "...", "phone": "...", "location": "...", "linkedin": "..." },
          "experience": [
            {
              "role": "...", "company": "...", "location": "...", "period": "...",
              "techStack": "React, TypeScript, ...",
              "points": ["Enhanced bullet point 1", "Enhanced bullet point 2"]
            }
          ],
          "education": [ { "school": "...", "degree": "...", "year": "...", "cgpa": "..." } ],
          "skills": ["Programming Languages: ...", "Web Technologies: ..."],
          "projects": [
            { "title": "...", "description": "...", "techStack": "..." }
          ],
          "certifications": ["Certification 1", "Certification 2"],
          "awards": ["Award 1"],
          "languages": ["Language 1 (Proficiency)"]
        },
        "grammarIssues": [ ... ],
        "contentImprovements": [ ... ],
        "missingElements": [ ... ],
        "keywordSuggestions": [ ... ],
        "formattingTips": [ ... ],
        "impactMetrics": { ... },
        "actionableSteps": [ ... ]
      }
      
      CRITICAL INSTRUCTIONS:
      1. DO NOT OMIT any professional details. Capture all work history, education, and technical projects.
      2. ENHANCE bullet points using the Google XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]".
      3. ENSURE the formatting is strictly professional and corporate-ready.
      4. If certifications, languages, or awards are found in the text, include them in the respective fields.
      Return ONLY valid JSON.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      max_tokens: 4096
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let enhancement;
    try {
        enhancement = JSON.parse(cleanText);
    } catch (e) {
        console.error("CV Enhancement Parse Error:", e);
        if (cleanText.startsWith("{") && !cleanText.endsWith("}")) {
            try {
                enhancement = JSON.parse(cleanText + "}");
            } catch (inner) {
                throw e;
            }
        } else {
            throw e;
        }
    }
    res.json(enhancement);

  } catch (error) {
    console.error("AI CV Enhancement Error:", error.message);
    res.json({
      overallScore: 70,
      enhancedSummary: "Unable to generate enhanced summary at this time. Please try again.",
      grammarIssues: [],
      contentImprovements: [
        {
          section: "General",
          issue: "AI service temporarily unavailable",
          suggestion: "Use action verbs, quantify achievements, and tailor content to job description",
          example: "Led team of 5 engineers to deliver project 2 weeks ahead of schedule, reducing costs by 15%"
        }
      ],
      missingElements: ["Quantifiable achievements", "Action verbs", "Keywords from job description"],
      keywordSuggestions: ["leadership", "collaboration", "problem-solving"],
      formattingTips: ["Use bullet points", "Keep it concise", "Use consistent formatting"],
      impactMetrics: {
        beforeScore: 70,
        afterScore: 85,
        atsCompatibility: 75,
        readability: 80
      },
      actionableSteps: [
        "Step 1: Add quantifiable metrics to achievements",
        "Step 2: Use strong action verbs",
        "Step 3: Tailor resume to target role"
      ],
      rewrittenResume: {
        personal: { name: "Candidate Name", email: "candidate@example.com", phone: "+91-0000000000", location: "City, India" },
        experience: [{ role: "Software Engineer", company: "Tech Corp", location: "Bangalore", period: "2020 - Present", techStack: "JavaScript, React, Node.js", points: ["Maintained legacy systems.", "Collaborated with cross-functional teams."] }],
        education: [{ degree: "Bachelor of Engineering", school: "State University", year: "2020", cgpa: "8.5" }],
        skills: ["Programming Languages: JavaScript, Python", "Tools: Git, Docker"],
        projects: [{ title: "E-commerce Site", description: "Built a full-stack store.", techStack: "React, MongoDB" }]
      },
      isFallback: true
    });
  }
});
/**
 * @desc Generate Job-Specific Technical Assessment
 * @req { title, description }
 */
export const generateHiringTest = async (jobTitle, jobDescription) => {
  try {
    const groq = getGroqClient();

    // Generate MCQs
    const mcqPrompt = `
      You are a Senior Technical Interviewer. Generate a technical assessment for: "${jobTitle}".
      Job Context: "${(jobDescription || '').substring(0, 400)}"

      Generate EXACTLY 10 MCQs testing core skills for this role.
      - 4 options per question, 1 correct answer
      - Mix conceptual + practical questions
      - Difficulty: 4 Easy, 4 Medium, 2 Hard
      
      Return ONLY a JSON array:
      [{ "question": "text", "options": ["A","B","C","D"], "answer": "correct option text" }]
      No markdown, no preamble.
    `;

    const mcqCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You generate quiz JSON only. No markdown, no explanations." },
        { role: "user", content: mcqPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
      max_tokens: 3000,
    });

    let mcqText = mcqCompletion.choices[0]?.message?.content || "";
    mcqText = mcqText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let questions;
    try {
      questions = JSON.parse(mcqText);
    } catch (e) {
      if (mcqText.startsWith("[") && !mcqText.endsWith("]")) {
        try {
          const repaired = mcqText.substring(0, mcqText.lastIndexOf("}") + 1) + "]";
          questions = JSON.parse(repaired);
        } catch (inner) { throw e; }
      } else { throw e; }
    }

    // Generate Coding Problems
    const codingPrompt = `
      You are a Senior Technical Interviewer creating coding challenges for: "${jobTitle}".
      
      Generate EXACTLY 2 coding problems:
      - Problem 1: MEDIUM difficulty
      - Problem 2: HARD difficulty
      
      Both problems must be directly relevant to the skills needed for this role.
      
      Return ONLY a JSON array:
      [
        {
          "title": "Problem Title",
          "difficulty": "Medium",
          "description": "Clear problem statement. What the function should do. Input/output specifications.",
          "examples": [
            { "input": "example input", "output": "expected output", "explanation": "why this output" }
          ],
          "starterCode": "function solve(input) {\\n  // Write your code here\\n  \\n}",
          "testCases": [
            { "input": "test input 1", "expectedOutput": "expected 1" },
            { "input": "test input 2", "expectedOutput": "expected 2" },
            { "input": "test input 3", "expectedOutput": "expected 3" }
          ]
        }
      ]
      
      Rules:
      - starterCode must be valid JavaScript with a function signature
      - testCases must have at least 3 cases per problem
      - Problems should test real-world skills for this job role
      - No markdown, no preamble, ONLY the JSON array
    `;

    const codingCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You generate coding challenge JSON only. No markdown. The starterCode must use proper \\n for newlines in JSON strings." },
        { role: "user", content: codingPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 3000,
    });

    let codingText = codingCompletion.choices[0]?.message?.content || "";
    codingText = codingText.replace(/```json/g, "").replace(/```/g, "").trim();

    let codingProblems;
    try {
      codingProblems = JSON.parse(codingText);
    } catch (e) {
      if (codingText.startsWith("[") && !codingText.endsWith("]")) {
        try {
          const repaired = codingText.substring(0, codingText.lastIndexOf("}") + 1) + "]";
          codingProblems = JSON.parse(repaired);
        } catch (inner) { codingProblems = []; }
      } else { codingProblems = []; }
    }

    // Ensure we have valid arrays
    if (!Array.isArray(codingProblems)) codingProblems = [];
    codingProblems = codingProblems.slice(0, 2).map(p => ({
      title: p.title || "Coding Challenge",
      difficulty: p.difficulty || "Medium",
      description: p.description || "Solve this problem.",
      examples: (p.examples || []).slice(0, 2),
      starterCode: p.starterCode || "function solve(input) {\n  // Write your code here\n  \n}",
      language: "javascript",
      testCases: (p.testCases || []).slice(0, 5)
    }));

    return { questions: questions.slice(0, 10), codingProblems };

  } catch (error) {
    console.error("AI Hiring Test Gen Error:", error);
    // Fallback
    return {
      questions: Array.from({ length: 10 }).map((_, i) => ({
        question: `Technical Concept Question ${i+1} for ${jobTitle}`,
        options: ["Highly Efficient", "Scalable", "Maintainable", "None of these"],
        answer: "Scalable"
      })),
      codingProblems: [
        {
          title: "Basic Function Implementation",
          difficulty: "Medium",
          description: `Write a function that takes an array of numbers and returns the sum of all even numbers.`,
          examples: [{ input: "[1,2,3,4,5,6]", output: "12", explanation: "2+4+6 = 12" }],
          starterCode: "function sumEven(arr) {\n  // Write your code here\n  \n}",
          language: "javascript",
          testCases: [
            { input: "[1,2,3,4,5,6]", expectedOutput: "12" },
            { input: "[2,4,6]", expectedOutput: "12" },
            { input: "[1,3,5]", expectedOutput: "0" }
          ]
        }
      ]
    };
  }
};

/**
 * @desc Validate company name and generate strategic briefing
 * @route POST /api/ai/interview/validate-brand
 * @access Public
 */
export const validateBrand = asyncHandler(async (req, res) => {
  const { company, topic } = req.body;

  if (!company && !topic) {
    return res.status(400).json({ isValid: false, message: "Please provide a company or a specific topic focus." });
  }

  try {
    const groq = getGroqClient();
    
    const prompt = `
      You are a Business Intelligence and Technical Expert. 
      Task: 
      1. Verify if the company name "${company || 'N/A'}" is a real, correctly spelled corporate entity.
      2. Verify if the topic focus "${topic || 'N/A'}" is a real, valid professional or technical subject relevant for an interview.
      
      Instructions:
      - If company is provided: check its existence and spelling. Misspellings are invalid.
      - If topic is provided: check if it's a real field of study, technology, or business domain. Gibberish or non-professional topics are invalid.
      - If both are provided, both must be valid.
      - If either is invalid, set "isValid" to false and explain why in "message".
      - If valid, generate a professional Strategy Briefing based on the company (if provided) and topic.

      Return ONLY a JSON object:
      {
        "isValid": boolean,
        "message": "...",
        "visualIdentity": {
           "color": "HEX color matching the brand (e.g. #FF0000)",
           "accent": "Tailwind 'from- via- to-' gradient classes that match brand aesthetics",
           "glow": "rgba string for box-shadow (e.g. rgba(255,0,0,0.3))"
        },
        "briefing": {
           "overview": "Company or Domain overview...",
           "marketContext": "...",
           "targetCustomers": "...",
           "competitors": "...",
           "swot": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] },
           "growthOpportunities": "...",
           "risks": "...",
           "recommendations": "..."
        }
      }
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(chatCompletion.choices[0]?.message?.content || "{}");
    res.json(result);

  } catch (error) {
    console.error("Brand Validation AI Error:", error);
    res.status(500).json({ isValid: false, message: "Verification service currently unavailable." });
  }
});

/**
 * @desc High-speed brand identification for real-time UI updates
 * @route POST /api/ai/interview/identify
 */
export const identifyBrand = asyncHandler(async (req, res) => {
  const { company } = req.body;
  if (!company || company.length < 2) return res.json({ isValid: false });

  try {
    const groq = getGroqClient();
    const prompt = `Identify the brand identity for: "${company}". 
    Return ONLY a JSON object:
    {
      "isValid": boolean,
      "brandName": "Corrected name",
      "visualIdentity": {
         "color": "HEX",
         "accent": "Tailwind gradient classes",
         "glow": "rgba string"
      },
      "guide": "A short (2-sentence) professional advice summary for interviewing at this company."
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant", // Faster model for real-time
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (e) {
    res.json({ isValid: false });
  }
});

/**
 * @desc Generate Strategic Career Roadmap (90-day plan)
 * @route POST /api/ai/career/roadmap
 */
export const generateCareerRoadmap = asyncHandler(async (req, res) => {
  const { goal, currentSkills, experience } = req.body;

  if (!goal) {
    res.status(400);
    throw new Error("Career goal is required");
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      You are a high-performance Career Strategist. Generate a structured 90-day Roadmap to achieve this goal: "${goal}".
      Candidate Context: Skills: ${currentSkills || "Not specified"}, Experience: ${experience || "Not specified"}.

      Return ONLY a JSON object:
      {
        "objective": "High-level strategic objective (under 15 words)",
        "phases": [
          {
            "title": "Phase name (e.g. Initialization)",
            "subtitle": "Short descriptive goal",
            "timeframe": "Days 1-30",
            "progress": 0,
            "status": "Pending",
            "tasks": ["Task 1", "Task 2", "Task 3"]
          },
          { "title": "...", "subtitle": "...", "timeframe": "Days 31-60", "progress": 0, "status": "Pending", "tasks": [] },
          { "title": "...", "subtitle": "...", "timeframe": "Days 61-90", "progress": 0, "status": "Pending", "tasks": [] }
        ]
      }
      Rules: EXACTLY 3 phases. Tasks must be highly practical and corporate-focused. No markdown.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      response_format: { type: "json_object" }
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    console.error("Roadmap Gen Error:", error);
    res.status(500).json({ message: "Strategic roadmap generation failed." });
  }
});

/**
 * @desc Get Market Intelligence & Sector Analysis
 * @route POST /api/ai/career/insight
 */
export const getMarketIntelligence = asyncHandler(async (req, res) => {
  const { sector = "Technology", role = "Software Engineer" } = req.body;

  try {
    const groq = getGroqClient();
    const prompt = `
      Provide a Real-time Market Intelligence report for the "${role}" role in the "${sector}" sector.
      Return ONLY a JSON object:
      {
        "demandIndex": "High" | "Rising" | "Stable" | "Niche",
        "yoyGrowth": "+14.2% (example)",
        "avgSalary": "₹24L+ (example)",
        "salaryBracket": "Top 5% bracket (example)",
        "topTechStack": ["React 19", "Bun", "Go", "PostgreSQL"],
        "briefing": "1 sentence insight on why this is happening."
      }
      Format: Strict JSON.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.status(500).json({ message: "Intelligence report failed." });
  }
});

/**
 * @desc Get Skill Density Assessment Data
 * @route POST /api/ai/career/skills
 */
export const getSkillAssessment = asyncHandler(async (req, res) => {
  const { currentSkills = [], targetGoal } = req.body;

  try {
    const groq = getGroqClient();
    const prompt = `
      Analyze these skills: [${currentSkills.join(", ")}] against the goal: "${targetGoal}".
      Provide density points (0-100) for these 4 dimensions: Architecture, Backend, AI/ML, Product.
      Return ONLY a JSON object:
      {
        "density": { "architecture": 85, "backend": 70, "aiml": 40, "product": 60 },
        "syncStatus": "92% (example)",
        "missingCritical": "Explain the biggest gap in 1 sentence."
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.status(500).json({ message: "Skill assessment failed." });
  }
});
