import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";

import {
  getOverview,
  listJobs,
  listJobApplications,
  updateApplicationStatus,
  getProfile,
  updateProfile,
  listNotifications,
  listAllApplications,
  getApplication
} from "../controllers/rpanelController.js";
import { sendHiringAssessment, resetHiringAssessment } from "../controllers/hiringAssessmentController.js";

const router = express.Router();

/* ============================
   Dashboard Overview
=============================== */
router.get(
  "/overview",
  protect,
  authorize(["recruiter"]),
  getOverview
);

/* ============================
   Jobs List
=============================== */
router.get(
  "/jobs",
  protect,
  authorize(["recruiter"]),
  listJobs
);

/* ============================
   Applications for a Job
=============================== */
router.get(
  "/jobs/:jobId/applications",
  protect,
  authorize(["recruiter"]),
  listJobApplications
);

/* ============================
   All Applications
=============================== */
router.get(
  "/applications",
  protect,
  authorize(["recruiter"]),
  listAllApplications
);

/* ============================
   Get Single Application
 =============================== */
router.get(
  "/applications/:applicationId",
  protect,
  authorize(["recruiter"]),
  getApplication
);
/* ============================
   Update Application Status
=============================== */
router.patch(
  "/applications/:applicationId/status",
  protect,
  authorize(["recruiter"]),
  updateApplicationStatus
);

/* ============================
   Send Hiring Assessment
=============================== */
router.post(
  "/applications/:applicationId/assessment/send",
  protect,
  authorize(["recruiter"]),
  sendHiringAssessment
);

/* ============================
   Reset Hiring Assessment
=============================== */
router.post(
  "/applications/:applicationId/assessment/reset",
  protect,
  authorize(["recruiter"]),
  resetHiringAssessment
);

/* ============================
   Recruiter Profile (GET)
=============================== */
router.get(
  "/profile",
  protect,
  authorize(["recruiter"]),
  getProfile
);

/* ============================
   Recruiter Profile (PATCH)
=============================== */
router.patch(
  "/profile",
  protect,
  authorize(["recruiter"]),
  updateProfile
);


export default router;
