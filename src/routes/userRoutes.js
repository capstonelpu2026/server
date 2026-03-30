// src/routes/userRoutes.js
import express from "express";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import bcrypt from "bcryptjs";
import { sendEmail } from "../utils/sendEmail.js";
import AuditLog from "../models/AuditLog.js";
import multer from "multer";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";

import uploadCloud from "../middleware/upload.js";

const router = express.Router();
const uploadLocal = multer({ dest: "uploads/" }); // Renamed to avoid usage conflict if any, though existing avatar route uses 'upload' variable. I'll keep 'upload' as is or just rename for safety.
// Keeping existing upload as 'upload' to not break existing code, but I'll add uploadCloud.
const upload = multer({ dest: "uploads/" });

/* =====================================================
   🧠 Utility: Generate a strong random password
===================================================== */
function generateStrongPassword(length = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/* =====================================================
   🧾 SELF PROFILE ROUTES (For All Authenticated Users)
===================================================== */

// ✅ Get current user details
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Fetch profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Update own profile info
router.put("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.mobile = req.body.mobile || user.mobile;
    if (req.body.mentorProfile) user.mentorProfile = req.body.mentorProfile;
    if (req.body.skills) user.skills = req.body.skills;
    if (req.body.openToTeaming !== undefined) user.openToTeaming = req.body.openToTeaming;

    // ✨ New: Bio & Socials
    if (req.body.bio !== undefined) user.bio = req.body.bio;
    if (req.body.socials) user.socials = req.body.socials;

    // Unstop Profile Fields
    if (req.body.education) user.education = req.body.education;
    if (req.body.workExperience) user.workExperience = req.body.workExperience;
    if (req.body.projects) user.projects = req.body.projects;
    if (req.body.certifications) user.certifications = req.body.certifications;

    const updated = await user.save();
    res.json(updated);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: "Error updating profile" });
  }
});

// ✅ Change password (Self)
router.put("/me/password", protect, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match)
      return res.status(401).json({ message: "Old password incorrect" });

    user.password = newPassword;
    await user.save();

    await AuditLog.create({
      action: "USER_CHANGE_PASSWORD",
      performedBy: req.user._id,
      targetUser: req.user._id,
      details: `${user.email} changed their password.`,
    });

    res.json({ message: "Password updated ✅" });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ message: "Error updating password" });
  }
});

// ✅ Upload avatar
router.put("/me/avatar", protect, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "avatars",
      public_id: `user_${req.user._id}`,
      overwrite: true,
      resource_type: "image",
    });

    req.user.avatar = result.secure_url;
    await req.user.save();
    fs.unlinkSync(req.file.path);

    res.json(req.user);
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ message: "Error uploading avatar" });
  }
});

// ✅ General Document Upload (Resume, Certificates)
router.post("/upload-doc", protect, uploadCloud.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    // Multer-storage-cloudinary already handled the upload
    res.json({ 
      message: "File uploaded successfully",
      url: req.file.path || req.file.secure_url,
      originalName: req.file.originalname
    });
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ message: "Error uploading document" });
  }
});

// ✅ Daily Attendance Check-in
router.post("/me/check-in", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastVisit = user.lastVisitDate ? new Date(user.lastVisitDate.getFullYear(), user.lastVisitDate.getMonth(), user.lastVisitDate.getDate()) : null;

    if (lastVisit && lastVisit.getTime() === today.getTime()) {
      return res.json({ success: true, message: "Already checked in today!", user });
    }

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (lastVisit && lastVisit.getTime() === yesterday.getTime()) {
      user.attendanceStreak += 1;
    } else {
      user.attendanceStreak = 1;
    }

    if (user.attendanceStreak > user.maxAttendanceStreak) {
      user.maxAttendanceStreak = user.attendanceStreak;
    }

    // Reward Logic: 10 XP per day of streak, capped at 100
    const reward = Math.min(user.attendanceStreak * 10, 100);
    user.points += reward;
    user.attendancePoints += reward;
    user.lastVisitDate = now;

    await user.save();
    
    await AuditLog.create({
      action: "DAILY_CHECKIN",
      performedBy: user._id,
      details: `Checked in! Streak: ${user.attendanceStreak} (Reward: +${reward} XP)`
    });

    res.json({ success: true, message: `Check-in successful! +${reward} XP`, user });
  } catch (err) {
    res.status(500).json({ message: "Check-in failed" });
  }
});
router.post("/me/reminders", protect, async (req, res) => {
  try {
    const { contestId, platform, title, startTime, action } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (action === "add") {
      const exists = user.contestReminders.find(r => r.contestId === contestId);
      if (!exists) {
        user.contestReminders.push({ contestId, platform, title, startTime });
      }
    } else {
      user.contestReminders = user.contestReminders.filter(r => r.contestId !== contestId);
    }

    await user.save();
    res.json({ success: true, reminders: user.contestReminders });
  } catch (err) {
    res.status(500).json({ message: "Error updating reminders" });
  }
});

/* =====================================================
   👑 USER MANAGEMENT (Admin + SuperAdmin)
===================================================== */

// ✅ Get User Directory (For Chat/Search - Accessible to all Auth Users)
router.get("/directory", protect, async (req, res) => {
  try {
    const { search = "" } = req.query;
    const query = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};
    
    // Return limited fields for security
    const users = await User.find(query)
      .select("name avatar role email points attendanceStreak")
      .sort({ points: -1 })
      .limit(50);
      
    res.json(users);
  } catch (err) {
    console.error("Fetch directory error:", err);
    res.status(500).json({ message: "Error fetching user directory" });
  }
});

// ✅ Get Specific Public User Details (For Chat Initialization)
router.get("/public/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("name avatar role mobile email");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching user details" });
  }
});

// ✅ Get Global Leaderboard
router.get("/leaderboard", protect, async (req, res) => {
  try {
    const users = await User.find({})
      .select("name avatar points role attendanceStreak")
      .sort({ points: -1 })
      .limit(50);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
});

// ✅ Get all users
router.get("/", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const { search = "" } = req.query;
    const query = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};
    const users = await User.find(query).select("-password").limit(100);
    res.json(users);
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
});

// ✅ Create Admin (SuperAdmin)
router.post("/create-admin", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const { name, email, password, mobile } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: "Email already exists" });

    const newAdmin = await User.create({
      name,
      email,
      password,
      mobile,
      role: "superadmin",
    });

    await AuditLog.create({
      action: "CREATE_ADMIN",
      performedBy: req.user._id,
      targetUser: newAdmin._id,
      details: `${req.user.role} created admin: ${newAdmin.email}`,
    });

    await sendEmail(
      newAdmin.email,
      "🎓 OneStop Admin Account",
      `Hello ${newAdmin.name},\n\nYour admin account has been created.\n\nEmail: ${newAdmin.email}\nPassword: ${password}\n\n— OneStop Team`
    );

    res.status(201).json({ message: "Admin created ✅", newAdmin });
  } catch (err) {
    console.error("Create admin error:", err);
    res.status(500).json({ message: "Error creating admin" });
  }
});

// ✅ Change user role (SuperAdmin only)
router.put("/:id/role", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const oldRole = user.role;
    user.role = role;
    await user.save();

    await AuditLog.create({
      action: "CHANGE_ROLE",
      performedBy: req.user._id,
      targetUser: user._id,
      details: `Role changed ${oldRole} → ${role}`,
    });

    res.json({ message: "Role updated ✅" });
  } catch (err) {
    console.error("Change role error:", err);
    res.status(500).json({ message: "Error updating role" });
  }
});

// ✅ Manually Verify User (SuperAdmin/Admin)
router.put("/:id/verify", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const { status, isElite } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (status) user.verificationStatus = status;
    if (isElite !== undefined) user.isElite = isElite;
    
    await user.save();

    await AuditLog.create({
      action: "VERIFY_USER",
      performedBy: req.user._id,
      targetUser: user._id,
      details: `Verification: ${status}, Elite: ${isElite}`,
    });

    res.json({ success: true, message: "User verification updated ✅", user });
  } catch (err) {
    res.status(500).json({ message: "Error verifying user" });
  }
});

/* =====================================================
   🧑‍🏫 MENTOR MANAGEMENT (Admin + SuperAdmin)
===================================================== */

// ✅ Get pending mentors
router.get("/mentors/pending", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const mentors = await User.find({
      mentorRequested: true,
      mentorApproved: false,
    }).select("-password");
    res.json(mentors);
  } catch (err) {
    console.error("Fetch pending mentors error:", err);
    res.status(500).json({ message: "Error fetching pending mentors" });
  }
});

// ✅ Approve mentor
router.put("/mentors/:id/approve", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const mentor = await User.findById(req.params.id);
    if (!mentor) return res.status(404).json({ message: "Mentor not found" });

    mentor.mentorApproved = true;
    mentor.mentorRequested = false;
    mentor.role = "mentor";
    await mentor.save();

    await AuditLog.create({
      action: "APPROVE_MENTOR",
      performedBy: req.user._id,
      targetUser: mentor._id,
      details: `${req.user.role} approved mentor: ${mentor.email}`,
    });

    await sendEmail(
      mentor.email,
      "✅ Mentor Approved - OneStop Hub",
      `Hi ${mentor.name},\n\nYour mentor profile has been approved by ${req.user.role}.`
    );

    res.json({ message: "Mentor approved successfully ✅" });
  } catch (err) {
    console.error("Approve mentor error:", err);
    res.status(500).json({ message: "Error approving mentor" });
  }
});

// ✅ Reject mentor
router.put("/mentors/:id/reject", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const mentor = await User.findById(req.params.id);
    if (!mentor) return res.status(404).json({ message: "Mentor not found" });

    mentor.mentorRequested = false;
    mentor.mentorProfile = {};
    await mentor.save();

    await AuditLog.create({
      action: "REJECT_MENTOR",
      performedBy: req.user._id,
      targetUser: mentor._id,
      details: `Rejected mentor: ${mentor.email}`,
    });

    res.json({ message: "Mentor application rejected ❌" });
  } catch (err) {
    console.error("Reject mentor error:", err);
    res.status(500).json({ message: "Error rejecting mentor" });
  }
});

/* =====================================================
   🗝️ SUPERADMIN PASSWORD RESET
===================================================== */
router.put("/:id/reset-password", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const newPassword = generateStrongPassword(12);
    user.password = newPassword;
    await user.save();

    await sendEmail(
      user.email,
      "🔐 Your Password Has Been Reset - OneStop Hub",
      `
Hello ${user.name || "User"},

Your password has been reset by the SuperAdmin.

Here are your temporary credentials:
📧 Email: ${user.email}
🔑 Temporary Password: ${newPassword}

Please log in and change it immediately.

— OneStop Hub Security Team
`
    );

    await AuditLog.create({
      action: "ADMIN_RESET_PASSWORD",
      performedBy: req.user._id,
      targetUser: user._id,
      details: `SuperAdmin reset password for ${user.email}`,
    });

    res.json({ message: "Temporary password generated and emailed ✅" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Error resetting password" });
  }
});

/* =====================================================
   🗑️ Delete User (SuperAdmin Only)
===================================================== */
router.delete("/:id", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await user.deleteOne();

    await AuditLog.create({
      action: "DELETE_USER",
      performedBy: req.user._id,
      targetUser: user._id,
      details: `SuperAdmin deleted user: ${user.email}`,
    });

    res.json({ message: "User deleted ❌" });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ message: "Error deleting user" });
  }
});

/* =====================================================
   📜 AUDIT LOGS (Admin + SuperAdmin)
===================================================== */
router.get("/audit", protect, authorize(["admin", "superadmin"]), async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .populate("performedBy", "name email role")
      .populate("targetUser", "name email role")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ logs });
  } catch (err) {
    console.error("Fetch audit logs error:", err);
    res.status(500).json({ message: "Error fetching audit logs" });
  }
});

export default router;
