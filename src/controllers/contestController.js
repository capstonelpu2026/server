import { getContests, getHackathons } from '../services/contestService.js';
import { getAggregatedChallenges } from '../services/challengesService.js';
import DailyChallenge from '../models/DailyChallenge.js';
import asyncHandler from 'express-async-handler';

// @desc    Get all active/upcoming contests
// @route   GET /api/contests
// @access  Public
export const getContestsList = asyncHandler(async (req, res) => {
  const contests = await getContests();
  res.json(contests);
});

// @desc    Get all hackathons
// @route   GET /api/hackathons
// @access  Public
export const getHackathonsList = asyncHandler(async (req, res) => {
  const hackathons = await getHackathons();
  res.json(hackathons);
});

// @desc    Get all challenges (POTD)
// @route   GET /api/challenges
// @access  Public
export const getChallengesList = asyncHandler(async (req, res) => {
  const challenges = await getAggregatedChallenges();
  
  if (req.user && req.user.arenaStats?.solvedChallengesList) {
    const solvedData = req.user.arenaStats.solvedChallengesList;
    const processed = challenges.map(c => {
      const solvedEntry = solvedData.find(item => item.challengeId === String(c.id));
      return {
        ...c,
        isCompleted: !!solvedEntry,
        score: solvedEntry ? solvedEntry.score : null,
        feedback: solvedEntry ? solvedEntry.feedback : null,
        complexity: solvedEntry ? solvedEntry.complexity : null,
        testCases: solvedEntry ? solvedEntry.testCases : null
      };
    });
    return res.json(processed);
  }
  
  res.json(challenges);
});
// @desc    Get single challenge by ID
// @route   GET /api/challenges/:id
// @access  Public
export const getChallengeDetail = asyncHandler(async (req, res) => {
  const challenge = await DailyChallenge.findById(req.params.id);
  
  if (challenge) {
    const formatted = challenge.toObject();
    if (!formatted.constraints) formatted.constraints = ["Optimized time complexity", "Standard memory constraints"];
    
    // Check if current user has solved this
    if (req.user && req.user.arenaStats?.solvedChallengesList) {
      const solvedEntry = req.user.arenaStats.solvedChallengesList.find(item => String(item.challengeId) === String(req.params.id));
      if (solvedEntry) {
        formatted.isCompleted = true;
        formatted.score = solvedEntry.score;
        formatted.feedback = solvedEntry.feedback;
        formatted.complexity = solvedEntry.complexity;
        formatted.testCases = solvedEntry.testCases;
      }
    }

    return res.json(formatted);
  }
  res.status(404).json({ message: "Challenge not found" });
});
