import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    mentee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    serviceTitle: { type: String, required: true },
    serviceType: { type: String, required: true },
    price: { type: Number, required: true },
    duration: { type: Number, required: true }, // minutes
    scheduledDate: { type: String, required: true }, // YYYY-MM-DD
    scheduledTime: { type: String, required: true }, // 10:00 AM
    meetingLink: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled", "expired"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending", // For now we might skip real payments, or mock "paid"
    },
    notes: { type: String, default: "" },
    rating: { type: Number, default: 0 },
    review: { type: String, default: "" },
    cancellationReason: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Session", sessionSchema);
