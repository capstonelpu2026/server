import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    /* 👤 Core Identity */
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    mobile: { type: String, default: "" },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" }, // ✨ New: Bio for all users
    
    // ✨ New: Universal Social Links
    socials: {
        github: { type: String, default: "" },
        linkedin: { type: String, default: "" },
        website: { type: String, default: "" },
        twitter: { type: String, default: "" }
    },

    /* 🏢 Company Info (Recruiter Extended Fields) */
    companyWebsite: { type: String, default: "" },
    companyDescription: { type: String, default: "" },
    designation: { type: String, default: "" }, // ✨ New: HR Manager, Talent Acquisition, etc.
    socialLinks: { 
       linkedin: { type: String, default: "" },
       twitter: { type: String, default: "" }
    },

    /* 🆔 Identity Verification (Recruiter KYC) */
    identityVerification: {
      pan: { type: String, default: "" }, 
      gst: { type: String, default: "" },
      verified: { type: Boolean, default: false },
      verifiedAt: Date
    },
    
    upiVerification: {
      upiId: { type: String, default: "" }, // name@paytm
      verified: { type: Boolean, default: false },
      verifiedAt: Date,
      transactionId: { type: String, default: "" }
    },

    /* 🛠 Skills (for Auto-Matching) */
    skills: [{ type: String, trim: true }],
    openToTeaming: { type: Boolean, default: false },

    /* 🧩 Roles */
    role: {
      type: String,
      enum: ["candidate", "mentor", "recruiter", "superadmin", "guest"],
      default: "candidate",
      lowercase: true,
      trim: true,
    },
    /* 🎮 Platform Gamification */
    points: { type: Number, default: 0 },
    arenaStats: {
        totalXP: { type: Number, default: 0 },
        solvedChallengesCount: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        maxStreak: { type: Number, default: 0 },
        lastSolvedDate: { type: String }, // YYYY-MM-DD
        solvedChallengesList: [{ 
            challengeId: { type: String },
            score: { type: Number, default: 0 },
            feedback: { type: String },
            complexity: {
                time: { type: String },
                space: { type: String }
            },
            testCases: { type: Array },
            solvedAt: { type: Date, default: Date.now }
        }]
    },
    allowedRoles: {
      type: [String],
      default: [],
    },

    /* 🏢 Recruiter-specific fields */
    orgName: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved", // auto-approved for non-recruiters
    },

    /* 🔐 Recovery */
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    /* 🕒 Login & Activity */
    lastLogin: { type: Date },
    loginHistory: [
      {
        at: { type: Date, default: Date.now },
        ip: String,
        userAgent: String,
        location: String,
      },
    ],

    /* 🎓 Mentor fields */
    mentorProfile: {
      expertise: { type: String, default: "" },
      experience: { type: Number, default: 0 },
      bio: { type: String, default: "" },
      company: { type: String, default: "" },
      
      // Extended Profile
      profilePhoto: { type: String, default: "" },
      videoIntro: { type: String, default: "" }, // YouTube/Loom URL
      languages: [{ type: String }], // ["English", "Hindi", "Spanish"]
      timezone: { type: String, default: "Asia/Kolkata" },
      hourlyRate: { type: Number, default: 0 }, // Base rate
      
      // Achievements & Credentials
      achievements: [{ type: String }],
      certifications: [{
        name: String,
        issuer: String,
        year: Number,
        url: String
      }],
      
      // Services offered
      services: [
        {
          title: { type: String, required: true },
          type: { 
            type: String, 
            enum: ["1:1 Call", "Resume Review", "Mock Interview", "Text Query", "Career Guidance"], 
            required: true 
          },
          price: { type: Number, default: 0 },
          duration: { type: Number, default: 30 }, // in minutes
          description: { type: String, default: "" },
          isActive: { type: Boolean, default: true }
        }
      ],
      
      // Availability schedule
      availability: [
        {
          day: { 
            type: String, 
            enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            required: true 
          },
          slots: [{
            startTime: { type: String, required: true }, // "09:00"
            endTime: { type: String, required: true },   // "10:00"
            isBooked: { type: Boolean, default: false }
          }]
        }
      ],
      
      // Settings
      bufferTime: { type: Number, default: 15 }, // minutes between sessions
      maxSessionsPerDay: { type: Number, default: 5 },
      isAvailable: { type: Boolean, default: true }, // vacation mode toggle
      
      // Stats (calculated)
      totalSessions: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 },

      // 📄 Verification Documents
      documents: {
        resume: { type: String, default: "" }, 
        experienceCert: { type: String, default: "" },
        otherCert: { type: String, default: "" }
      },
      
      // 🌐 Socials
      socials: {
        linkedin: { type: String, default: "" },
        github: { type: String, default: "" },
        portfolio: { type: String, default: "" },
        twitter: { type: String, default: "" }
      }
    },
    mentorRequested: { type: Boolean, default: false },
    mentorApproved: { type: Boolean, default: false },
    mentees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    mentorAssigned: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* 🧾 Candidate Profile Integration */
    resumeUrl: { type: String, default: "" },
    resumePublicId: { type: String, default: "" }, // for Cloudinary deletes/updates
    coverLetter: { type: String, default: "" },

    /* 🎓 Rich Profile Fields (Unstop Style) */
    education: [
      {
        school: { type: String, required: true },
        degree: { type: String, required: true },
        fieldOfStudy: { type: String, default: "" },
        startDate: { type: Date },
        endDate: { type: Date },
        grade: { type: String, default: "" },
        description: { type: String, default: "" },
      }
    ],
    workExperience: [
      {
        company: { type: String, required: true },
        title: { type: String, required: true },
        location: { type: String, default: "" },
        startDate: { type: Date },
        endDate: { type: Date },
        current: { type: Boolean, default: false },
        description: { type: String, default: "" },
      }
    ],
    projects: [
      {
        title: { type: String, required: true },
        link: { type: String, default: "" },
        startDate: { type: Date },
        endDate: { type: Date },
        description: { type: String, default: "" },
      }
    ],
    certifications: [
      {
        name: { type: String, required: true },
        organization: { type: String, default: "" },
        issueDate: { type: Date },
        link: { type: String, default: "" },
      }
    ],

    /* ⚙️ Notification Preferences */
    notificationSettings: {
      email: {
        jobs: { type: Boolean, default: true },
        social: { type: Boolean, default: true },
        system: { type: Boolean, default: true }
      },
      inApp: {
        jobs: { type: Boolean, default: true },
        social: { type: Boolean, default: true },
        system: { type: Boolean, default: true }
      },
      push: {
        enabled: { type: Boolean, default: false },
        subscription: { type: Object, default: {} } // For WebPush API
      }
    },

    savedJobs: [{ type: mongoose.Schema.Types.ObjectId, ref: "Job" }],

    applications: [
      {
        job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
        status: {
          type: String,
          enum: ["applied", "under_review", "shortlisted", "rejected", "hired", "withdrawn"],
          default: "applied",
        },
        appliedAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    contestReminders: [
      {
        contestId: String,
        platform: String,
        title: String,
        startTime: Date,
        notified: { type: Boolean, default: false }
      }
    ],
    savedChallenges: [{ type: String }],
    dailyStreak: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },
    lastSolveDate: { type: Date },
    dailySolveCount: { type: Number, default: 0 },
    attendanceStreak: { type: Number, default: 0 },
    maxAttendanceStreak: { type: Number, default: 0 },
    lastVisitDate: { type: Date },
    attendancePoints: { type: Number, default: 0 },
    isElite: { type: Boolean, default: false },
    verificationStatus: { 
      type: String, 
      enum: ["none", "pending", "verified", "elite"], 
      default: "none" 
    },
    averageMentorRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* 🧩 Role & Authorization Normalization */
userSchema.pre("save", function (next) {
  if (this.role) this.role = this.role.toLowerCase().trim();
  if (!this.allowedRoles.includes(this.role)) this.allowedRoles.push(this.role);
  this.allowedRoles = this.allowedRoles.map((r) => r.toLowerCase().trim());
  if (this.role !== "recruiter" && !this.status) this.status = "approved";
  next();
});

/* 🔒 Password Hashing */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* 🔑 Password Comparison */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// 🔍 Text Search Index (Mentors, Jobs, etc)
userSchema.index({ 
   name: "text", 
   email: "text",
   "mentorProfile.expertise": "text", 
   "mentorProfile.company": "text" 
});

export default mongoose.model("User", userSchema);

