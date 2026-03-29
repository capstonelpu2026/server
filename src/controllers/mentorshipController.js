import User from "../models/User.js";
import Session from "../models/Session.js";
import AuditLog from "../models/AuditLog.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Withdrawal from "../models/Withdrawal.js";
import { notifyUser } from "../utils/notifyUser.js";

// 📌 Get All Approved Mentors
export const getMentors = async (req, res) => {
  try {
    const { expertise, search, experience, minPrice, maxPrice } = req.query;
    const query = { role: "mentor", mentorApproved: true };

    if (expertise) {
      query["mentorProfile.expertise"] = { $regex: expertise, $options: "i" };
    }
    
    if (experience) {
      const expNum = parseInt(experience);
      if (!isNaN(expNum)) {
        query["mentorProfile.experience"] = { $gte: expNum };
      }
    }

    if (minPrice || maxPrice) {
      query["mentorProfile.services.price"] = {};
      if (minPrice) query["mentorProfile.services.price"].$gte = parseInt(minPrice);
      if (maxPrice) query["mentorProfile.services.price"].$lte = parseInt(maxPrice);
    }

    if (search) {
      query.$text = { $search: search }; 
    }

    const mentors = await User.find(query)
      .select("name avatar email mentorProfile")
      .lean();

    // Aggregate ratings for each mentor
    const mentorsWithRatings = await Promise.all(mentors.map(async (m) => {
       const stats = await Session.aggregate([
          { $match: { mentor: m._id, status: "completed", rating: { $gt: 0 } } },
          { $group: { _id: "$mentor", avgRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
       ]);
       
       // Return numeric values for consistency
       return { 
          ...m, 
          averageRating: stats[0] ? parseFloat(stats[0].avgRating.toFixed(1)) : 0, 
          totalReviews: stats[0]?.totalReviews || 0 
       };
    }));

    res.json(mentorsWithRatings);
  } catch (err) {
    console.error("Fetch mentors error:", err);
    res.status(500).json({ message: "Error fetching mentors" });
  }
};

// 📌 Get Specific Mentor Details
export const getMentorById = async (req, res) => {
  try {
    const mentor = await User.findById(req.params.id)
      .select("-password")
      .lean();
      
    if (!mentor || mentor.role !== "mentor") {
      return res.status(404).json({ message: "Mentor not found" });
    }

    // Get Reviews
    const reviews = await Session.find({ mentor: mentor._id, status: "completed", rating: { $gt: 0 } })
       .populate("mentee", "name avatar")
       .select("rating review mentee createdAt")
       .sort({ createdAt: -1 })
       .limit(10);
    
    // Calculate Average
    const stats = await Session.aggregate([
        { $match: { mentor: mentor._id, status: "completed", rating: { $gt: 0 } } },
        { $group: { _id: "$mentor", avgRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
    ]);

    // Fetch upcoming booked slots (pending or confirmed)
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    const bookedSessions = await Session.find({
       mentor: mentor._id,
       status: { $in: ["pending", "confirmed"] },
       scheduledDate: { $gte: today }
    })
    .select("scheduledDate scheduledTime duration")
    .lean();


    // Check if current user (candidate) has any active session with this mentor
    let hasSession = false;
    if (req.user) {
       const sessionExists = await Session.findOne({
          mentor: mentor._id,
          mentee: req.user._id,
          status: { $ne: 'cancelled' }
       });
       hasSession = !!sessionExists;
    }

    res.json({ 
       ...mentor, 
       averageRating: stats[0]?.avgRating?.toFixed(1) || "New",
       totalReviews: stats[0]?.totalReviews || 0,
       reviews,
       bookedSessions,
       hasSession
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// 📌 Update Mentor Services & Availability
export const updateMentorSettings = async (req, res) => {
  try {
    const { services, availability, bio, experience, expertise, company } = req.body;
    const user = await User.findById(req.user._id);

    // Ensure mentorProfile exists
    if (!user.mentorProfile) {
      user.mentorProfile = {};
    }

    // Patch mentor profile
    if (services) user.mentorProfile.services = services;
    if (availability) user.mentorProfile.availability = availability;
    if (bio !== undefined) user.mentorProfile.bio = bio;
    if (experience !== undefined) user.mentorProfile.experience = experience;
    if (expertise !== undefined) user.mentorProfile.expertise = expertise;
    if (company !== undefined) user.mentorProfile.company = company;

    await user.save();
    res.json({ message: "Mentor settings updated ✅", mentorProfile: user.mentorProfile });
  } catch (err) {
    console.error("Update mentor settings error:", err);
    res.status(500).json({ message: "Error updating settings" });
  }
};

// 📌 Book a Session
export const bookSession = async (req, res) => {
  try {
    const { mentorId, serviceTitle, serviceType, price, duration, scheduledDate, scheduledTime, notes } = req.body;

    const mentor = await User.findById(mentorId);
    if (!mentor || mentor.role !== "mentor") return res.status(404).json({ message: "Mentor not found" });

    // 🛡️ Verify Slot is actually in Mentor's Availability
    const dayName = new Date(scheduledDate).toLocaleDateString('en-US', { weekday: 'long' });
    const dayAvailability = mentor.mentorProfile?.availability?.find(d => d.day === dayName);
    
    // Some mentors might use strings or objects for slots, handle both
    const isAvailable = dayAvailability?.slots?.some(slot => {
       const startTime = typeof slot === 'object' ? slot.startTime : slot;
       return startTime === scheduledTime;
    });

    if (!isAvailable) {
       return res.status(400).json({ message: `The mentor is not available on ${dayName}s at ${scheduledTime}. Please refresh and pick an active slot.` });
    }

    // 🛡️ Prevent Double Booking (Same Candidate, Same Slot)
    const existingMyRequest = await Session.findOne({
      mentor: mentorId,
      mentee: req.user._id,
      scheduledDate,
      scheduledTime,
      status: { $in: ["pending", "confirmed"] }
    });
    
    if (existingMyRequest) {
      return res.status(400).json({ message: "You have already requested this slot. Please wait for approval." });
    }

    // 🛡️ Prevent Slot Collision (Slot already Confirmed for ANYONE)
    const slotTaken = await Session.findOne({
      mentor: mentorId,
      scheduledDate,
      scheduledTime,
      status: "confirmed"
    });

    if (slotTaken) {
      return res.status(400).json({ message: "This slot has just been booked by another candidate. Please choose another." });
    }

    // Create Booking
    const session = await Session.create({
      mentor: mentorId,
      mentee: req.user._id,
      serviceTitle,
      serviceType,
      price,
      duration,
      scheduledDate,
      scheduledTime,
      notes,
      status: "pending", 
      meetingLink: "", 
    });

    await AuditLog.create({
      action: "BOOK_MENTORSHIP",
      performedBy: req.user._id,
      targetUser: mentorId,
      details: `Booked session: ${serviceTitle} on ${scheduledDate} @ ${scheduledTime}`,
    });

    // 💬 Auto-start Conversation & Send Greeting
    try {
      const pair = [req.user._id.toString(), mentorId.toString()].sort();
      let conv = await Conversation.findOne({ participants: { $all: pair, $size: 2 } });
      
      if (!conv) {
         conv = await Conversation.create({ participants: pair });
      }

      await Message.create({
         conversation: conv._id,
         from: req.user._id,
         to: mentorId,
         body: `👋 Hi, I just requested a *${serviceTitle}* session for ${new Date(scheduledDate).toLocaleDateString()} at ${scheduledTime}. Looking forward to connecting!`,
         status: 'delivered'
      });

      // Update conversation timestamp
      conv.lastMessageAt = new Date();
      await conv.save();

    } catch (chatError) {
      console.error("Auto-chat init failed (non-fatal):", chatError);
    }

    // Notify Mentor (DB + Socket + Email)
    await notifyUser({
       userId: mentor._id,
       email: mentor.email,
       title: "New Mentorship Request",
       message: `Request from ${req.user.name}: ${serviceTitle} on ${new Date(scheduledDate).toDateString()}.`,
       link: `/dashboard/mentorship`,
       type: "mentorship",
       emailEnabled: true,
       emailSubject: "New Session Request - OneStop",
       emailHtml: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2 style="color: #2563EB;">New Mentorship Request</h2>
            <p>You have received a new booking request from <strong>${req.user.name}</strong>.</p>
            <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <p><strong>Service:</strong> ${serviceTitle} (${serviceType})</p>
              <p><strong>Date:</strong> ${new Date(scheduledDate).toDateString()}</p>
              <p><strong>Time:</strong> ${scheduledTime}</p>
              <p><strong>Duration:</strong> ${duration} mins</p>
              <p><strong>Price:</strong> ₹${price}</p>
              <p><strong>Note:</strong> ${notes || "N/A"}</p>
            </div>
            <p>Please log in to your dashboard to Accept or Decline this request.</p>
            <a href="http://localhost:5173/dashboard" style="display: inline-block; padding: 10px 20px; background: #2563EB; color: white; text-decoration: none; border-radius: 5px;">Go to Dashboard</a>
          </div>
       `
    });

    res.status(201).json({ message: "Session requested successfully! Notification sent (In-App + Email).", session });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ message: "Booking failed" });
  }
};

// 📌 Submit Review
export const reviewSession = async (req, res) => {
  try {
    const { rating, review } = req.body;
    const session = await Session.findById(req.params.id);

    if (!session) return res.status(404).json({ message: "Session not found" });
    if (session.mentee.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to review this session" });
    }
    if (session.status !== "completed") {
      return res.status(400).json({ message: "Can only review completed sessions" });
    }

    session.rating = rating;
    session.review = review;
    await session.save();

    // Log the review
    await AuditLog.create({
      action: "REVIEW_MENTOR",
      performedBy: req.user._id,
      targetUser: session.mentor,
      details: `Rated ${rating} stars: ${review}`,
    });

    res.json({ message: "Review submitted successfully ✅", session });
  } catch (err) {
    console.error("Review error:", err);
    res.status(500).json({ message: "Error submitting review" });
  }
};

// 📌 Get My Sessions
export const getMySessions = async (req, res) => {
  try {
    const isMentor = req.user.role === "mentor";
    const query = isMentor ? { mentor: req.user._id } : { mentee: req.user._id };
    
    const sessions = await Session.find(query)
      .populate("mentee", "name avatar email role mobile")
      .populate("mentor", "name avatar email role mobile mentorProfile")
      .sort({ createdAt: -1 });

    res.json(sessions);
  } catch (err) {
    console.error("Fetch sessions error:", err);
    res.status(500).json({ message: "Error fetching sessions" });
  }
};

// 📌 Update Session Status
export const updateSessionStatus = async (req, res) => {
  try {
    const { status, meetingLink } = req.body; // status: confirmed, completed, cancelled
    const session = await Session.findById(req.params.id).populate("mentee", "name email").populate("mentor", "name email");

    if (!session) return res.status(404).json({ message: "Session not found" });
    
    // Authorization Check
    const isMentor = session.mentor._id.toString() === req.user._id.toString();
    const isMentee = session.mentee._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "superadmin";

    if (!isMentor && !isAdmin && !isMentee) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Specific Rule: Mentees can ONLY cancel
    if (isMentee && status !== "cancelled") {
       return res.status(403).json({ message: "Candidates can only cancel sessions." });
    }

    session.status = status;
    if (meetingLink) session.meetingLink = meetingLink;
    
    await session.save();

    // Notify Counterpart (DB + Socket + Email)
    // If Mentor updated -> Notify Mentee
    // If Mentee updated -> Notify Mentor
    const targetUser = isMentor ? session.mentee : session.mentor;
    
    let emailSubject = `Session Update: ${status.toUpperCase()}`;
    let emailHtml = "";
    
    if (status === "confirmed") {
       emailSubject = "✅ Mentorship Session Confirmed!";
       emailHtml = `
         <h2>Your session has been confirmed!</h2>
         <p><strong>Mentor:</strong> ${session.mentor.name}</p>
         <p><strong>Topic:</strong> ${session.serviceTitle}</p>
         <p><strong>Time:</strong> ${new Date(session.scheduledDate).toDateString()} @ ${session.scheduledTime}</p>
         ${meetingLink ? `<p><strong>Join Link:</strong> <a href="${meetingLink}">${meetingLink}</a></p>` : ''}
         <p>Please be ready 5 minutes before the session.</p>
       `;
    } else if (status === "cancelled") {
       emailSubject = "❌ Session Cancelled";
       emailHtml = `
         <h2>Session Cancelled</h2>
         <p>The session for <strong>${session.serviceTitle}</strong> on ${new Date(session.scheduledDate).toDateString()} has been cancelled by ${req.user.name}.</p>
         <p>Reason/Change of plans.</p>
       `;
    } else if (status === "completed") {
       emailSubject = "🎉 Session Completed";
       emailHtml = `
         <h2>Session Completed</h2>
         <p>Your session with <strong>${session.mentor.name}</strong> has been marked as complete.</p>
         <p>We hope it was helpful!</p>
       `;
    }

    await notifyUser({
       userId: targetUser._id,
       email: targetUser.email,
       title: `Session ${status.charAt(0).toUpperCase() + status.slice(1)}`,
       message: `Session for ${session.serviceTitle} was ${status} by ${req.user.name}.`,
       link: `/mentorship/my-sessions`,
       type: "mentorship",
       emailEnabled: true,
       emailSubject,
       emailHtml
    });

    res.json(session);
  } catch (err) {
    console.error("Update session error:", err);
    res.status(500).json({ message: "Error updating session" });
  }
};

// 📌 Get Mentor Stats (Earnings, Hours, etc.)
export const getMentorStats = async (req, res) => {
   try {
      const mentorId = req.user._id;

      const sessionsStats = await Session.aggregate([
         { $match: { mentor: mentorId, status: "completed" } },
         { 
            $group: { 
               _id: null, 
               totalEarnings: { $sum: "$price" },
               totalMinutes: { $sum: "$duration" },
               completedSessions: { $sum: 1 },
               avgRating: { $avg: "$rating" }
            } 
         }
      ]);

      const pendingRequests = await Session.countDocuments({ mentor: mentorId, status: "pending" });

      const data = sessionsStats[0] || { totalEarnings: 0, totalMinutes: 0, completedSessions: 0, avgRating: 0 };

      // 2. Fetch Withdrawn Amounts
      const withdrawalStats = await Withdrawal.aggregate([
         { $match: { mentor: mentorId, status: { $ne: "rejected" } } },
         { $group: { _id: null, totalWithdrawn: { $sum: "$amount" } } }
      ]);
      const totalWithdrawn = withdrawalStats[0]?.totalWithdrawn || 0;
      const availableBalance = data.totalEarnings - totalWithdrawn;

      // Calculate Aura (Real-time dynamic score)
      // Base aura from ratings + activity engagement
      const ratingWeight = (data.avgRating || 0) * 1000;
      const activityWeight = data.completedSessions * 100;
      const auraScore = Math.floor(ratingWeight + activityWeight) || 500; // Default 500 for new mentors

      // Calculate Next Payout Date (15th of Every Month)
      const today = new Date();
      let payoutDate = new Date(today.getFullYear(), today.getMonth(), 15);
      if (today.getDate() >= 15) {
         payoutDate.setMonth(payoutDate.getMonth() + 1);
      }

      // Calculate Payout Progress (0 to 15 days cycle)
      const dayOfMonth = today.getDate();
      const progress = dayOfMonth <= 15 ? Math.floor((dayOfMonth / 15) * 100) : Math.floor(((dayOfMonth - 15) / 15) * 100);

      res.json({
         earnings: availableBalance, // Display withdrawable balance
         totalEarnings: data.totalEarnings,
         hours: (data.totalMinutes / 60).toFixed(1),
         sessions: data.completedSessions,
         pending: pendingRequests,
         aura: auraScore,
         withdrawn: totalWithdrawn,
         nextPayout: payoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
         payoutProgress: Math.min(progress, 100)
      });

   } catch (err) {
      console.error("Mentor stats error:", err);
      res.status(500).json({ message: "Failed to fetch stats" });
   }
};
// 📌 Request Withdrawal (Mentor Only)
export const requestWithdrawal = async (req, res) => {
   try {
      const mentorId = req.user._id;
      const { amount } = req.body;

      if (!amount || amount < 500) {
         return res.status(400).json({ message: "Minimum withdrawal amount is ₹500" });
      }

      // 1. Calculate Total Earnings from Completed Sessions
      const sessionsStats = await Session.aggregate([
         { $match: { mentor: mentorId, status: "completed" } },
         { $group: { _id: null, totalEarnings: { $sum: "$price" } } }
      ]);
      const totalEarned = sessionsStats[0]?.totalEarnings || 0;

      // 2. Calculate already Requested/Processed Withdrawals
      const withdrawalStats = await Withdrawal.aggregate([
         { $match: { mentor: mentorId, status: { $ne: "rejected" } } },
         { $group: { _id: null, totalWithdrawn: { $sum: "$amount" } } }
      ]);
      const totalWithdrawn = withdrawalStats[0]?.totalWithdrawn || 0;

      // 3. Check Available Balance
      const availableBalance = totalEarned - totalWithdrawn;

      if (amount > availableBalance) {
         return res.status(400).json({ message: `Insufficient balance. Available: ₹${availableBalance}` });
      }

      // 4. Create Withdrawal Request
      const withdrawal = await Withdrawal.create({
         mentor: mentorId,
         amount,
         status: "pending"
      });

      // 5. Notify Mentor
      await notifyUser({
         userId: mentorId,
         email: req.user.email,
         title: "Withdrawal Requested",
         message: `Your request for ₹${amount} is being processed.`,
         type: "payout",
         emailEnabled: true,
         emailSubject: "Withdrawal Request Received - OneStop",
         emailHtml: `<p>We have received your withdrawal request for <strong>₹${amount}</strong>. Our team will verify your Aura compliance and process it within 3-5 business days.</p>`
      });

      // 6. Log Audit
      await AuditLog.record({
         action: "WITHDRAWAL_REQUEST",
         performedBy: mentorId,
         details: `${req.user.name} initiated a Quantum Withdrawal for ₹${amount}.`
      });

      res.status(201).json({ message: "Withdrawal request submitted! ✅", withdrawal, availableBalance: availableBalance - amount });

   } catch (err) {
      console.error("Withdrawal error:", err);
      res.status(500).json({ message: "Failed to process withdrawal request" });
   }
};

// 📌 Get Withdrawal History (Mentor Only)
export const getMyWithdrawals = async (req, res) => {
   try {
      const withdrawals = await Withdrawal.find({ mentor: req.user._id }).sort({ createdAt: -1 });
      res.json(withdrawals);
   } catch (err) {
      console.error("Get withdrawals error:", err);
      res.status(500).json({ message: "Failed to fetch withdrawal history" });
   }
};

