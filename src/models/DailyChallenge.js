import mongoose from "mongoose";

const dailyChallengeSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },

    // Corporate-style structured fields (LeetCode / HackerRank standard)
    scenario:    { type: String, default: "" }, // Business context paragraph
    task:        { type: String, default: "" }, // The exact problem task sentence
    description: { type: String, default: "" }, // Legacy fallback (full blob)

    inputFormat:  { type: String, default: "" },
    outputFormat: { type: String, default: "" },

    examples: [
      {
        input:       { type: String },
        output:      { type: String },
        explanation: { type: String },
      }
    ],

    notes:       [{ type: String }],   // "Note:" section bullets
    hints:       [{ type: String }],   // Optional hints

    constraints: [{ type: String }],

    type:        { type: String, enum: ["DSA", "CSS", "JS", "SQL"], default: "DSA" },
    difficulty:  { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    date:        { type: Date, required: true, unique: true },
    starterCode: { type: String, default: "" },
    testCases:   [{ input: String, output: String }],
    points:      { type: Number, default: 50 },
    platforms:   [{ type: String, default: ["OneStop AI"] }],
    problemUrl:  { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("DailyChallenge", dailyChallengeSchema);
