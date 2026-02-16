import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { sendEmail } from "../utils/sendEmail.js";
import { notifyUser } from "../utils/notifyUser.js";

const router = express.Router();

/* =====================================================
   👑 Admin — Get PENDING Recruiters only
   - Return a plain array (frontend expects that)
===================================================== */
router.get(
  "/recruiters",
  protect,
  authorize(["admin", "superadmin"]),
  async (_req, res) => {
    try {
      const recruiters = await User.find({
        role: "recruiter",
        status: "pending", // only show applications that need action
      })
        .select("name email mobile orgName status createdAt companyWebsite designation socialLinks identityVerification")
        .sort({ createdAt: -1 });

      res.json(recruiters);
    } catch (err) {
      console.error("Error fetching recruiters:", err);
      res.status(500).json({ message: "Server error fetching recruiters" });
    }
  }
);

/* =====================================================
   ✅ Approve Recruiter
===================================================== */
router.patch(
  "/recruiters/:id/approve",
  protect,
  authorize(["admin", "superadmin"]),
  async (req, res) => {
    try {
      const recruiter = await User.findById(req.params.id);
      if (!recruiter) return res.status(404).json({ message: "Recruiter not found" });

      recruiter.status = "approved";
      recruiter.allowedRoles = Array.from(new Set([...(recruiter.allowedRoles || []), "recruiter"]));
      await recruiter.save();

      await AuditLog.create({
        action: "APPROVE_RECRUITER",
        performedBy: req.user._id,
        targetUser: recruiter._id,
        details: `Recruiter (${recruiter.email}) approved by admin`,
      });

      // ✉️ Email
      await sendEmail(
        recruiter.email,
        "Recruiter Approved - OneStop Hub",
        `Hello ${recruiter.name},

Your recruiter account has been approved! 🎉
You can now access the Recruiter Dashboard.

— Team OneStop Hub`
      );

      // 🔔 In-app notification
      await notifyUser({
        userId: recruiter._id,
        title: "Recruiter Account Approved 🎉",
        message: "Your recruiter account has been approved by admin. You can now post jobs.",
        type: "recruiter",
      });

      res.json({ message: "Recruiter approved successfully ✅", status: "approved" });
    } catch (err) {
      console.error("Approve recruiter error:", err);
      res.status(500).json({ message: "Error approving recruiter" });
    }
  }
);

/* =====================================================
   ❌ Reject Recruiter
===================================================== */
router.patch(
  "/recruiters/:id/reject",
  protect,
  authorize(["admin", "superadmin"]),
  async (req, res) => {
    try {
      const recruiter = await User.findById(req.params.id);
      if (!recruiter) return res.status(404).json({ message: "Recruiter not found" });

      recruiter.status = "rejected";
      await recruiter.save();

      await AuditLog.create({
        action: "REJECT_RECRUITER",
        performedBy: req.user._id,
        targetUser: recruiter._id,
        details: `Recruiter (${recruiter.email}) rejected by admin`,
      });

      // ✉️ Email
      await sendEmail(
        recruiter.email,
        "Recruiter Application Rejected - OneStop Hub",
        `Hello ${recruiter.name},

Unfortunately, your recruiter application has been rejected.
For more details, contact support.

— Team OneStop Hub`
      );

      // 🔔 In-app notification
      await notifyUser({
        userId: recruiter._id,
        title: "Recruiter Application Rejected",
        message: "Your recruiter request was rejected by admin. Please contact support for assistance.",
        type: "recruiter",
      });

      res.json({ message: "Recruiter rejected successfully ❌", status: "rejected" });
    } catch (err) {
      console.error("Reject recruiter error:", err);
      res.status(500).json({ message: "Error rejecting recruiter" });
    }
  }
);

/* Aadhaar verification route removed */

export default router;
