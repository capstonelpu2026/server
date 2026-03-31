import mongoose from "mongoose";

/* -------------------------------------------------------
   🔖 Test Case Sub-Schema
------------------------------------------------------- */
const testCaseSchema = new mongoose.Schema({
  input:          { type: String, required: true },
  expectedOutput: { type: String, required: true },
  isHidden:       { type: Boolean, default: false },   // hidden from participants
  marks:          { type: Number,  default: 10 },
}, { _id: true });

/* -------------------------------------------------------
   💻 Problem Sub-Schema
------------------------------------------------------- */
const problemSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, required: true },
  difficulty:  { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
  constraints: [{ type: String }],
  inputFormat:  { type: String, default: "" },
  outputFormat: { type: String, default: "" },
  starterCode:  { type: String, default: "// Write your solution here" },
  language:     { type: String, default: "javascript" },
  testCases:    [testCaseSchema],
  points:       { type: Number, default: 100 },
  timeLimit:    { type: Number, default: 2 },          // seconds
  memoryLimit:  { type: Number, default: 256 },        // MB
}, { _id: true });

/* -------------------------------------------------------
   🏆 Participant Submission Track
------------------------------------------------------- */
const participantSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name:          { type: String },
  email:         { type: String },
  joinedAt:      { type: Date, default: Date.now },
  totalScore:    { type: Number, default: 0 },
  solvedCount:   { type: Number, default: 0 },
  rank:          { type: Number, default: null },
  // Proctoring fields
  violationCount: { type: Number, default: 0 },
  isDisqualified: { type: Boolean, default: false },
  warningSent:    { type: Boolean, default: false },
  violationLogs: [{
    category:  { type: String }, // e.g., "phone_detected", "tab_switch"
    details:   { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  certificateUniqueId: { type: String, unique: true, sparse: true },
  submissions: [{
    problemId:   { type: mongoose.Schema.Types.ObjectId },
    code:        { type: String },
    language:    { type: String },
    status:      { type: String, enum: ["accepted", "rejected", "partial", "pending"], default: "pending" },
    score:       { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
    evaluation:  { type: mongoose.Schema.Types.Mixed },  // AI evaluation JSON
  }],
  lastSubmissionAt: { type: Date, default: null },
  sessionStartedAt: { type: Date, default: null }, // Track when student actually enters the arena
}, { _id: false });

/* -------------------------------------------------------
   🎯 Main Contest Schema
------------------------------------------------------- */
const codingContestSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  subtitle:     { type: String, trim: true },
  description:  { type: String, required: true },
  banner:       { url: String, publicId: String },

  // Identity
  company:      { type: String, default: "OneStop" },
  difficulty:   { type: String, enum: ["Beginner", "Intermediate", "Advanced", "Expert"], default: "Intermediate" },
  tags:         [{ type: String }],

  // Timing  — startAt + 24h = endAt (auto-computed)
  startAt:      { type: Date, required: true },
  endAt:        { type: Date },                         // computed on save = startAt + 24h
  durationHours:{ type: Number, default: 24 },          // always 24 by default

  // Registration window
  registrationDeadline: { type: Date },                 // default = startAt

  // Status (auto-derived virtual OR manual override)
  status: {
    type: String,
    enum: ["draft", "upcoming", "live", "completed", "cancelled"],
    default: "upcoming",
  },

  // Problems
  problems: [problemSchema],

  // Prizes
  prizes: [{
    rank:      { type: Number },
    title:     { type: String },
    amount:    { type: String },
    perks:     [{ type: String }],
  }],

  // Rules
  rules: [{ type: String }],

  // Participants
  participants: [participantSchema],
  maxParticipants: { type: Number, default: 0 },         // 0 = unlimited

  // Meta
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  isPublished: { type: Boolean, default: false },
  languages:   [{ type: String }],  // allowed programming languages
  mode:        { type: String, enum: ["manual", "ai"], default: "manual" },

  // Session Timing
  isSessionTimed:        { type: Boolean, default: false },
  sessionDurationMinutes: { type: Number, default: 60 },

}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

/* -------------------------------------------------------
   🔄 Auto-compute endAt & registrationDeadline
------------------------------------------------------- */
codingContestSchema.pre("save", function (next) {
  if (this.startAt) {
    const hours = this.durationHours || 24;
    this.endAt = new Date(new Date(this.startAt).getTime() + hours * 60 * 60 * 1000);
    // Registration allowed until the contest ENDS (not just when it starts)
    if (!this.registrationDeadline) {
      this.registrationDeadline = this.endAt;
    }
  }
  next();
});

/* -------------------------------------------------------
   📊 Virtual: live status based on current time
------------------------------------------------------- */
codingContestSchema.virtual("computedStatus").get(function () {
  const now = new Date();
  if (this.status === "cancelled") return "cancelled";
  if (this.status === "draft")      return "draft";
  if (!this.startAt || !this.endAt) return "upcoming";
  if (now < new Date(this.startAt)) return "upcoming";
  if (now >= new Date(this.startAt) && now <= new Date(this.endAt)) return "live";
  return "completed";
});

/* -------------------------------------------------------
   📊 Virtual: participant count
------------------------------------------------------- */
codingContestSchema.virtual("participantCount").get(function () {
  return this.participants?.length ?? 0;
});

/* Indexes */
codingContestSchema.index({ startAt: 1, status: 1 });
codingContestSchema.index({ createdBy: 1 });

export default mongoose.model("CodingContest", codingContestSchema);
