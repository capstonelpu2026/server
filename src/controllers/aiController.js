import Groq from "groq-sdk";
import asyncHandler from "express-async-handler";
import { GoogleGenerativeAI } from "@google/generative-ai";
import nodeFetch from "node-fetch";
import fs from "fs";
import pdfParse from "pdf-parse";

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
    topic = "General", 
    difficulty = "Standard", 
    company = "Tech Industry", 
    experience = "Intermediate", 
    personality = "Professional", 
    count,
    duration = "15",
    focus = "Mixed"
  } = req.body;
  
  // Prioritize "count" from UI, fallback to "duration" calculation
  const totalQuestions = count ? parseInt(count) : Math.max(3, Math.floor(parseInt(duration) / 2));
  
  // All interviews are now 100% textual for high-fidelity professional experience
  const textualCount = totalQuestions;
  const mcqCount = 0;

  if (!process.env.GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY missing. Using professional fallback interview questions.");
    const fallbacks = [
      { type: "text", question: `Explain how you would architect a scalable system for ${company} if you were hired as a ${role}.` },
      { type: "text", question: "Can you walk me through a complex technical challenge where you had to make a trade-off between speed and maintainability?" },
      { type: "text", question: `How do you stay updated with the latest trends in ${topic} and how do you apply them to your current workflow?` },
      { type: "text", question: `Describe your experience with CI/CD pipelines and how you ensure code quality in a high-velocity environment like ${company}.` },
      { type: "text", question: "Describe a time you had to lead a project under extreme pressure. What was the outcome?" },
      { type: "text", question: `What are your strategies for managing technical debt in a fast-paced development cycle at a company like ${company}?` }
    ];
    // Scale fallback to match requested count
    const scaledFallbacks = Array.from({ length: totalQuestions }).map((_, i) => fallbacks[i % fallbacks.length]);
    return res.json({ questions: scaledFallbacks, isFallback: true });
  }

  try {
    const groq = getGroqClient();
    
    const prompt = `
      Act as a Senior Executive Recruiter at ${company} with a ${personality} personality. 
      Conduct a high-fidelity mock interview for a "${role}" position (Seniority: ${experience}). 
      
      TASK: Generate EXACTLY ${totalQuestions} realistic and challenging interview questions.
      
      CRITICAL FOCUS (Strictly follow these): 
      - The interview MUST be centered on: ${focus}.
      - Specific Topic: ${topic}.
      - Difficulty: ${difficulty}.
      - Persona Tone: ${personality}.
      
      RULES FOR QUALITY:
      - All questions MUST be open-ended and high-fidelity. NO multiple choice questions.
      - If focus is "Technical Only", ask deep technical/architectural questions.
      - If focus is "HR & Behavioral", focus on leadership and STAR-method questions.
      
      STRICT FORMATTING (SAVE TOKENS):
      - Return ONLY "text" questions.
      - Be concise in question text to avoid truncation.
      - Return ONLY a raw JSON array. No markdown, no intro/outro.
      
      JSON TEMPLATE:
      [
        { "type": "text", "question": "..." }
      ]
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 4096
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const firstBrace = text.indexOf("[");
    const lastBrace = text.lastIndexOf("]");
    let cleanText = text;
    if (firstBrace !== -1 && lastBrace !== -1) {
       cleanText = text.substring(firstBrace, lastBrace + 1);
    }
    
    let questions = JSON.parse(cleanText);
    if (!Array.isArray(questions)) throw new Error("AI did not return an array");
    
    res.json({ questions: questions.slice(0, totalQuestions) });

  } catch (error) {
    console.error("AI Generation Error:", error.message);
    const fallbacks = [
        { type: "text", question: `Explain a complex technical challenge you solved as a ${role} at ${company}.` },
        { type: "text", question: "Describe a situation where you had to deal with a difficult stakeholder or team member." },
        { type: "text", question: `What are the most important considerations when designing for scale in ${topic}?` }
    ];
    const scaledFallbacks = Array.from({ length: totalQuestions }).map((_, i) => fallbacks[i % fallbacks.length]);
    res.json({ questions: scaledFallbacks, isFallback: true });
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
  const { question, company = "General Tech", role = "Developer", personality = "Professional", transcript: bodyTranscript } = req.body;
  const audioFile = req.file;

  if (!audioFile && bodyTranscript === undefined) {
     res.status(400); 
     throw new Error("Audio file or text transcript is required");
  }

  let transcript = bodyTranscript || "";
  let tempPath = audioFile?.path;

  // Only run transcription if there is an audio file and no direct transcript
  if (audioFile && !bodyTranscript) {
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
          content: "You are a friendly, encouraging, and expert Career Coach named 'OneStop Copilot'. Your goal is to help students and job seekers with career advice, resume tips, and interview prep. Keep answers concise (under 100 words) unless asked for details. Use emojis occasionally."
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
 * @desc Validate brand consistency and strength
 * @route POST /api/ai/interview/validate-brand
 */
export const validateBrand = asyncHandler(async (req, res) => {
  const { brandName, description } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Evaluate the following brand for a tech company. 
    Brand: ${brandName}
    Description: ${description}
    Provide a score and feedback on its uniqueness, relevance, and stickiness in JSON: 
    { "score": 0-100, "feedback": "", "suggestions": [] }`;
    
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.json({ score: 70, feedback: "Unable to analyze brand at this time.", suggestions: [] });
  }
});

/**
 * @desc Identify brand from description
 * @route POST /api/ai/interview/identify
 */
export const identifyBrand = asyncHandler(async (req, res) => {
  const { query } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Identify potential real-world companies or brand names based on this description: "${query}". Return a JSON list: { "brands": ["...", "..."] }`;
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.json({ brands: ["Not found"] });
  }
});

/**
 * @desc Generate Career Roadmap
 * @route POST /api/ai/career/roadmap
 */
export const generateCareerRoadmap = asyncHandler(async (req, res) => {
  const { goal } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Generate a 90-day career roadmap curriculum for the goal: "${goal}".
    Format as strictly JSON: { 
      "objective": "", 
      "phases": [{ 
        "title": "", 
        "subtitle": "", 
        "timeframe": "", 
        "modules": [{ 
           "title": "Module name (e.g., React Fundamentals)", 
           "estTime": "e.g., 20 Hours or 3 Days", 
           "type": "Theory or Project or Assessment",
           "description": "Short 1-sentence description"
        }] 
      }] 
    }`;
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });
    const text = completion.choices[0]?.message?.content || "";
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    res.json(JSON.parse(clean));
  } catch (error) {
    res.json({ objective: goal, phases: [] });
  }
});

/**
 * @desc Get Market Intelligence
 * @route POST /api/ai/career/insight
 */
export const getMarketIntelligence = asyncHandler(async (req, res) => {
  const { role, location } = req.body;
  const resumeFile = req.file;

  if (!role) return res.status(400).json({ error: "Role is required" });

  if (!resumeFile) {
    return res.status(400).json({ error: "Resume file is required for deep-dive analysis." });
  }

  // Extract text from the uploaded file
  let resumeText = '';
  try {
    const filePath = resumeFile.path;
    const fileBuffer = fs.readFileSync(filePath);
    
    if (resumeFile.originalname.endsWith('.pdf')) {
      const pdfData = await pdfParse(fileBuffer);
      resumeText = pdfData.text;
    } else {
      // .txt, .doc, .docx - read as plain text
      resumeText = fileBuffer.toString('utf-8');
    }
    
    // Cleanup uploaded file
    try { fs.unlinkSync(filePath); } catch(e) {}
    
    if (!resumeText || resumeText.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract text from resume. Please upload a valid document." });
    }
  } catch (parseErr) {
    console.error("Resume Parse Error:", parseErr.message);
    return res.status(400).json({ error: "Failed to read resume file." });
  }

  try {
    const groq = getGroqClient();
    const prompt = `You are an elite Career Intelligence AI.
    Analyze the labor market for the role: "${role}" in the region: "${location || 'Global'}".
    Provide high-fidelity localized industry intelligence STRICTLY for this geography. DO NOT return data for any other region.
    If location is "${location}", your response MUST use the local currency (e.g., USD for USA, INR for India) and 2026 salary benchmarks specifically for "${location}".
    Realistically reflect the current 2026 market conditions.

    Crucially, evaluate the provided CANDIDATE RESUME against this specific role to identify actual gaps, needs to improve, and how well they fit.

    CANDIDATE RESUME:
    """
    ${resumeText.substring(0, 5000)}
    """
    
    Return ONLY this JSON structure (no extra text). ALL salaries MUST use the LOCAL CURRENCY of "${location || 'Global'}". Use SHORT READABLE formats like "₹8L - ₹15L" or "$80K - $120K" or "£55K - £85K" — NOT full numbers like "₹8,00,000". Be extremely realistic for 2026:
    {
      "demandIndex": "<Extreme | High | Balanced | Selective>",
      "hiringVelocity": "<Rapid | Consistent | Deliberate | Strategic>",
      "yoyGrowth": "<+X% annual growth>",
      "marketSentiment": "<SURGING | EXPANDING | STABLE | CONTRACTING>",
      "avgSalary": "<Average salary short format, e.g. ₹18L or $95K>",
      "salaryJunior": "<Junior salary range short format, e.g. ₹6L - ₹12L>",
      "salaryMid": "<Mid-level salary range short format>",
      "salarySenior": "<Senior/Elite salary range short format>",
      "yourEstimatedSalary": "<Based on THIS candidate's resume skills and experience, estimate THEIR realistic salary range in short format. Be honest and specific.>",
      "yourSalaryVerdict": "<One short sentence explaining WHY you estimated that salary for this candidate, referencing specific resume strengths or gaps.>",
      "topCompanies": ["<List 5 top companies hiring for this role in this region>"],
      "topLocations": [
        { 
          "city": "e.g. Bengaluru", 
          "description": "Short tactical summary", 
          "demandLevel": "<MAX_DEMAND | HIGH | STEADY>",
          "avgSalary": "<specific range for this city, e.g. ₹15L - ₹22L>",
          "growth": "<Growth rate in this hub, e.g. +18%>",
          "companies": ["Comp1", "Comp2", "Comp3"]
        }
      ],
      "countryProfile": {
        "region": "${location || 'Global'}",
        "currency": "<Local currency symbol, e.g. ₹, $, £, €>",
        "workVisa": "<Easy | Moderate | Difficult | Not Required>",
        "remoteAdoption": "<percentage of roles offering remote, e.g. 45%>",
        "avgExperience": "<Average years of experience employers seek, e.g. 3-5 years>",
        "topIndustries": ["<Top 3 industries hiring this role in this region>"],
        "costOfLiving": "<Low | Moderate | High | Very High>"
      },
      "topSkills": ["<Top 5 required skills missing from candidate's resume>"],
      "marketMomentum": {
        "status": "<Positive | Neutral | Declining>",
        "trend": "<A 4-5 sentence extremely detailed tactical briefing. Analyze how this specific candidate fits the role in ${location || 'Global'}, what specific gaps they have according to regional industry standards, and explicit steps to improve against current market liquidity.>"
      }
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });

    const text = completion.choices[0]?.message?.content || "";
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    res.json(JSON.parse(clean));
  } catch (error) {
    console.error("Market Intel Error:", error);
    res.json({ 
      demandIndex: "High", 
      hiringVelocity: "Consistent", 
      yoyGrowth: "+12%", 
      marketSentiment: "STABLE",
      avgSalary: "Competitive",
      salaryJunior: "Varies",
      salaryMid: "Varies",
      salarySenior: "Varies",
      topCompanies: [], 
      topLocations: [],
      marketMomentum: { status: "Neutral", trend: "Steady demand across sectors" }
    });
  }
});

/**
 * @desc Get Skill Assessment
 * @route POST /api/ai/career/skills
 */
export const getSkillAssessment = asyncHandler(async (req, res) => {
  const { targetGoal, location } = req.body;
  const resumeFile = req.file;

  if (!targetGoal) {
    return res.status(400).json({ error: "Target role is required." });
  }
  if (!resumeFile) {
    return res.status(400).json({ error: "Resume file is required." });
  }

  // Extract text from the uploaded file
  let resumeText = '';
  try {
    const filePath = resumeFile.path;
    const fileBuffer = fs.readFileSync(filePath);
    
    if (resumeFile.originalname.endsWith('.pdf')) {
      const pdfData = await pdfParse(fileBuffer);
      resumeText = pdfData.text;
    } else {
      // .txt, .doc, .docx - read as plain text
      resumeText = fileBuffer.toString('utf-8');
    }
    
    // Cleanup uploaded file
    try { fs.unlinkSync(filePath); } catch(e) {}
    
    if (!resumeText || resumeText.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract text from resume. Please upload a text-based PDF or .txt file." });
    }
  } catch (parseErr) {
    console.error("Resume Parse Error:", parseErr.message);
    return res.status(400).json({ error: "Failed to read resume file. Please try a .txt or text-based .pdf." });
  }

  try {
    const groq = getGroqClient();
    const prompt = `You are a world-class Career Intelligence AI used by Fortune 500 recruiters.

TASK: Analyze the candidate's RESUME against the TARGET ROLE and provide a brutally honest industry gap analysis.

TARGET ROLE: "${targetGoal}"

CANDIDATE'S RESUME:
"""
${resumeText.substring(0, 6000)}
"""

ANALYSIS INSTRUCTIONS:
1. Compare the candidate's ACTUAL skills, experience, projects, and education from their resume against what TOP companies (Google, Amazon, Microsoft, Meta) require for a "${targetGoal}" role.
2. Be specific — reference actual items from the resume, not generic advice.
3. The fitScore should reflect REALITY. A fresh graduate applying for "Senior Architect" should get 15-30%, not 50%.
4. Identify the 4 most critical technical or professional domains for the target role. Score the candidate out of 100 on each. Use these 4 domain names as the exact keys in the "density" object.

Return ONLY this JSON (no markdown, no extra text):
{
  "fitScore": <number 0-100>,
  "grade": "<Foundational | Intermediate | Advanced | Elite>",
  "density": {
    "<Domain 1 Name e.g. Threat Analysis>": <0-100>,
    "<Domain 2 Name e.g. Network Security>": <0-100>,
    "<Domain 3 Name>": <0-100>,
    "<Domain 4 Name>": <0-100>
  },
  "strengths": ["<3-5 specific strengths found IN the resume>"],
  "criticalGaps": ["<3-5 specific skills/experience MISSING from the resume for this role>"],
  "improvements": ["<3-5 actionable steps the candidate should take to close the gap>"],
  "resumeVsIndustry": "<A 2-3 sentence summary comparing this resume against world-class standards for this role>",
  "topCompanyFit": {
    "google": <0-100>,
    "amazon": <0-100>,
    "microsoft": <0-100>,
    "startup": <0-100>
  }
}

Provide COMPENSTATION ESTIMATES (Base & Upskill Delta) in the local currency or standard format specifically for "${location || 'Global'}".
`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a precision career analytics engine. You output ONLY valid JSON. No markdown. No preamble. Be brutally honest in scoring." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
      max_tokens: 2048,
    });

    const text = completion.choices[0]?.message?.content || "";
    let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    // Robust JSON extraction
    const jsonStart = clean.indexOf("{");
    const jsonEnd = clean.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      clean = clean.substring(jsonStart, jsonEnd + 1);
    }

    res.json(JSON.parse(clean));
  } catch (error) {
    console.error("Skill Assessment Error:", error.message);
    res.json({
      fitScore: 0,
      grade: "Error",
      density: { architecture: 0, backend: 0, aiml: 0, product: 0 },
      strengths: ["Unable to analyze at this time"],
      criticalGaps: ["AI service temporarily unavailable"],
      improvements: ["Please try again in a few moments"],
      resumeVsIndustry: "Analysis could not be completed due to a service error.",
      topCompanyFit: { google: 0, amazon: 0, microsoft: 0, startup: 0 }
    });
  }
});

/**
 * @desc Generate Event Description
 * @route POST /api/ai/event-description
 */
export const generateEventDescription = asyncHandler(async (req, res) => {
  const { title, category, organizer, location } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Generate a professional, highly engaging 3-4 paragraph description for a ${category || 'tech'} event titled "${title}". 
    ${organizer ? `The event is organized by ${organizer}.` : ''}
    ${location ? `It will be held at/in: ${location}.` : ''}
    Write it in a compelling, corporate tone.
    Return ONLY a valid JSON object matching this structure: 
    { "description": "The detailed event description..." }`;
    
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You return strictly valid JSON objects only. No preamble, no markdown tags." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      response_format: { type: "json_object" }
    });

    let text = completion.choices[0]?.message?.content || "{}";
    
    const parsed = JSON.parse(text);
    if (!parsed.description) {
      throw new Error("Missing description in AI response");
    }

    res.json(parsed);
  } catch (error) {
    console.error("Event Gen Error:", error.message || error);
    // Even if it fails, return something better than a 1-liner
    res.json({ description: `${title} is a premier ${category || 'event'} designed to bring together top talent, industry leaders, and innovators.\n\nJoin us for an incredible experience where you can network, learn, and showcase your skills.\n\nDon't miss out on this opportunity!` });
  }
});

/**
 * @desc Generate Coding Directives
 * @route POST /api/ai/coding-directives
 */
export const generateCodingDirectives = asyncHandler(async (req, res) => {
  const { problemContext } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Generate step-by-step coding instructions and directives for: "${problemContext}". 
    Format as JSON: { "directives": ["...", "..."] }`;
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.json({ directives: ["Break down the problem into smaller tasks.", "Implement core logic first."] });
  }
});

/**
 * @desc Generate Professional Bio
 * @route POST /api/ai/generate-bio
 */
export const generateBio = asyncHandler(async (req, res) => {
  const { userData } = req.body;
  try {
    const groq = getGroqClient();
    const prompt = `Generate 3 professional bios (Short, Medium, Long) based on these details: ${JSON.stringify(userData)}. 
    Return JSON: { "short": "", "medium": "", "long": "" }`;
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
    });
    res.json(JSON.parse(completion.choices[0]?.message?.content || "{}"));
  } catch (error) {
    res.json({ short: "Professional", medium: "Experienced Professional", long: "Highly experienced professional with a focus on excellence." });
  }
});

/**
 * @desc Get real-time company intelligence for interview prep
 * @route POST /api/ai/interview/company-intel
 * @access Public
 */
export const getCompanyIntelligence = asyncHandler(async (req, res) => {
  const { company, role } = req.body;

  if (!company) {
    return res.status(400).json({ message: "Company name is required" });
  }

  try {
    const groq = getGroqClient();
    const prompt = `
      Act as a high-end corporate recruiter and market analyst. 
      Analyze the company "${company}" specifically for a candidate applying for a "${role}" position.
      
      Provide enterprise-grade intelligence in the following JSON format:
      {
        "philosophy": "A 2-sentence summary of their hiring culture and core values (e.g. Google's 'Googliness').",
        "requirements": ["3 key bullet points of what they MUST see in a ${role} candidate"],
        "focus": ["4 specific technical or behavioral topics the interview will highlight"],
        "difficulty_score": "High/Medium/Extreme based on market reputation"
      }

      Return ONLY the raw JSON. No conversational text.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0]?.message?.content || "";
    let cleanText = text;
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = text.substring(firstBrace, lastBrace + 1);
    }

    const intelligence = JSON.parse(cleanText || "{}");
    res.json({ intelligence });

  } catch (error) {
    console.error("Company Intel Error:", error);
    res.json({
      intelligence: {
        philosophy: `A leading innovator in the industry, focused on excellence and scalability for ${role} roles.`,
        requirements: ["Strong technical fundamentals", "Cultural alignment", "Problem-solving mindset"],
        focus: ["System Architecture", "Behavioral Alignment", "Technical Depth", "Execution"],
        difficulty_score: "High"
      }
    });
  }
});

/**
 * @desc Match mentors using AI based on user goals
 * @route POST /api/ai/match-mentors
 * @access Public
 */
export const matchMentors = asyncHandler(async (req, res) => {
  const { goal, skills, experience, mentors } = req.body;

  if (!mentors || !Array.isArray(mentors) || mentors.length === 0) {
    return res.status(400).json({ message: "Mentors data is required" });
  }

  try {
    const groq = getGroqClient();
    
    // Create a simplified list to send to AI
    const mentorList = mentors.map(m => ({
      id: m._id,
      name: m.name,
      company: m.mentorProfile?.company || "Unknown",
      experience: m.mentorProfile?.experience || 0,
      skills: m.mentorProfile?.skills || [],
      bio: m.mentorProfile?.bio || ""
    }));

    const prompt = `
      Act as an expert Career Matchmaker. 
      A candidate is looking for a mentor with the following profile:
      - Goal: "${goal}"
      - Skills they want to learn: "${skills}"
      - Current Experience: "${experience}"
      
      Here is a list of available mentors (JSON format):
      ${JSON.stringify(mentorList)}
      
      Analyze the candidate's goals and select the TOP 3 best matching mentors from the list.
      Provide a strong, compelling 1-2 sentence reason for why each mentor is a great match.
      
      Return ONLY valid JSON format:
      {
        "matches": [
          { "id": "mentor_id_here", "reason": "reason why..." },
          { "id": "mentor_id_here", "reason": "reason why..." },
          { "id": "mentor_id_here", "reason": "reason why..." }
        ]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2, // Low temp for more accurate matching
      max_tokens: 1500,
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0]?.message?.content || "";
    const matches = JSON.parse(text || "{}");
    
    res.json(matches);

  } catch (error) {
    console.error("Mentor Matching Error:", error);
    // Fallback: pick up to 3 random or first 3
    res.json({
      matches: mentors.slice(0, 3).map(m => ({
        id: m._id,
        reason: "Matched based on our general matching algorithm."
      }))
    });
  }
});

/**
 * @desc Refine/Polish user-written text (fix grammar, improve English)
 * @route POST /api/ai/refine-text
 * @access Public
 */
export const refineText = asyncHandler(async (req, res) => {
  const { text, context = "professional bio" } = req.body;

  if (!text || text.trim().length < 5) {
    res.status(400);
    throw new Error("Text is too short to refine.");
  }

  try {
    const groq = getGroqClient();

    const prompt = `
      You are an expert English editor. A user has written the following text for their ${context}.
      Their English may be informal, grammatically incorrect, or unclear.

      Your task:
      1. Fix ALL grammar and spelling mistakes.
      2. Improve sentence structure and flow for professional clarity.
      3. Make the tone confident and professional.
      4. PRESERVE the original meaning and intent — do NOT add new facts or embellish.
      5. Keep the length similar to the original (don't drastically expand or shrink it).

      User's Original Text:
      "${text}"

      Return ONLY the refined text as a plain string. No explanation, no preamble, no quotes around the output.
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a precise English editor. Return ONLY the refined text with no extra commentary." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 512
    });

    const refined = completion.choices[0]?.message?.content?.trim() || text;
    res.json({ refined });

  } catch (error) {
    console.error("Refine Text Error:", error.message);
    res.status(500).json({ message: "AI refinement failed. Please try again." });
  }
});
