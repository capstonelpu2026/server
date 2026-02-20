import mongoose from "mongoose";

const peerSessionSchema = new mongoose.Schema({
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["interviewer", "candidate"], required: true },
    rating: { type: Number, min: 0, max: 5 },
    feedback: { type: String }
  }],
  topic: { type: String, required: true },
  roomId: { type: String, required: true },
  status: { type: String, enum: ["scheduled", "active", "completed", "cancelled"], default: "active" },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  codeSnapshot: { type: String },
  isSwapped: { type: Boolean, default: false }
}, { timestamps: true });

const PeerSession = mongoose.model("PeerSession", peerSessionSchema);
export default PeerSession;
