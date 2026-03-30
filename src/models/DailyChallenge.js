import mongoose from "mongoose";

const dailyChallengeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    problemUrl: { type: String, default: "" }, // can point to our internal arena
    type: { type: String, enum: ["DSA", "CSS", "JS", "SQL"], default: "DSA" },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    date: { type: Date, required: true, unique: true }, // one per day
    starterCode: { type: String, default: "" },
    testCases: [
      {
        input: String,
        output: String,
      }
    ],
    points: { type: Number, default: 50 },
    platforms: [{ type: String, default: ["OneStop AI"] }],
  },
  { timestamps: true }
);

export default mongoose.model("DailyChallenge", dailyChallengeSchema);
