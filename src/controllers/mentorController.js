import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { notifyUser } from "../utils/notifyUser.js";

/* =====================================================
   🧠 CANDIDATE → APPLY FOR MENTOR
===================================================== */
export const applyForMentor = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role !== "candidate")
      return res.status(403).json({ message: "Only candidates can apply" });
    if (user.mentorApproved)
      return res.status(400).json({ message: "Already approved as mentor" });
    if (user.mentorRequested)
      return res.status(400).json({ message: "You have already applied" });

    const { expertise, experience, bio, company, documents, socials } = req.body;

    user.mentorProfile.expertise = expertise;
    user.mentorProfile.experience = experience;
    user.mentorProfile.bio = bio;
    user.mentorProfile.company = company;
    if (documents) user.mentorProfile.documents = documents;
    if (socials) user.mentorProfile.socials = socials;
    
    user.mentorRequested = true;

    await user.save({ validateBeforeSave: true });

    // 🧾 Log mentor application
    await AuditLog.create({
      action: "MENTOR_APPLY",
      performedBy: user._id,
      targetUser: user._id,
      targetUserSnapshot: { name: user.name, email: user.email, role: user.role },
      details: `Candidate ${user.email} applied to become a mentor.`,
    });

    res.status(200).json({
      message: "Mentor application submitted ✅",
      user: {
        mentorRequested: user.mentorRequested,
        mentorApproved: user.mentorApproved,
        mentorProfile: user.mentorProfile,
      },
    });
  } catch (err) {
    console.error("applyForMentor error:", err);
    res.status(500).json({ message: "Server error while applying for mentor" });
  }
};

/* =====================================================
   📊 CHECK MENTOR STATUS
===================================================== */
export const getMentorStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "role mentorApproved mentorRequested mentorProfile"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("getMentorStatus error:", err);
    res.status(500).json({ message: "Server error fetching mentor status" });
  }
};

/* =====================================================
   👨‍🏫 GET MENTOR PROFILE
===================================================== */
export const getMentorProfile = async (req, res) => {
  try {
    const mentor = await User.findById(req.user._id).select(
      "-password -resetPasswordToken -resetPasswordExpire"
    );
    if (!mentor) return res.status(404).json({ message: "Mentor not found" });
    res.json(mentor);
  } catch (err) {
    console.error("getMentorProfile error:", err);
    res.status(500).json({ message: "Server error fetching mentor profile" });
  }
};

/* =====================================================
   ✏️ UPDATE MENTOR PROFILE
===================================================== */
export const updateMentorProfile = async (req, res) => {
  try {
    const { expertise, experience, bio } = req.body;
    const mentor = await User.findById(req.user._id);
    if (!mentor) return res.status(404).json({ message: "Mentor not found" });

    mentor.mentorProfile = { expertise, experience, bio };
    await mentor.save();

    // 🧾 Log profile update
    await AuditLog.create({
      action: "MENTOR_PROFILE_UPDATE",
      performedBy: mentor._id,
      targetUser: mentor._id,
      targetUserSnapshot: {
        name: mentor.name,
        email: mentor.email,
        role: mentor.role,
      },
      details: `Mentor ${mentor.email} updated their profile.`,
    });

    res.json({
      message: "Mentor profile updated ✅",
      mentorProfile: mentor.mentorProfile,
    });
  } catch (err) {
    console.error("updateMentorProfile error:", err);
    res.status(500).json({ message: "Error updating mentor profile" });
  }
};

/* =====================================================
   🎓 GET MENTEES ASSIGNED TO A MENTOR
   Now dynamically fetches from Sessions instead of static User.mentees array
===================================================== */
export const getMentees = async (req, res) => {
  try {
    const Session = (await import("../models/Session.js")).default;
    
    // Find all sessions where this user is the mentor (confirmed or completed)
    const sessions = await Session.find({
      mentor: req.user._id,
      status: { $in: ["confirmed", "completed", "pending"] }
    }).populate("mentee", "name email avatar mobile role");

    // Extract unique mentees
    const menteeMap = new Map();
    sessions.forEach(session => {
      if (session.mentee && !menteeMap.has(session.mentee._id.toString())) {
        menteeMap.set(session.mentee._id.toString(), session.mentee);
      }
    });

    const mentees = Array.from(menteeMap.values());

    res.json({ mentees });
  } catch (err) {
    console.error("getMentees error:", err);
    res.status(500).json({ message: "Error fetching mentees" });
  }
};

/* =====================================================
   💬 MENTOR → GIVE FEEDBACK TO MENTEE
===================================================== */
export const giveFeedback = async (req, res) => {
  try {
    const { feedback } = req.body;
    const { studentId } = req.params;
    const Session = (await import("../models/Session.js")).default;

    const mentor = await User.findById(req.user._id);
    const mentee = await User.findById(studentId);

    if (!mentor || !mentee)
      return res.status(404).json({ message: "User not found" });

    // Verify relationship via sessions (Dynamic check)
    const activeRelationship = await Session.findOne({
      mentor: mentor._id,
      mentee: mentee._id,
      status: { $in: ["confirmed", "completed"] }
    });

    if (!activeRelationship) {
      return res.status(403).json({ message: "Not authorized to give feedback to this student yet. Ensure a session is confirmed or completed." });
    }

    // 🧾 Log mentor feedback
    await AuditLog.create({
      action: "MENTOR_FEEDBACK",
      performedBy: mentor._id,
      targetUser: mentee._id,
      targetUserSnapshot: {
        name: mentee.name,
        email: mentee.email,
        role: mentee.role,
      },
      details: `Mentor ${mentor.email} gave feedback to ${mentee.email}: "${feedback}"`,
    });

    // 📢 Notify Mentee
    await notifyUser({
      userId: mentee._id,
      email: mentee.email,
      title: "New Performance Review",
      message: `Your mentor, ${mentor.name}, has shared a performance review with you.`,
      link: "/profile", // Or a specific reviews page if available
      type: "mentorship",
      emailEnabled: true,
      emailSubject: "New Feedback from your Mentor - OneStop",
      emailHtml: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #2563EB;">New Performance Review</h2>
          <p>Hi ${mentee.name},</p>
          <p>Your mentor <strong>${mentor.name}</strong> has just submitted a performance review for you.</p>
          <div style="background: #f8fafc; padding: 20px; border-left: 4px solid #2563EB; margin: 20px 0; font-style: italic; color: #334155;">
            "${feedback}"
          </div>
          <p>Keep up the great work!</p>
          <a href="http://localhost:5173/profile" style="display: inline-block; padding: 12px 24px; background: #2563EB; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">View Profile</a>
        </div>
      `
    });

    res.json({ message: "Feedback recorded successfully ✅" });
  } catch (err) {
    console.error("giveFeedback error:", err);
    res.status(500).json({ message: "Error adding feedback" });
  }
};

/* =====================================================
   🧩 ADMIN — MENTOR APPROVAL MANAGEMENT
===================================================== */
export const getMentorRequests = async (_req, res) => {
  try {
    const requests = await User.find({
      mentorRequested: true,
      mentorApproved: false,
      role: "candidate",
    }).select("name email mentorProfile createdAt");

    res.json({ requests });
  } catch (err) {
    console.error("getMentorRequests error:", err);
    res.status(500).json({ message: "Server error fetching mentor requests" });
  }
};

/* =====================================================
   ✅ APPROVE MENTOR
===================================================== */
export const approveMentor = async (req, res) => {
  try {
    const admin = req.user;
    const mentor = await User.findById(req.params.id);
    if (!mentor) return res.status(404).json({ message: "User not found" });

    mentor.set({
      mentorApproved: true,
      mentorRequested: false,
      role: "mentor",
    });

    if (!mentor.allowedRoles.includes("mentor")) {
      mentor.allowedRoles.push("mentor");
    }

    // ✨ Initialize Default Services if empty
    if (!mentor.mentorProfile.services || mentor.mentorProfile.services.length === 0) {
      mentor.mentorProfile.services = [
        {
          title: "1:1 Strategy Call",
          type: "1:1 Call",
          price: 500,
          duration: 30,
          description: "A deep dive into your career goals, technical challenges, or project reviews.",
          isActive: true
        }
      ];
    }

    await mentor.save();

    // 🧾 Audit Log (with snapshots)
    try {
      await AuditLog.create({
        action: "MENTOR_APPROVED",
        performedBy: admin._id,
        targetUser: mentor._id,
        targetUserSnapshot: {
          name: mentor.name,
          email: mentor.email,
          role: mentor.role,
        },
        details: `Admin ${admin.name} (${admin.email}) approved mentor application for ${mentor.name} (${mentor.email}).`,
      });
    } catch (logErr) {
      console.error("AuditLog (approveMentor) failed:", logErr.message);
    }

    res.json({ message: "Mentor approved successfully ✅" });
  } catch (err) {
    console.error("approveMentor error:", err);
    res.status(500).json({ message: "Error approving mentor" });
  }
};

/* =====================================================
   ❌ REJECT MENTOR
===================================================== */
export const rejectMentor = async (req, res) => {
  try {
    const admin = req.user;
    const mentor = await User.findById(req.params.id);
    if (!mentor) return res.status(404).json({ message: "User not found" });

    mentor.set({
      mentorRequested: false,
      mentorProfile: { expertise: "", experience: 0, bio: "" },
    });

    await mentor.save();

    // 🧾 Audit Log (with details)
    try {
      await AuditLog.create({
        action: "MENTOR_REJECTED",
        performedBy: admin._id,
        targetUser: mentor._id,
        targetUserSnapshot: {
          name: mentor.name,
          email: mentor.email,
          role: mentor.role,
        },
        details: `Admin ${admin.name} (${admin.email}) rejected mentor application for ${mentor.name} (${mentor.email}).`,
      });
    } catch (logErr) {
      console.error("AuditLog (rejectMentor) failed:", logErr.message);
    }

    res.json({ message: "Mentor application rejected ❌" });
  } catch (err) {
    console.error("rejectMentor error:", err);
    res.status(500).json({ message: "Error rejecting mentor" });
  }
};
