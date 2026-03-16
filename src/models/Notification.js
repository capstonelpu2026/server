import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["system", "admin", "candidate", "recruiter", "job", "social", "mentorship"],
      default: "system",
    },
    link: {
      type: String,
      default: "",
    },
    aggregationKey: {
      type: String, // e.g., "like_post_123"
      index: true,
    },
    count: {
      type: Number,
      default: 1,
    },
    read: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
