import express from 'express';
import { getContestsList, getHackathonsList, getChallengesList, getChallengeDetail } from '../controllers/contestController.js';

const router = express.Router();

router.get('/contests', getContestsList);
router.get('/hackathons', getHackathonsList);
router.get('/challenges', getChallengesList);
router.get('/challenges/:id', getChallengeDetail);

export default router;
