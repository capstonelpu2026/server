import Job from "../models/Job.js";

// @desc    Get all active jobs from DB (Filtered by type)
export const getJobs = async (type) => {
    // Build query
    let query = { status: { $in: ['active', 'approved'] } };

    // After removing external market place, all jobs from DB are viewed as internal
    // However, if we still want to filter by source 'OneStop':
    if (type === 'internal' || !type || type === 'all' || type === 'external') {
        // We only care about internal jobs now. External type will return nothing or internal jobs.
        // For safety, let's just force internal if they asked to remove external.
        query.$or = [{ source: 'OneStop' }, { source: { $exists: false } }];
    }

    // Fetch only active/approved internal jobs
    const dbJobs = await Job.find(query)
        .populate("postedBy", "orgName avatar")
        .sort({ createdAt: -1 });

    const formattedDbJobs = dbJobs.map(job => ({
        ...job.toObject(),
        id: job._id, // Ensure frontend compatibility
        company: job.postedBy?.orgName || "Top Company", 
        logo: job.postedBy?.avatar || "", 
        isNew: (new Date() - new Date(job.createdAt)) < (7 * 24 * 60 * 60 * 1000) // New if < 7 days
    }));

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
        company: job.postedBy?.orgName || "Top Company",
        logo: job.postedBy?.avatar || "",
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
            company: job.postedBy?.orgName || "Top Company",
            logo: job.postedBy?.avatar || "",
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
            company: job.postedBy?.orgName || "Top Company",
            logo: job.postedBy?.avatar || "",
            isNew: (new Date() - new Date(job.createdAt)) < (7 * 24 * 60 * 60 * 1000)
        }));
    } catch (error) {
        return [];
    }
}
