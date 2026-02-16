import asyncHandler from "express-async-handler";
import Post from "../models/Post.js";
import { notifyUser } from "../utils/notifyUser.js";
import { isProfane } from "../utils/badWordFilter.js";

// @desc    Get all posts
// @route   GET /api/feed
// @access  Private
export const getFeed = asyncHandler(async (req, res) => {
  const { category, sortBy } = req.query;
  const filter = {};
  
  if (category && category !== 'All') {
    filter.category = category;
  }

  if (sortBy === "No Answers") {
     filter["comments.0"] = { $exists: false }; // Check if comments array is empty or index 0 doesn't exist
  }

  let posts;

  if (sortBy === "Trending") {
     posts = await Post.aggregate([
        { $match: filter },
        { 
           $addFields: { 
              likesCount: { $size: { $ifNull: ["$likes", []] } },
              isNew: { $gt: ["$createdAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] } // Boost new posts slightly? optional. Just sorting by likes for now.
           } 
        },
        { $sort: { likesCount: -1, createdAt: -1 } },
        {
          $lookup: {
             from: "users",
             localField: "author",
             foreignField: "_id",
             as: "author"
          }
        },
        { $unwind: "$author" },
        {
           $lookup: { // Populate comments to get user details is tricky in aggregate, but we can do a simple lookup or just rely on Populate after Aggregate if we return IDs.
              // Actually, Mongoose 6+ supports aggregate().model() or we can hydrate.
              // Easier: Just return the docs and let frontend handle basic fields or use hydration.
              // Better: Use normal find() if not trending, and use aggregate only for trending?
              // Or better: Use Mongoose Virtual 'likesCount' but specific sort needs it in DB.
              // Let's stick to Aggregate for Trending.
              from: "users", // we need author details
              localField: "comments.user",
              foreignField: "_id",
              as: "commentUsers"
           }
        }
        // ... Aggregate is getting complex for deep population (comments.user).
        // Alternative for Trending: Fetch all (filtered) and sort in JS if dataset is small.
        // Or: Since it's a feed, we really want DB sort.
     ]);
     
     // Re-populating author and comments.user strictly via aggregate is verbose.
     // Trick: Get IDs from aggregate, then find().
     const sortedIds = posts.map(p => p._id);
     posts = await Post.find({ _id: { $in: sortedIds } })
        .populate("author", "name avatar role orgName company")
        .populate("comments.user", "name avatar role");
     
     // Re-sort in JS to match aggregate order (find($in) doesn't guarantee order)
     posts.sort((a, b) => {
        return sortedIds.findIndex(id => id.equals(a._id)) - sortedIds.findIndex(id => id.equals(b._id));
     });
     
  } else {
     // Normal Find
     posts = await Post.find(filter)
       .populate("author", "name avatar role orgName company")
       .populate("comments.user", "name avatar role")
       .sort({ createdAt: -1 });
  }
  
  res.json(posts);
});

// @desc    Create a post
// @route   POST /api/feed
// @access  Private
export const createPost = asyncHandler(async (req, res) => {
  const { title, content, image, tags, category } = req.body;

  if (!title || !content) {
    res.status(400);
    throw new Error("Title and Content are required");
  }

  if (isProfane(content) || isProfane(title)) {
    res.status(400);
    throw new Error("Your post contains inappropriate language. Please maintain a professional environment.");
  }

  const post = await Post.create({
    author: req.user._id,
    title,
    content,
    image,
    tags: tags || [],
    category: category || "General"
  });

  const populatedPost = await Post.findById(post._id).populate("author", "name avatar role");

  res.status(201).json(populatedPost);
});

// @desc    Delete a post
// @route   DELETE /api/feed/:id
// @access  Private
export const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  // Check ownership or admin
  if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
     res.status(401);
     throw new Error("Not authorized to delete this post");
  }

  await Post.findByIdAndDelete(req.params.id);
  res.json({ message: "Post removed" });
});

// @desc    Like a post
// @route   PUT /api/feed/:id/like
// @access  Private
export const toggleLike = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  let liked = false;
  
  // Remove from dislikes if present
  if (post.dislikes && post.dislikes.includes(req.user._id)) {
     post.dislikes = post.dislikes.filter(id => id.toString() !== req.user._id.toString());
  }

  if (post.likes.includes(req.user._id)) {
    post.likes = post.likes.filter(id => id.toString() !== req.user._id.toString());
  } else {
    post.likes.push(req.user._id);
    liked = true;
  }

  await post.save();

  if (liked && post.author.toString() !== req.user._id.toString()) {
    await notifyUser({
      userId: post.author,
      title: "New Like on your Question",
      message: `${req.user.name} liked your question: "${post.title?.substring(0, 20)}..."`,
      link: `/community`
    });
  }

  const updatedPost = await Post.findById(req.params.id)
     .populate("author", "name avatar role")
     .populate("comments.user", "name avatar role");
     
  res.json(updatedPost);
});

// @desc    Dislike a post
// @route   PUT /api/feed/:id/dislike
// @access  Private
export const toggleDislike = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  // Remove from likes if present
  if (post.likes.includes(req.user._id)) {
     post.likes = post.likes.filter(id => id.toString() !== req.user._id.toString());
  }

  if (post.dislikes && post.dislikes.includes(req.user._id)) {
    post.dislikes = post.dislikes.filter(id => id.toString() !== req.user._id.toString());
  } else {
    if (!post.dislikes) post.dislikes = [];
    post.dislikes.push(req.user._id);
  }

  await post.save();

  const updatedPost = await Post.findById(req.params.id)
     .populate("author", "name avatar role")
     .populate("comments.user", "name avatar role");
     
  res.json(updatedPost);
});

// @desc    Add a comment
// @route   POST /api/feed/:id/comment
// @access  Private
export const addComment = asyncHandler(async (req, res) => {
  console.log("Adding comment to post:", req.params.id);
  const { text } = req.body;
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  if (isProfane(text)) {
    res.status(400);
    throw new Error("Comment contains inappropriate language.");
  }

  const comment = {
    user: req.user._id,
    text,
    createdAt: new Date()
  };

  post.comments.push(comment);
  
  try {
    await post.save();
    console.log("Comment saved");
  } catch (err) {
    console.error("Save failed:", err);
    throw err;
  }

  if (post.author.toString() !== req.user._id.toString()) {
    try {
        // Fetch author email for notification
        // Note: We are not fetching Author model here, so email is not passed to notifyUser
        // Use notifyUser solely for Realtime/DB notif if email is missing
        await notifyUser({
          userId: post.author,
          title: "New Answer/Comment on your Question",
          message: `${req.user.name} answered: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
          link: `/community`,
          type: "social",
          emailEnabled: true, // Will be ignored if email is not provided
          emailSubject: `New response on: ${post.title?.substring(0, 30)}`,
        });
    } catch (notifErr) {
        console.error("Notification Error:", notifErr);
    }
  }

  const updatedPost = await Post.findById(req.params.id)
    .populate("author", "name avatar role")
    .populate("comments.user", "name avatar role");

  res.json(updatedPost);
});

// @desc    Delete a comment
// @route   DELETE /api/feed/:id/comment/:commentId
// @access  Private
export const deleteComment = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  // Find comment manually to check permissions
  // Using loose equality or string conversion to be safe
  const comment = post.comments.find(c => c._id.toString() === req.params.commentId);

  if (!comment) {
    res.status(404);
    throw new Error("Comment not found");
  }

  // Allow comment author, post author, or admin to delete
  if (
    comment.user.toString() !== req.user._id.toString() && 
    post.author.toString() !== req.user._id.toString() &&
    req.user.role !== 'admin' && 
    req.user.role !== 'superadmin'
  ) {
    res.status(401);
    throw new Error("Not authorized");
  }

  // Use filter to remove, compatible with all Mongoose versions
  post.comments = post.comments.filter(c => c._id.toString() !== req.params.commentId);
  
  await post.save();

  const updatedPost = await Post.findById(req.params.id)
    .populate("author", "name avatar role")
    .populate("comments.user", "name avatar role");
    
  res.json(updatedPost);
});

// @desc    Add a reply to a comment
// @route   POST /api/feed/:id/comment/:commentId/reply
// @access  Private
export const addReply = asyncHandler(async (req, res) => {
  const { text } = req.body;
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  // Find the comment subdocument
  const comment = post.comments.id(req.params.commentId);
  if (!comment) {
    res.status(404);
    throw new Error("Comment not found");
  }

  if (isProfane(text)) {
    res.status(400);
    throw new Error("Reply contains inappropriate language.");
  }

  const reply = {
    user: req.user._id,
    text,
    createdAt: new Date()
  };

  // Ensure replies array exists (for older docs)
  if (!comment.replies) {
    comment.replies = [];
  }

  comment.replies.push(reply);

  try {
    await post.save();
  } catch (err) {
    console.error("Save reply failed:", err);
    throw err;
  }

  // Notify original comment author if it's not the replier
  if (comment.user && comment.user.toString() !== req.user._id.toString()) {
     try {
       await notifyUser({
         userId: comment.user,
         title: "New Reply to your Answer",
         message: `${req.user.name} replied: "${text.substring(0, 30)}..."`,
         link: `/community`,
         type: "social",
         emailEnabled: true,
         emailSubject: `New reply on discussion: ${post.title?.substring(0, 30)}`
       });
     } catch (err) {
        console.error("Notify reply failed:", err);
     }
  }

  const updatedPost = await Post.findById(req.params.id)
    .populate("author", "name avatar role")
    .populate("comments.user", "name avatar role")
    .populate("comments.replies.user", "name avatar role");

  res.json(updatedPost);
});

// @desc    Delete a reply
// @route   DELETE /api/feed/:id/comment/:commentId/reply/:replyId
// @access  Private
export const deleteReply = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  const comment = post.comments.id(req.params.commentId);
  if (!comment) {
    res.status(404);
    throw new Error("Comment not found");
  }

  const reply = comment.replies.id(req.params.replyId);
  if (!reply) {
     res.status(404);
     throw new Error("Reply not found");
  }

  if (
    reply.user.toString() !== req.user._id.toString() &&
    comment.user.toString() !== req.user._id.toString() &&
    post.author.toString() !== req.user._id.toString() &&
    req.user.role !== 'admin' &&
    req.user.role !== 'superadmin'
  ) {
    res.status(401);
    throw new Error("Not authorized");
  }

  // Using pull to remove subdocument from array
  comment.replies.pull(req.params.replyId);
  await post.save();

  const updatedPost = await Post.findById(req.params.id)
    .populate("author", "name avatar role")
    .populate("comments.user", "name avatar role")
    .populate("comments.replies.user", "name avatar role");

  res.json(updatedPost);
});
// @desc    Get trending posts and tags
// @route   GET /api/feed/trending
// @access  Public
export const getTrendingFeed = asyncHandler(async (req, res) => {
  // 1. Hot Discussions: Sort by likes count + comments count
  const hotPosts = await Post.aggregate([
    {
      $addFields: {
        interactions: { $add: [{ $size: "$likes" }, { $size: "$comments" }] }
      }
    },
    { $sort: { interactions: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "users",
        localField: "author",
        foreignField: "_id",
        as: "author"
      }
    },
    { $unwind: "$author" },
    {
      $project: {
        title: 1,
        author: { name: 1, avatar: 1 },
        comments: 1,
        likes: 1,
        createdAt: 1
      }
    }
  ]);

  // 2. Popular Tags: Aggregate all tags and count frequency
  const popularTags = await Post.aggregate([
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  res.json({
    hotDiscussions: hotPosts,
    popularTags: popularTags.map(t => t._id)
  });
});

// @desc    Summarize a discussion thread using AI
// @route   POST /api/feed/:id/summarize
// @access  Private
import Groq from "groq-sdk";

export const summarizeDiscussion = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id)
    .populate("author", "name")
    .populate("comments.user", "name");

  if (!post) {
    res.status(404);
    throw new Error("Post not found");
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(500);
    throw new Error("AI Service Unavailable (Key missing)");
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Construct context from post and comments
  let discussionText = `Title: ${post.title}\nContent: ${post.content}\n\n`;
  
  if (post.comments && post.comments.length > 0) {
    discussionText += "Comments/Answers:\n";
    post.comments.forEach((c, i) => {
       discussionText += `${i+1}. ${c.user?.name || "User"}: ${c.text}\n`;
       if (c.replies && c.replies.length > 0) {
          c.replies.forEach(r => {
             discussionText += `   - Reply: ${r.text}\n`;
          });
       }
    });
  } else {
     return res.json({ summary: "No comments to summarize yet." });
  }

  const prompt = `
    You are a technical community assistant. Summarize the following discussion thread into a concise, actionable summary.
    
    Structure the summary as:
    1. **Core Question/Issue**: What was the OP asking?
    2. **Key Solutions/Consensus**: what were the main answers provided?
    3. **Actionable Takeaway**: Best advice given.

    Keep it under 150 words. Use markdown formatting.
    
    Discussion Data:
    ${discussionText.substring(0, 15000)} // truncate to avoid token limits
  `;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 400
    });

    res.json({ summary: chatCompletion.choices[0]?.message?.content || "Could not generate summary." });
  } catch (error) {
    console.error("AI Summary Error:", error);
    res.status(500);
    throw new Error("Failed to generate summary");
  }
});
