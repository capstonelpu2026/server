import express from "express";
import { getPlatformPulse, getPlatformStats, getTopTalent } from "../controllers/platformController.js";

const router = express.Router();

router.get("/pulse", getPlatformPulse);
router.get("/stats", getPlatformStats);
router.get("/top-talent", getTopTalent);

export default router;
