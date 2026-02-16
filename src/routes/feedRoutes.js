import express from "express";
import { protect } from "../middleware/auth.js";
import { 
  getFeed, 
  getTrendingFeed,
  createPost, 
  deletePost,
  toggleLike, 
  toggleDislike,
  addComment,
  deleteComment,
  addReply,
  deleteReply,
  summarizeDiscussion
} from "../controllers/feedController.js";

const router = express.Router();

router.get("/trending", getTrendingFeed); 
router.get("/", getFeed);
router.post("/", protect, createPost);
router.delete("/:id", protect, deletePost);
router.put("/:id/like", protect, toggleLike);
router.put("/:id/dislike", protect, toggleDislike);
router.post("/:id/summarize", protect, summarizeDiscussion);
router.post("/:id/comment", protect, addComment);
router.delete("/:id/comment/:commentId", protect, deleteComment);
router.post("/:id/comment/:commentId/reply", protect, addReply);
router.delete("/:id/comment/:commentId/reply/:replyId", protect, deleteReply);

export default router;
