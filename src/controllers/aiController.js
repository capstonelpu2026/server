import Groq from "groq-sdk";
import asyncHandler from "express-async-handler";
import { GoogleGenerativeAI } from "@google/generative-ai";
import nodeFetch from "node-fetch";

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
  const { role = "Software Engineer", topic, difficulty = "Medium", company = "Tech Industry", experience = "Intermediate" } = req.body;

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
    
    // Updated prompt for company-specific interview
    const prompt = `
      Act as a Senior Technical Recruiter at ${company}. You are conducting a mock interview for a "${role}" position (Experience Level: ${experience}). 
      
      Generate a realistic interview set of 8 questions that ${company} is likely to ask for this role.
      Topic Focus: ${topic || "General"}
      Difficulty: ${difficulty}
      
      Structure:
      - 3 Deep Behavioral/Technical Questions (type: "text") tailored to ${company}'s culture (e.g., Leadership Principles for Amazon, Googliness for Google).
      - 5 Multiple Choice Questions (type: "mcq") with 4 options and the correct answer, testing technical fundamentals.

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
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let questions;
    try {
        questions = JSON.parse(cleanText);
    } catch (e) {
        console.error("JSON Parse Error:", e);
        // Fallback robust parsing if AI returns malformed JSON
        questions = [
            { type: "text", question: `Explain a complex technical challenge you solved as a ${role}.` }
        ];
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
      Generate a technical quiz for the topic: "${topic}".
      Difficulty: ${difficulty}
      Number of Questions: ${count}
      
      Format: Return ONLY a JSON array of objects.
      Structure:
      [
        {
          "question": "Question text here?",
          "options": ["A", "B", "C", "D"],
          "correctAnswer": "Exact text of the correct option",
          "explanation": "Brief explanation of why it is correct"
        }
      ]
      
      Ensure questions are code-focused where applicable (e.g., "What is the output of...").
      No markdown, just raw JSON.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const questions = JSON.parse(cleanText);

    res.json({ topic, questions });

  } catch (error) {
    console.error("AI Quiz Gen Error:", error.message);
    res.json({
       topic,
       questions: [
          {
             question: `What is the primary purpose of ${topic || "this technology"}?`,
             options: ["To style web pages", "To build user interfaces", "To manage databases", "To handle HTTP requests"],
             correctAnswer: "To build user interfaces",
             explanation: "This is a default fallback question."
          }
       ],
       isFallback: true
    });
  }
});

/**
 * @desc Analyze interview answer
 * @route POST /api/ai/interview/analyze
 * @access Public
 */
export const analyzeAnswer = asyncHandler(async (req, res) => {
  const { question, answer, company = "General Tech", role = "Developer" } = req.body;

  if (!question || !answer) {
    res.status(400);
    throw new Error("Question and answer are required");
  }

  try {
    const groq = getGroqClient();
    
    // Updated prompt for company-specific fit analysis
    const prompt = `
      Act as a Hiring Manager at ${company}. Analyze the following candidate answer for a ${role} position.
      
      Question: "${question}"
      Candidate's Answer: "${answer}"
      
      Provide a comprehensive evaluation in valid JSON format:
      {
        "score": number (0-100),
        "sentiment": "Excellent" | "Good" | "Average" | "Needs Improvement",
        "hiringDecision": "Strong Hire" | "Hire" | "Weak Hire" | "No Hire" (Based on ${company} standards),
        "cultureFit": "High" | "Medium" | "Low" (Does this align with ${company}'s values?),
        "feedback": "Professional feedback focusing on technical accuracy and ${company} culture fit.",
        "strengths": ["list..."],
        "weaknesses": ["list..."],
        "improvements": "Actionable tips to improve.",
        "sampleAnswer": "An ideal answer that would impress a ${company} recruiter."
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
import fs from "fs";

export const analyzeAudioAnswer = asyncHandler(async (req, res) => {
  const { question, company = "General Tech", role = "Developer" } = req.body;
  const audioFile = req.file;

  if (!audioFile) {
     res.status(400); 
     throw new Error("Audio file is required");
  }

  let transcript = "";
  try {
     const groq = getGroqClient();
     
     // 1. Transcribe
     const translation = await groq.audio.transcriptions.create({
       file: fs.createReadStream(audioFile.path),
       model: "whisper-large-v3",
       response_format: "json",
       temperature: 0.0
     });
     
     transcript = translation.text;
     
     // Cleanup temp file
     fs.unlinkSync(audioFile.path);
     
  } catch (err) {
     console.error("Transcription Error:", err);
     // If transcription fails, we might still want to cleanup
     if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
     res.status(500);
     throw new Error("Failed to transcribe audio: " + err.message);
  }

  // 2. Analyze (Re-using logic from analyzeAnswer but inline for now to avoid refactor complexity)
  if (!transcript || transcript.trim().length < 5) {
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
      Act as a Hiring Manager at ${company}. Analyze the following candidate spoken answer for a ${role} position.
      
      Question: "${question}"
      Candidate's Spoken Answer (Transcribed): "${transcript}"
      
      Provide a comprehensive evaluation in valid JSON format:
      {
        "score": number (0-100),
        "sentiment": "Excellent" | "Good" | "Average" | "Needs Improvement",
        "hiringDecision": "Strong Hire" | "Hire" | "Weak Hire" | "No Hire" (Based on ${company} standards),
        "cultureFit": "High" | "Medium" | "Low",
        "feedback": "Professional feedback focusing on technical accuracy and communication clarity.",
        "strengths": ["list..."],
        "weaknesses": ["list..."],
        "improvements": "Actionable tips.",
        "sampleAnswer": "Ideal answer."
      }
      
      Return ONLY JSON.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const analysis = JSON.parse(cleanText);
    
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
      Act as an expert HR Recruiter. Write a compelling, professional Job Description for:
      
      Role: ${title}
      Location: ${location}
      Type: ${type}
      Key Skills: ${skills.join(", ")}
      
      Structure:
      1. About the Role (Exciting intro)
      2. Key Responsibilities (Bullet points)
      3. Requirements (Technical & Soft skills)
      4. Why Join Us? (Benefits/Culture)

      Keep it engaging and modern. Use standard markdown formatting (bullet points, bold text).
      Length: ~300 words.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
    });

    res.json({ description: completion.choices[0]?.message?.content || "" });

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
      Write a professional, personalized cover letter for:
      Candidate Name: ${userProfile.name}
      Applying for: ${jobTitle} at ${company}
      
      Candidate Skills: ${userProfile.skills?.join(", ") || "General"}
      Experience: ${userProfile.experience || "Fresher"}
      
      Tone: Professional, enthusiastic, and confident.
      Structure:
      - Salutation 
      - Strong opening hook (why this role?)
      - 2 paragraphs connecting skills to the role
      - Call to action (interview request)
      - Sign-off
      
      make it concise (under 250 words).
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
    });

    res.json({ coverLetter: completion.choices[0]?.message?.content || "" });

  } catch (error) {
    console.error("AI Cover Letter Error:", error.message);
    res.status(500).json({ coverLetter: "Dear Hiring Manager,\n\nI am writing to express my interest in this role..." });
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
      max_tokens: 2500
    });

    const text = chatCompletion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const enhancement = JSON.parse(cleanText);
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
    const prompt = `
      You are a Senior Technical Interviewer. Generate a high-integrity technical assessment for the role: "${jobTitle}".
      Job Description: "${jobDescription.substring(0, 500)}..."

      Generate 10 challenging Multiple Choice Questions (MCQs) that strictly test the core skills mentioned in the job description.
      
      Requirements:
      - 4 options per question.
      - 1 correct answer.
      - Mix of conceptual and code-output questions.
      
      Return ONLY a JSON array:
      [
        {
          "question": "text",
          "options": ["A", "B", "C", "D"],
          "answer": "Exact text of correct option"
        }
      ]
      No preamble, no markdown.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
    });

    const text = completion.choices[0]?.message?.content || "";
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (error) {
    console.error("AI Hiring Test Gen Error:", error);
    // Fallback simple questions
    return Array.from({ length: 10 }).map((_, i) => ({
      question: `Technical Concept Question ${i+1} for ${jobTitle}`,
      options: ["Highly Efficient", "Scalable", "Maintainable", "None of these"],
      answer: "Scalable"
    }));
  }
};
