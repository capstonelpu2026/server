import express from 'express';
import { optionalProtect } from '../middleware/auth.js';
import { getContestsList, getHackathonsList, getChallengesList, getChallengeDetail } from '../controllers/contestController.js';

const router = express.Router();

router.get('/contests', getContestsList);
router.get('/hackathons', getHackathonsList);
router.get('/challenges', optionalProtect, getChallengesList);
router.get('/challenges/:id', optionalProtect, getChallengeDetail);

export default router;
