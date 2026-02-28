import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema({
  mentor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 500 // Minimum withdrawal threshold
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "processed"],
    default: "pending"
  },
  paymentMethod: {
    type: String,
    default: "Bank Transfer"
  },
  processedAt: Date,
  rejectionReason: String,
}, { timestamps: true });

export default mongoose.model("Withdrawal", withdrawalSchema);
