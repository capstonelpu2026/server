import express from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import OTP from "../models/OTP.js";
import AuditLog from "../models/AuditLog.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import { sendEmail } from "../utils/sendEmail.js";
import { CLIENT_URL } from "../config/env.js";
import multer from "multer";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";

const upload = multer({ dest: "uploads/" });

const router = express.Router();

/* =====================================================
 🔑 JWT Generator
===================================================== */
const generateToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

/* =====================================================
 🚫 Rate Limiters
===================================================== */
const otpLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 1,
  message: { message: "Please wait 30 seconds before requesting another OTP." },
  keyGenerator: (req) => req.body?.email || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  validate: { ip: false },
});

/* =====================================================
 🧑‍🎓 REGISTER - Candidate
===================================================== */
router.post("/register-candidate", async (req, res) => {
  try {
    const { name, email, password, mobile } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ message: "User already exists" });

    const verifiedOtp = await OTP.findOne({
      email: normalizedEmail,
      purpose: "email-verification",
      verified: true,
    });

    if (!verifiedOtp)
      return res.status(400).json({ message: "Please verify your email before registering." });

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      mobile,
      role: "candidate",
      allowedRoles: ["candidate"],
    });

    await OTP.deleteMany({ email: normalizedEmail, purpose: "email-verification" });
    
    await AuditLog.create({
      action: "USER_REGISTERED",
      targetUser: user._id,
      performedBy: user._id,
      details: `New candidate joined the platform (${user.email})`,
    });

    res.status(201).json({
      message: "Candidate registered successfully ✅",
      token: generateToken(user._id, user.role),
    });
  } catch (err) {
    console.error("Register candidate error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
 🧳 REGISTER - Recruiter (Admin Approval Required)
===================================================== */
const registerRecruiterHandler = async (req, res) => {
  try {
    const { 
       name, orgName, email, password, mobile,
       companyWebsite, designation, linkedinProfile,
       pan, gst
    } = req.body;
    
    const normalizedEmail = (email || "").toLowerCase();

    if (!name || !orgName || !normalizedEmail || !password || !mobile) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ message: "User with this email already exists" });

    const verifiedOtp = await OTP.findOne({
      email: normalizedEmail,
      purpose: "email-verification",
      verified: true,
    });

    if (!verifiedOtp)
      return res.status(400).json({ message: "Please verify your email before registering." });

    const recruiter = await User.create({
      name,
      orgName: orgName || "Independent Recruiter",
      email: normalizedEmail,
      password,
      mobile,
      role: "recruiter",
      status: "pending",
      allowedRoles: ["recruiter"],
      
      // Extended Info
      companyWebsite: companyWebsite || "",
      designation: designation || "Recruiter",
      socialLinks: {
          linkedin: linkedinProfile || ""
      },
      
      // ⭐ NEW: Identity Verification
      identityVerification: {
        pan: pan || "",
        gst: gst || "",
        verified: false
      }
    });

    await OTP.deleteMany({ email: normalizedEmail, purpose: "email-verification" });

    await AuditLog.create({
      action: "REGISTER_RECRUITER",
      targetUser: recruiter._id,
      performedBy: recruiter._id,
      details: `Recruiter signup submitted for approval (${recruiter.email})`,
    });

    const emailResult = await sendEmail(
      recruiter.email,
      "Recruiter Registration Received — OneStop Hub",
      `Hello ${recruiter.name},

Thanks for registering as a recruiter for ${orgName}.
Your application is received and is currently under review.

You'll be notified once an admin approves your access.

— OneStop Hub Team`
    );

    if (!emailResult.success) {
      console.warn(`⚠️ Recruiter registration email failed: ${emailResult.error}`);
    }

    res.status(201).json({
      message: "Recruiter registered successfully. Await admin approval ✅",
      recruiterId: recruiter._id,
    });
  } catch (err) {
    console.error("Register recruiter error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

router.post("/register-recruiter", registerRecruiterHandler);
router.post("/register-admin", registerRecruiterHandler);

/* Identity verification routes removed */

/* =====================================================
 👑 CREATE ADMIN (SuperAdmin Only)
===================================================== */
router.post("/create-admin", protect, authorize(["superadmin"]), async (req, res) => {
  try {
    const { name, email, password, mobile } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ message: "Admin already exists" });

    const admin = await User.create({
      name,
      email: normalizedEmail,
      password,
      mobile,
      role: "admin",
      allowedRoles: ["admin"],
    });

    await AuditLog.create({
      action: "CREATE_ADMIN",
      targetUser: admin._id,
      performedBy: req.user._id,
      details: `SuperAdmin created Admin (${admin.email})`,
    });

    const emailResult = await sendEmail(
      admin.email,
      "Admin Account Created - OneStop Hub",
      `Hello ${admin.name},

You have been added as an Admin.
Password: ${password}

— OneStop Hub Team`
    );

    if (!emailResult.success) {
      return res.status(500).json({ message: `Admin created, but email failed: ${emailResult.error}` });
    }

    res.status(201).json({ message: "Admin created successfully ✅" });
  } catch (err) {
    console.error("Create admin error:", err);
    res.status(500).json({ message: "Error creating admin" });
  }
});

/* =====================================================
 🔐 LOGIN — UPDATED, CLEANED, FIXED
===================================================== */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ❌ selectedRole removed
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    // password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // Recruiter approval check
    if (user.role === "recruiter") {
      const status = (user.status || "").toLowerCase();

      if (status !== "approved") {
        return res.status(403).json({
          message:
            status === "rejected"
              ? "Your recruiter application was rejected."
              : "Your recruiter application is still awaiting admin approval.",
          status: user.status || "pending",
        });
      }
    }

    // Create JWT with DB role
    const token = generateToken(user._id, user.role);

    await AuditLog.create({
      action: "LOGIN",
      performedBy: user._id,
      targetUser: user._id,
      details: `User logged in as ${user.role} (${user.email})`,
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
      message: `Welcome back, ${user.name} 👋`,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
 👤 ME (Authenticated User)
===================================================== */
router.get("/me", protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select("-password");
    res.json(me);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
 🔁 PASSWORD RESET — OTP
===================================================== */
router.post("/send-otp", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.create({
      email: normalizedEmail,
      otp,
      purpose: "password-reset",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const emailResult = await sendEmail(
      user.email,
      "OneStop Password Reset",
      `Your password reset OTP is ${otp}\nValid for 5 minutes.`
    );

    if (!emailResult.success) {
      return res.status(500).json({ message: `Failed to send OTP email: ${emailResult.error}` });
    }

    res.json({ message: "OTP sent to your email ✅" });
  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const record = await OTP.findOne({
      email: normalizedEmail,
      otp,
      purpose: "password-reset",
    });

    if (!record || record.expiresAt < new Date())
      return res.status(400).json({ message: "Invalid or expired OTP" });

    await OTP.deleteMany({ email: normalizedEmail, purpose: "password-reset" });
    res.json({ success: true, message: "OTP verified ✅" });
  } catch {
    res.status(500).json({ message: "Error verifying OTP" });
  }
});

router.put("/reset-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = password;
    await user.save();

    await OTP.deleteMany({ email: normalizedEmail, purpose: "password-reset" });

    res.json({ message: "Password reset successfully ✅" });
  } catch {
    res.status(500).json({ message: "Error resetting password" });
  }
});

/* =====================================================
 📧 EMAIL VERIFICATION
===================================================== */
router.post("/send-verification-otp", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(400).json({ 
        message: `Account already exists as a ${exists.role}. Please login or use a different email.`,
        isExisting: true,
        role: exists.role
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.create({
      email: normalizedEmail,
      otp,
      purpose: "email-verification",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      verified: false,
    });

    const emailResult = await sendEmail(
      normalizedEmail,
      "Verify Your Email - OneStop Hub",
      `Your verification code is: ${otp}\nValid for 5 minutes.`
    );

    if (!emailResult.success) {
      await OTP.deleteOne({ _id: (await OTP.findOne({ email: normalizedEmail, otp }))._id });
      return res.status(500).json({ message: `Email failed: ${emailResult.error}` });
    }

    res.json({ message: "Verification OTP sent ✅" });
  } catch {
    res.status(500).json({ message: "Error sending verification OTP" });
  }
});

router.post("/verify-verification-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || "").toLowerCase();

    const record = await OTP.findOne({
      email: normalizedEmail,
      otp,
      purpose: "email-verification",
    });

    if (!record || record.expiresAt < new Date())
      return res.status(400).json({ message: "Invalid or expired OTP" });

    record.verified = true;
    await record.save();

    res.json({ success: true, message: "Email verified successfully ✅" });
  } catch {
    res.status(500).json({ message: "Error verifying email" });
  }
});

/* =====================================================
 🌐 OAUTH (Google & GitHub)
===================================================== */
function redirectWithToken(res, user) {
  const token = generateToken(user._id, user.role);
  const redirectUrl = `${CLIENT_URL}/oauth-success?token=${token}`;
  return res.redirect(redirectUrl);
}

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"], session: false, state: true }));

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${CLIENT_URL}/login?error=google_oauth_failed`,
  }),
  async (req, res) => {
    await AuditLog.create({
      action: "OAUTH_LOGIN",
      targetUser: req.user._id,
      performedBy: req.user._id,
      details: `User logged in via Google (${req.user.email})`,
    });
    redirectWithToken(res, req.user);
  }
);

router.get("/github", passport.authenticate("github", { scope: ["user:email"], session: false }));

router.get(
  "/github/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: `${CLIENT_URL}/login?error=github_oauth_failed`,
  }),
  async (req, res) => {
    await AuditLog.create({
      action: "OAUTH_LOGIN",
      targetUser: req.user._id,
      performedBy: req.user._id,
      details: `User logged in via GitHub (${req.user.email})`,
    });
    redirectWithToken(res, req.user);
  }
);

export default router;
