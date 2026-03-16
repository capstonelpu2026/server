import mongoose from "mongoose";
import multer from "multer";
import Event from "../models/Event.js";
import Submission from "../models/Submission.js";
import Application from "../models/Application.js";
import Job from "../models/Job.js";
import AuditLog from "../models/AuditLog.js";
import cloudinary from "../utils/cloudinary.js";
import { notifyUser } from "../utils/notifyUser.js";

/* =====================================================
   📦 MULTER CONFIG (Memory Storage for Cloudinary)
===================================================== */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
});   

const uploadBufferToCloudinary = (buffer, folder, filename = "file") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", public_id: `${Date.now()}_${filename}` },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

/* =====================================================
   🧠 HELPERS
===================================================== */
const parseMaybeJSON = (val, fallback) => {
  if (val === undefined || val === null) return fallback;
  if (Array.isArray(val) || typeof val === "object") return val;
  const str = String(val).trim();
  if (!str) return fallback;
  try {
    const parsed = JSON.parse(str);
    return parsed ?? fallback;
  } catch {
    if (typeof val === "string") {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return fallback;
  }
};

/* =====================================================
   🎉 EVENT CRUD
===================================================== */

export const createEvent = async (req, res) => {
  try {
    const body = req.body;

    if (!body.title || !body.startDate || !body.endDate || !body.registrationDeadline) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const eventStart = new Date(body.startDate);
    const minStartDate = new Date();
    minStartDate.setHours(0, 0, 0, 0); // Allow starting today

    if (eventStart < minStartDate) {
      return res.status(400).json({ 
        message: "Event start date cannot be in the past." 
      });
    }

    if (new Date(body.endDate) <= eventStart) {
      return res.status(400).json({ message: "End date must be after start date." });
    }

    if (new Date(body.registrationDeadline) > eventStart) {
      return res.status(400).json({ message: "Registration deadline must be before or on the event start date." });
    }

    let coverImage;
    if (req.file) {
      const uploaded = await uploadBufferToCloudinary(
        req.file.buffer,
        "onestop/events",
        "cover"
      );
      coverImage = { url: uploaded.secure_url, publicId: uploaded.public_id };
    }

    const event = await Event.create({
      title: body.title,
      subtitle: body.subtitle ?? "",
      description: body.description ?? "",
      organizer: body.organizer ?? "",
      category: body.category ?? "other",
      tags: parseMaybeJSON(body.tags, []),
      location: body.location ?? "Online",
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      registrationDeadline: new Date(body.registrationDeadline),
      maxTeamSize: Number(body.maxTeamSize ?? 1),
      prizes: parseMaybeJSON(body.prizes, []),
      rules: parseMaybeJSON(body.rules, []),
      faqs: parseMaybeJSON(body.faqs, []),
      rounds: parseMaybeJSON(body.rounds, []),
      coding: parseMaybeJSON(body.coding, { problems: [], duration: 60 }),
      quiz: parseMaybeJSON(body.quiz, { questions: [], duration: 15 }),
      customFields: parseMaybeJSON(body.customFields, []),
      certificateConfig: parseMaybeJSON(body.certificateConfig, {}),
      teamFinderEnabled: body.teamFinderEnabled !== undefined ? String(body.teamFinderEnabled) === "true" : true,
      visibility: body.visibility || "public",
      linkedJob: body.linkedJob || null,
      coverImage,
      createdBy: req.user._id,
    });

    await AuditLog.create({
      action: "CREATE_EVENT",
      performedBy: req.user._id,
      details: `Created event "${event.title}" (${event._id})`,
    });

    res.status(201).json(event);
  } catch (err) {
    console.error("CreateEvent error:", err);
    res.status(500).json({ message: "Error creating event" });
  }
};

// 🌍 Get Events (Public)
// 🌍 Get Events (Public)
export const getEvents = async (req, res) => {
  try {
    const { search = "", status = "", category = "", page = 1, limit = 9 } = req.query;
    const query = {};
    const now = new Date();

    if (search) query.$text = { $search: search };

    // 🏷️ Category Normalization: Case-insensitive regex matching
    if (category && category !== "all") {
      const normalizedCat = String(category).trim().replace(/[\s_]+/g, "-");
      query.category = { $regex: new RegExp(`^${normalizedCat}$`, "i") };
    }
    
    // 👤 Mine Filter (Recruiter/Mentor managing own events)
    if (req.query.mine === "true" && req.user) {
      query.createdBy = req.user._id;
    }

    // 🗓️ Date-based Status Filtering
    if (status === "live" || status === "ongoing") {
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    } else if (status === "upcoming") {
      query.startDate = { $gt: now };
    } else if (status === "past" || status === "ended") {
      query.endDate = { $lt: now };
    }

    const total = await Event.countDocuments(query);
    
    // Sort logic: Upcoming should be soonest first (1), everything else (including All Time) most recent first (-1)
    const sortOrder = (status === "upcoming" || status === "live" || status === "ongoing") ? 1 : -1;

    const events = await Event.find(query)
      .sort({ startDate: sortOrder })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean({ virtuals: true });

    res.json({
      events,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)) || 1,
    });
  } catch (err) {
    console.error("GetEvents error:", err);
    res.status(500).json({ message: "Error fetching events" });
  }
};


// 🔍 Get Event by ID
export const getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate("createdBy", "name email role")
      .populate("linkedJob", "title skills");
    if (!event) return res.status(404).json({ message: "Event not found" });
    res.json(event);
  } catch (err) {
    console.error("GetEventById error:", err);
    res.status(500).json({ message: "Error fetching event" });
  }
};

// ✏️ Update Event
export const updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // 🔒 Security: Ownership check for non-admins
    const isSuperAdmin = ["admin", "superadmin"].includes(req.user.role);
    if (!isSuperAdmin && String(event.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "Access Denied: You can only modify your own events." });
    }

    // 🔒 Security: Prevent modification of past events
    if (new Date() > new Date(event.endDate)) {
      return res.status(400).json({ message: "Completed events cannot be modified." });
    }

    const updatable = [
      "title", "subtitle", "description", "organizer", "category",
      "tags", "location", "startDate", "endDate", "registrationDeadline",
      "maxTeamSize", "prizes", "rules", "faqs", "visibility", "linkedJob",
      "rounds", "customFields", "certificateConfig", "teamFinderEnabled"
    ];

    updatable.forEach((k) => {
      if (req.body[k] !== undefined) {
        if (["startDate", "endDate", "registrationDeadline"].includes(k)) {
          if (req.body[k]) event[k] = new Date(req.body[k]);
        } else if (["tags", "rules", "prizes", "faqs", "rounds", "customFields", "certificateConfig"].includes(k)) {
          event[k] = parseMaybeJSON(req.body[k], event[k]);
        } else if (k === "maxTeamSize") {
          event[k] = Number(req.body[k]) || event[k];
        } else if (k === "teamFinderEnabled") {
          event[k] = String(req.body[k]) === "true";
        } else if (k === "linkedJob") {
          const val = req.body[k];
          if (!val || val === "null" || val === "undefined" || val === "") {
            event[k] = null;
          } else if (mongoose.Types.ObjectId.isValid(val)) {
            event[k] = val;
          } else {
            // Ignore invalid ID strings to prevent 500 crashes, or just set to null
            event[k] = null;
          }
        } else {
          event[k] = req.body[k];
        }
      }
    });

    // Date Logic Validation
    if (event.endDate <= event.startDate) {
      return res.status(400).json({ message: "End date must be after start date." });
    }
    // Optimization: Allow registration deadline to be exactly the same as start (e.g. contest starts when registration ends)
    if (new Date(event.registrationDeadline).getTime() > new Date(event.startDate).getTime()) {
      return res.status(400).json({ message: "Registration deadline must be before or on the event start date." });
    }

    if (req.file) {
      if (event.coverImage?.publicId) {
        try {
          await cloudinary.uploader.destroy(event.coverImage.publicId);
        } catch (e) {
          console.warn("Cloudinary destroy failed:", e?.message);
        }
      }
      const uploaded = await uploadBufferToCloudinary(req.file.buffer, "onestop/events", "cover");
      event.coverImage = { url: uploaded.secure_url, publicId: uploaded.public_id };
    }

    await event.save();

    await AuditLog.create({
      action: "UPDATE_EVENT",
      performedBy: req.user._id,
      details: `Updated event "${event.title}" (${event._id})`,
    });

    res.json(event);
  } catch (err) {
    console.error("UpdateEvent error:", err);
    // Return more specific error message if it's a known Mongoose error
    if (err.name === "ValidationError" || err.name === "CastError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Error updating event. Check server logs." });
  }
};

// 🗑️ Delete Event
export const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // 🔒 Security: Ownership check for non-admins
    const isSuperAdmin = ["admin", "superadmin"].includes(req.user.role);
    if (!isSuperAdmin && String(event.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "Access Denied: You can only delete your own events." });
    }

    // 🔒 Security: Prevent deletion of past events
    if (new Date() > new Date(event.endDate)) {
      return res.status(400).json({ message: "Completed events cannot be deleted." });
    }

    if (event.coverImage?.publicId) {
      try {
        await cloudinary.uploader.destroy(event.coverImage.publicId);
      } catch (e) {
        console.warn("Cloudinary destroy failed:", e?.message);
      }
    }

    // 1. Delete Submission Files from Cloudinary
    const submissions = await Submission.find({ event: event._id });
    for (const sub of submissions) {
      if (sub.filePublicId) {
        try {
          await cloudinary.uploader.destroy(sub.filePublicId);
        } catch (e) {
          console.warn(`Failed to delete submission file ${sub.filePublicId}:`, e.message);
        }
      }
    }

    // 2. Delete all submission records
    await Submission.deleteMany({ event: event._id });

    // 3. Delete the event itself
    await event.deleteOne();

    await AuditLog.create({
      action: "DELETE_EVENT",
      performedBy: req.user._id,
      details: `Deleted event "${event.title}" (${event._id})`,
    });

    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    console.error("DeleteEvent error:", err);
    res.status(500).json({ message: "Error deleting event" });
  }
};

/* =====================================================
   🎟️ REGISTRATION & SUBMISSION
===================================================== */

export const registerForEvent = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { teamName = "", customResponses = [] } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (new Date() > new Date(event.registrationDeadline)) {
      return res.status(400).json({ message: "Registration deadline has passed" });
    }

    const already = event.participants.find(
      (p) => String(p.userId) === String(req.user._id)
    );
    if (already) {
      return res.status(400).json({ message: "You are already registered for this event" });
    }

    // Initialize round status for all defined rounds
    const roundStatus = (event.rounds || []).map(r => ({
      roundId: r.roundNumber,
      status: "pending",
      score: null,
      feedback: ""
    }));

    event.participants.push({
      userId: req.user._id,
      name: req.user.name,
      email: req.user.email,
      teamName,
      customResponses,
      registrationStatus: "registered",
      currentRound: 1,
      roundStatus,
      registeredAt: new Date(),
      submissionStatus: "not_submitted",
    });

    await event.save();

    await notifyUser({
      userId: req.user._id,
      email: req.user.email,
      title: "Event Registration Confirmed",
      message: `You have successfully registered for "${event.title}".`,
      link: `/events/${event._id}`,
      type: "event",
      emailEnabled: true,
      emailSubject: `Registered: ${event.title}`
    });

    await AuditLog.create({
      action: "REGISTER_EVENT",
      performedBy: req.user._id,
      details: `Registered for event "${event.title}" (${event._id})`,
    });

    // 🔗 Auto-Apply to Linked Job (Hiring Challenge)
    if (event.linkedJob) {
      const job = await Job.findById(event.linkedJob);
      if (job) {
         const existingApp = await Application.findOne({ job: job._id, candidate: req.user._id });
         if (!existingApp) {
             // Calculate ATS Score ...
             const userSkills = req.user.skills || [];
             const jobSkills = job.skills || [];
             let score = 50; 
             let verdict = "Good";

             if (jobSkills.length > 0) {
                 const matchCount = jobSkills.filter(js => 
                     userSkills.some(us => us.toLowerCase().includes(js.toLowerCase()))
                 ).length;
                 score = Math.round((matchCount / jobSkills.length) * 100);
                 if (score >= 80) verdict = "Excellent";
                 else if (score >= 50) verdict = "Good";
                 else verdict = "Fair";
             }

             await Application.create({
                 job: job._id,
                 candidate: req.user._id,
                 resumeUrl: req.user.resume,
                 status: "applied",
                 atsScore: score,
                 atsVerdict: verdict
             });

             await notifyUser({
                userId: req.user._id,
                email: req.user.email,
                title: "Auto-Applied to Job",
                message: `Since you registered for "${event.title}", you have been auto-applied to the linked job: ${job.title}.`,
                link: `/jobs/${job._id}`,
                type: "job",
                emailEnabled: false 
             });
         }
      }
    }

    res.status(201).json({ message: "Registration successful" });
  } catch (err) {
    console.error("RegisterForEvent error:", err);
    res.status(500).json({ message: "Error registering for event" });
  }
};

// 📤 Upload Submission
export const uploadSubmission = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { submissionLink = "" } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // 🔒 Security: Prevent submissions for past events
    if (new Date() > new Date(event.endDate)) {
      return res.status(400).json({ message: "This event has ended. Submissions are no longer accepted." });
    }

    const participant = event.participants.find(
      (p) => String(p.userId) === String(req.user._id)
    );
    if (!participant)
      return res.status(403).json({ message: "Please register before submitting" });

    let fileResult;
    if (req.file) {
      fileResult = await uploadBufferToCloudinary(
        req.file.buffer,
        "onestop/submissions",
        req.file.originalname?.split(".")[0] || "submission"
      );
    }

    await Submission.findOneAndUpdate(
      { event: eventId, user: req.user._id },
      {
        event: eventId,
        user: req.user._id,
        teamName: participant.teamName,
        submissionLink,
        fileUrl: fileResult?.secure_url || "",
        filePublicId: fileResult?.public_id || "",
        status: "submitted",
      },
      { new: true, upsert: true }
    );

    participant.submissionStatus = "submitted";
    participant.lastUpdated = new Date();
    await event.save();

    await notifyUser({
      userId: req.user._id,
      email: req.user.email,
      title: "Submission Received",
      message: `Your entry for "${event.title}" has been received.`,
      link: `/events/${event._id}`,
      type: "event",
      emailEnabled: true,
      emailSubject: `Submission Confirmed: ${event.title}`
    });

    await AuditLog.create({
      action: "SUBMIT_ENTRY",
      performedBy: req.user._id,
      details: `User submitted entry for "${event.title}" (${event._id})`,
    });

    res.status(201).json({ message: "Submission uploaded successfully" });
  } catch (err) {
    console.error("UploadSubmission error:", err);
    res.status(500).json({ message: "Error uploading submission" });
  }
};

/* =====================================================
   ⚖️ EVALUATION & LEADERBOARD
===================================================== */

export const evaluateSubmission = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { userId, score, feedback = "", roundId = 1, status = "qualified" } = req.body;

    if (!eventId || !userId)
      return res.status(400).json({ message: "Missing eventId or userId" });

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const participant = event.participants.find(
      (p) => String(p.userId) === String(userId)
    );
    if (!participant)
      return res.status(404).json({ message: "Participant not found for this event" });

    // 🏆 Multi-Round Evaluation Logic
    if (!participant.roundStatus) participant.roundStatus = [];
    
    let rStatus = participant.roundStatus.find(rs => rs.roundId === Number(roundId));
    if (!rStatus) {
       rStatus = { roundId: Number(roundId), status, score, feedback, evaluatedAt: new Date() };
       participant.roundStatus.push(rStatus);
    } else {
       rStatus.status = status;
       rStatus.score = score;
       rStatus.feedback = feedback;
       rStatus.evaluatedAt = new Date();
    }

    // Move to next round if qualified
    if (status === "qualified") {
       const nextRound = event.rounds.find(r => r.roundNumber === Number(roundId) + 1);
       if (nextRound) {
          participant.currentRound = nextRound.roundNumber;
          participant.submissionStatus = "not_submitted"; // Reset for next round
       } else {
          // Final round completed
          participant.submissionStatus = "reviewed";
       }
    } else if (status === "disqualified") {
       participant.submissionStatus = "rejected";
    }

    // Update Overall Stats
    participant.score = typeof score === "number" ? score : participant.score;
    participant.feedback = feedback || participant.feedback;
    participant.lastUpdated = new Date();

    await event.save();

    // Sync with Submission Model
    await Submission.findOneAndUpdate(
      { event: eventId, user: userId },
      {
        $set: {
          finalScore: participant.score,
          feedback: participant.feedback,
          status: status === "qualified" ? "reviewed" : "rejected",
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );

    await notifyUser({
      userId: userId,
      email: participant.email,
      title: status === "qualified" ? "Qualified for Next Round!" : "Event Result Published",
      message: status === "qualified" 
        ? `Congratulations! You have qualified for the next round of "${event.title}".`
        : `Management has reviewed your submission for "${event.title}". Result: ${status}. Score: ${score}`,
      link: `/events/${event._id}`, 
      type: "result",
      emailEnabled: true,
      emailSubject: `Update: ${event.title}`
    });

    await AuditLog.create({
      action: "EVALUATE_SUBMISSION",
      performedBy: req.user._id,
      details: `Evaluated participant ${userId} in event ${eventId} (Round ${roundId}: ${status})`,
    });

    res.json({ message: "Evaluation saved", participant });
  } catch (err) {
    console.error("EvaluateSubmission error:", err);
    res.status(500).json({ message: "Error evaluating submission" });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const participants = [...event.participants].filter(
      (p) => p.score !== null && p.score !== undefined
    );

    const sorted = participants.sort((a, b) => b.score - a.score);

    let currentRank = 1;
    const leaderboard = sorted.map((p, i) => {
      if (i > 0 && sorted[i - 1].score !== p.score) {
        currentRank = i + 1;
      }
      return {
        rank: currentRank,
        name: p.name,
        email: p.email,
        teamName: p.teamName,
        score: p.score,
        feedback: p.feedback || "",
        lastUpdated: p.lastUpdated,
      };
    });

    const start = (page - 1) * limit;
    const end = start + Number(limit);
    const paginated = leaderboard.slice(start, end);

    res.json({
      eventId,
      totalParticipants: event.participants.length,
      totalRanked: leaderboard.length,
      page: Number(page),
      totalPages: Math.ceil(leaderboard.length / limit),
      leaderboard: paginated,
    });
  } catch (err) {
    console.error("GetLeaderboard error:", err);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
};

/* =====================================================
   👤 USER REGISTRATIONS
===================================================== */

export const listMyRegistrations = async (req, res) => {
  try {
    const events = await Event.find({
      "participants.userId": req.user._id,
    })
      .select("title category startDate endDate registrationDeadline participants")
      .lean();

    const myEvents = events.map((e) => {
      const participant = e.participants.find(
        (p) => String(p.userId) === String(req.user._id)
      );
      return {
        eventId: e._id,
        title: e.title,
        category: e.category,
        startDate: e.startDate,
        endDate: e.endDate,
        registrationDeadline: e.registrationDeadline,
        registeredAt: participant?.registeredAt || null,
        teamName: participant?.teamName || "—",
        submissionStatus: participant?.submissionStatus || "not_submitted",
        score: participant?.score ?? null,
        feedback: participant?.feedback || "",
      };
    });

    res.json({ registrations: myEvents });
  } catch (err) {
    console.error("listMyRegistrations error:", err);
    res.status(500).json({ message: "Error fetching my registrations" });
  }
};

/* =====================================================
   📄 SUBMISSIONS LIST (ADMIN)
===================================================== */
export const listSubmissionsForEvent = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const submissions = await Submission.find({ event: eventId })
      .populate("user", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ submissions });
  } catch (err) {
    console.error("listSubmissionsForEvent error:", err);
    res.status(500).json({ message: "Error fetching submissions" });
  }
};

/* =====================================================
   📈 ADMIN DASHBOARD
===================================================== */
export const eventAdminMetrics = async (_req, res) => {
  try {
    const total = await Event.countDocuments();
    const byCategory = await Event.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ total, byCategory });
  } catch (err) {
    console.error("eventAdminMetrics error:", err);
    res.status(500).json({ message: "Error fetching metrics" });
  }
};
/* =====================================================
   🎯 QUIZ CONTROLLER
===================================================== */

export const updateQuiz = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { questions, duration } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // 🔒 Security: Ownership check for non-admins
    const isSuperAdmin = ["admin", "superadmin"].includes(req.user.role);
    if (!isSuperAdmin && String(event.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "Access Denied: You can only modify your own events." });
    }

    // 🔒 Security: Prevent modification of quizzes for past events
    if (new Date() > new Date(event.endDate)) {
      return res.status(400).json({ message: "Completed events cannot be modified." });
    }

    event.quiz = {
      questions,
      duration: Number(duration) || 15
    };

    await event.save();
    
    await AuditLog.create({
      action: "UPDATE_QUIZ",
      performedBy: req.user._id,
      details: `Updated quiz for event "${event.title}"`,
    });

    res.json({ message: "Quiz updated successfully", quiz: event.quiz });
  } catch (err) {
    console.error("UpdateQuiz error:", err);
    res.status(500).json({ message: "Error updating quiz" });
  }
};

export const getQuiz = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Sanitize: Hide correctOption
    const sanitizedQuestions = event.quiz?.questions?.map(q => ({
      _id: q._id,
      question: q.question,
      options: q.options,
      marks: q.marks
    })) || [];

    res.json({
      duration: event.quiz?.duration || 15,
      questions: sanitizedQuestions
    });
  } catch (err) {
    console.error("GetQuiz error:", err);
    res.status(500).json({ message: "Error fetching quiz" });
  }
};

export const submitQuiz = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { answers, violationCount, terminationReason } = req.body; 

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const participant = event.participants.find(p => String(p.userId) === String(req.user._id));
    if (!participant) return res.status(403).json({ message: "User not registered for this event" });

    // Auto-grading
    let totalScore = 0;
    let maxScore = 0;
    
    event.quiz.questions.forEach(q => {
       maxScore += q.marks;
       const userAns = answers?.[q._id];
       // Check if answer matches correctOption
       if (userAns !== undefined && Number(userAns) === Number(q.correctOption)) {
          totalScore += q.marks;
       }
    });

    // Update Event Participant
    participant.score = totalScore;
    participant.submissionStatus = "submitted";
    participant.round = 1; // Completed
    participant.lastUpdated = new Date();
    
    await event.save();

    // Update Submission Record (for consistency)
    await Submission.findOneAndUpdate(
       { event: eventId, user: req.user._id },
       {
          event: eventId,
          user: req.user._id,
          teamName: participant.teamName,
          finalScore: totalScore, 
          status: "reviewed", 
          submissionLink: terminationReason ? `Terminated: ${terminationReason}` : "Quiz Auto-Submission", 
          fileUrl: "",
       },
       { upsert: true, new: true }
    );

    // Audit Log
    let logMsg = `Submitted quiz for "${event.title}". Score: ${totalScore}/${maxScore}`;
    if (violationCount > 0) logMsg += `. Violations: ${violationCount}`;
    if (terminationReason) logMsg += ` [TERMINATED: ${terminationReason}]`;

    await AuditLog.create({
      action: "SUBMIT_QUIZ",
      performedBy: req.user._id,
      details: logMsg,
    });

    await notifyUser({
      userId: req.user._id,
      email: req.user.email,
      title: "Quiz Completed",
      message: `You scored ${totalScore}/${maxScore} in "${event.title}".`,
      link: `/leaderboard`,
      type: "result",
      emailEnabled: true,
      emailSubject: `Quiz Result: ${event.title}`
    });

    res.json({ score: totalScore, maxScore, message: "Quiz submitted successfully" });
  } catch(err) {
      console.error("SubmitQuiz error:", err);
      res.status(500).json({ message: "Quiz submission failed" });
  }
};

/* =====================================================
   🎓 CERTIFICATE EMAIL
===================================================== */
export const emailCertificate = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const participant = event.participants.find(p => String(p.userId) === String(req.user._id));
    if (!participant) return res.status(403).json({ message: "User not registered for this event" });

    const certificateLink = `http://localhost:5173/events/${event._id}/certificate`;

    await notifyUser({
      userId: req.user._id,
      email: req.user.email,
      title: "Your Certificate is Ready!",
      message: `Congratulations! Your certificate for "${event.title}" is ready.`,
      link: `/events/${event._id}/certificate`,
      type: "event",
      emailEnabled: true,
      emailSubject: `Your Certificate for ${event.title}`,
      emailHtml: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 600px; margin: auto;">
           <h2 style="color: #4F46E5; margin-bottom: 5px;">Congratulations, ${req.user.name}!</h2>
           <p style="color: #475569; font-size: 16px;">Your certificate of achievement for <strong>${event.title}</strong> is now available.</p>
           <p style="color: #475569; font-size: 16px;">You can view, print, or download your certificate using the secure link below:</p>
           <div style="text-align: center; margin: 30px 0;">
             <a href="${certificateLink}" style="display: inline-block; padding: 14px 28px; background: #4F46E5; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.4);">View Certificate</a>
           </div>
           <p style="color: #94a3b8; font-size: 14px; border-top: 1px solid #e2e8f0; padding-top: 15px;">Keep building, learning, and participating on OneStop!</p>
        </div>
      `
    });

    res.json({ message: "Certificate emailed successfully!" });
  } catch(err) {
      console.error("EmailCertificate error:", err);
      res.status(500).json({ message: "Failed to send email" });
  }
};

/* =====================================================
   💻 CODING CONTROLLER
===================================================== */

export const updateCoding = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { problems, duration } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // 🔒 Security: Prevent modification of coding for past events
    if (new Date() > new Date(event.endDate)) {
      return res.status(400).json({ message: "Completed events cannot be modified." });
    }

    event.coding = {
      problems,
      duration: Number(duration) || 60
    };

    await event.save();
    
    await AuditLog.create({
      action: "UPDATE_CODING",
      performedBy: req.user._id,
      details: `Updated coding problems for event "${event.title}"`,
    });

    res.json({ message: "Coding problems updated successfully", coding: event.coding });
  } catch (err) {
    console.error("UpdateCoding error:", err);
    res.status(500).json({ message: "Error updating coding problems" });
  }
};

export const getCoding = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Sanitize: Hide hidden test cases from participants
    const sanitizedProblems = event.coding?.problems?.map(p => ({
      _id: p._id,
      title: p.title,
      description: p.description,
      constraints: p.constraints,
      inputFormat: p.inputFormat,
      outputFormat: p.outputFormat,
      starterCode: p.starterCode,
      language: p.language,
      difficulty: p.difficulty,
      testCases: p.testCases?.filter(tc => tc.isVisible) || [] 
    })) || [];

    res.json({
      duration: event.coding?.duration || 60,
      problems: sanitizedProblems
    });
  } catch (err) {
    console.error("GetCoding error:", err);
    res.status(500).json({ message: "Error fetching coding problems" });
  }
};

export const submitCoding = async (req, res) => {
  try {
     const { id: eventId } = req.params;
     const { problemId, code, language, results } = req.body;

     const event = await Event.findById(eventId);
     if (!event) return res.status(404).json({ message: "Event not found" });

     const participant = event.participants.find(p => String(p.userId) === String(req.user._id));
     if (!participant) return res.status(403).json({ message: "User not registered for this event" });

     // Store submission data in round status
     const currentRound = participant.currentRound || 1;
     let rStatus = participant.roundStatus.find(rs => rs.roundId === currentRound);
     
     if (!rStatus) {
        rStatus = { roundId: currentRound, status: "pending", score: 0, feedback: "", submissionData: {} };
        participant.roundStatus.push(rStatus);
     }

     if (!rStatus.submissionData) rStatus.submissionData = {};
     if (!rStatus.submissionData.codingSubmissions) rStatus.submissionData.codingSubmissions = [];
     
     rStatus.submissionData.codingSubmissions.push({
        problemId,
        code,
        language,
        results,
        submittedAt: new Date()
     });
     
     // Auto-calculate score if results are provided (from frontend evaluation)
     if (results && results.totalMarks) {
        rStatus.score = (rStatus.score || 0) + results.totalMarks;
     }

     participant.submissionStatus = "submitted";
     participant.lastUpdated = new Date();
     await event.save();

     await AuditLog.create({
       action: "SUBMIT_CODING",
       performedBy: req.user._id,
       details: `Submitted solution for problem ${problemId} in event ${eventId}`,
     });

     res.json({ message: "Solution submitted successfully" });
  } catch (err) {
    console.error("SubmitCoding error:", err);
    res.status(500).json({ message: "Error submitting coding solution" });
  }
};

