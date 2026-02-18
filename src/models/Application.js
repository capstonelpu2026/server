// models/Application.js
import mongoose from "mongoose";

const ApplicationSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  resumeUrl: { type: String },
  coverLetter: { type: String },
  status: {
    type: String,
    enum: ["applied", "shortlisted", "interviewing", "offered", "rejected", "hired"],
    default: "applied",
  },
  interviewDetails: {
    date: { type: Date },
    time: { type: String },
    link: { type: String },
    location: { type: String }
  },
  offerDetails: {
    salary: { type: String },
    joinDate: { type: Date },
    department: { type: String },
    reportingManager: { type: String },
    workMode: { type: String, enum: ["Remote", "Hybrid", "On-site"], default: "On-site" },
    location: { type: String },
    additionalTerms: { type: String },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" }
  },
  rejectionFeedback: { type: String },
  assessment: {
    status: { type: String, enum: ["none", "sent", "completed"], default: "none" },
    questions: [{
      question: String,
      options: [String],
      answer: String,
      type: { type: String, default: "mcq" }
    }],
    responses: [String],
    score: { type: Number },
    violations: { type: Number, default: 0 }, // Track tab switching
    completedAt: { type: Date }
  },
  atsScore: { type: Number },
  atsVerdict: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ApplicationSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.models.Application || mongoose.model("Application", ApplicationSchema);
