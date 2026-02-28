import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";

/* =====================================================
   👥 GET ALL USERS (Admin + SuperAdmin)
===================================================== */
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
};

/* =====================================================
   ❌ DELETE USER (Admin + SuperAdmin)
===================================================== */
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Prevent deleting superadmin itself
    if (user.role === "superadmin") {
      return res.status(403).json({ message: "Cannot delete a SuperAdmin account" });
    }

    await AuditLog.create({
      action: "DELETE_USER",
      performedBy: req.user._id,
      targetUser: user._id,
      targetUserSnapshot: { name: user.name, email: user.email, role: user.role },
      details: `${req.user.role} deleted user: ${user.email}`,
    });

    await user.deleteOne();
    res.json({ message: "User deleted successfully ❌" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ message: "Error deleting user" });
  }
};

/* =====================================================
   🔄 UPDATE USER ROLE (Admin + SuperAdmin)
===================================================== */
export const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;

    const validRoles = ["candidate", "mentor", "admin", "superadmin", "guest"];
    if (!validRoles.includes(role.toLowerCase())) {
      return res.status(400).json({ message: "Invalid role selected" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldRole = user.role;
    user.role = role.toLowerCase();
    await user.save();

    await AuditLog.create({
      action: "UPDATE_ROLE",
      performedBy: req.user._id,
      targetUser: user._id,
      targetUserSnapshot: { name: user.name, email: user.email },
      details: `Role changed from ${oldRole} → ${role}`,
    });

    res.json({
      message: `User role updated successfully to ${role} ✅`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Error updating role:", err);
    res.status(500).json({ message: "Error updating user role" });
  }
};

/* =====================================================
   👤 UPDATE MY PROFILE (Self)
===================================================== */
export const updateMe = async (req, res) => {
  try {
    const { name, avatar, mobile, bio } = req.body;
    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    if (mobile) user.mobile = mobile;
    if (bio !== undefined) user.bio = bio;

    await user.save();

    res.json({
      message: "Profile updated successfully ✅",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        mobile: user.mobile
      },
    });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ message: "Error updating profile" });
  }
};

