import Job from "../models/Job.js";
import { fetchJobicyJobs } from "./platforms/jobicy.js";
import { fetchRemoteOKJobs } from "./platforms/remoteok.js";
import { fetchArbeitNowJobs } from "./platforms/arbeitnow.js";
import { fetchUnstopJobs } from "./platforms/unstop.js";
import { fetchRemotiveJobs } from "./platforms/remotive.js";

// @desc    Get all active jobs from DB (Filtered by type)
export const getJobs = async (type) => {
    // Build query
    let query = { status: { $in: ['active', 'approved'] } };

    if (type === 'internal') {
        // Internal jobs: source is 'OneStop' OR source is missing (legacy data)
        query.$or = [{ source: 'OneStop' }, { source: { $exists: false } }];
    } else if (type === 'external') {
        // External jobs: source exists AND is NOT 'OneStop'
        query.source = { $ne: 'OneStop', $exists: true };
    }
    // If type is 'all' or undefined, we just fetch all DB jobs first

    // Fetch only active/approved jobs
    // Sort by newest first
    const dbJobs = await Job.find(query)
        .populate("postedBy", "orgName avatar")
        .sort({ createdAt: -1 });

    const formattedDbJobs = dbJobs.map(job => ({
        ...job.toObject(),
        id: job._id, // Ensure frontend compatibility
        company: job.recruiter?.orgName || "Top Company", 
        logo: job.recruiter?.avatar || "", 
        isNew: (new Date() - new Date(job.createdAt)) < (7 * 24 * 60 * 60 * 1000) // New if < 7 days
    }));

    // If type is 'external' or 'all' (undefined), fetch APIs
    if (type === 'external' || !type || type === 'all') {
        try {
            const [jobicy, remoteok, arbeitnow, unstop, remotive] = await Promise.all([
                fetchJobicyJobs(), 
                fetchRemoteOKJobs(),
                fetchArbeitNowJobs(),
                fetchUnstopJobs(),
                fetchRemotiveJobs()
            ]);
            
            // Merge DB jobs with API jobs
            // Note: If type was 'all', formattedDbJobs includes internal jobs too
            // If type was 'external', formattedDbJobs only has external DB jobs
            const allJobs = [...formattedDbJobs, ...jobicy, ...remoteok, ...arbeitnow, ...unstop, ...remotive];
            
            // Sort by date key (createdAt or posted)
            // External jobs usually have 'createdAt' or 'pubDate' mapped to 'createdAt'
            return allJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch (error) {
            console.error("Error fetching external jobs:", error);
            // Fallback to just DB jobs if external APIs fail
            return formattedDbJobs;
        }
    }

    return formattedDbJobs;
}

// @desc    Get internships (filtered by type)
export const getInternships = async () => {
    const internships = await Job.find({ type: 'Internship', status: { $in: ['active', 'approved'] } })
        .populate("postedBy", "orgName avatar")
        .sort({ createdAt: -1 });

    return internships.map(job => ({
        ...job.toObject(),
        id: job._id,
        company: job.recruiter?.orgName || "Top Company",
        logo: job.recruiter?.avatar || "",
        isNew: (new Date() - new Date(job.createdAt)) < (7 * 24 * 60 * 60 * 1000)
    }));
}

// @desc    Find single job by ID
export const findJobById = async (id) => {
    try {
        const job = await Job.findById(id).populate("postedBy", "orgName avatar email");
        if (!job) return null;
        
        return {
            ...job.toObject(),
            id: job._id,
            company: job.recruiter?.orgName || "Top Company",
            logo: job.recruiter?.avatar || "",
            recruiter: job.postedBy // Ensure recruiter details are passed
        };
    } catch (error) {
        return null;
    }
}
// @desc    Find jobs by Recruiter ID
export const getJobsByRecruiter = async (recruiterId) => {
    try {
        const jobs = await Job.find({ postedBy: recruiterId, status: { $in: ['active', 'approved'] } })
            .populate("postedBy", "orgName avatar")
            .sort({ createdAt: -1 });

        return jobs.map(job => ({
            ...job.toObject(),
            id: job._id,
            company: job.recruiter?.orgName || "Top Company",
            logo: job.recruiter?.avatar || "",
            isNew: (new Date() - new Date(job.createdAt)) < (7 * 24 * 60 * 60 * 1000)
        }));
    } catch (error) {
        return [];
    }
}
