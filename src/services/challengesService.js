import axios from "axios";
import DailyChallenge from "../models/DailyChallenge.js";
import { generateOneStopDailyChallenge } from "../cron/dailyChallengeCron.js";

// OneStop AI Original
export const fetchOneStopDaily = async () => {
    try {
        const today = new Date();
        today.setHours(0,0,0,0);
        
        let q = await DailyChallenge.findOne({ date: { $gte: today } }).lean();
        
        // Dynamic Generation: If no challenge found for today, generate one in real-time
        if(!q) {
            console.log("🧩 Generating fresh Daily Challenge for today...");
            await generateOneStopDailyChallenge();
            q = await DailyChallenge.findOne({ date: { $gte: today } }).lean();
        }

        // If still no q (AI failed), use static fallback as last resort
        if(!q) {
            return {
                id: "onestop_gen_" + today.getTime(),
                name: "Neural Algorithmic Challenge",
                description: "Master today's logic puzzle to maintain your Elite Streak.",
                url: "/code-arena",
                platform: "OneStop AI",
                status: "ACTIVE",
                date: today,
                prize: "50 XP",
                difficulty: "Medium",
                type: "DSA"
            };
        }

        return {
            id: q._id.toString(),
            name: q.title,
            description: q.description,
            url: q.problemUrl || "/code-arena?challengeId=" + q._id,
            platform: "OneStop AI",
            status: "ACTIVE",
            date: q.date,
            prize: q.points + " XP",
            difficulty: q.difficulty,
            type: q.type
        };
    } catch (e) {
        console.error("Error fetching OneStop Daily:", e);
        return null;
    }
};

// CodeChef Daily
export const fetchCodeChefDaily = async () => {
    try {
        return {
            id: `cc_potd_${new Date().toISOString().split('T')[0]}`,
            name: "CodeChef Daily Practice",
            url: "https://www.codechef.com/practice",
            platform: "CodeChef",
            status: "ACTIVE",
            prize: "XP Bonus"
        };
    } catch (error) {
        return null;
    }
};

// Codeforces Daily 
export const fetchCodeforcesDaily = async () => {
    try {
        return {
            id: `cf_potd_${new Date().toISOString().split('T')[0]}`,
            name: "Top Sorted Challenge",
            url: "https://codeforces.com/problemset?order=BY_SOLVED_DESC",
            platform: "Codeforces",
            status: "ACTIVE",
            prize: "Rating"
        };
    } catch (error) {
        return null;
    }
};

// LeetCode POTD
export const fetchLeetCodePOTD = async () => {
    const query = {
        operationName: "activeDailyCodingChallengeQuestion",
        variables: {},
        query: `
        query activeDailyCodingChallengeQuestion {
            activeDailyCodingChallengeQuestion {
                link
                date
                question {
                    title
                }
            }
        }
    `
    };

    try {
        const { data } = await axios.post('https://leetcode.com/graphql', query);
        const q = data?.data?.activeDailyCodingChallengeQuestion;
        
        if(!q) return null;

        return {
            id: `lc_potd_${q.date}`,
            name: q.question?.title || "LeetCode Daily Challenge",
            url: "https://leetcode.com" + q.link,
            platform: "LeetCode",
            status: "ACTIVE",
            date: q.date,
            prize: "Daily Streak"
        };
    } catch (error) {
        console.error("Error fetching LeetCode POTD:", error);
        return null;
    }
};

// GFG POTD
export const fetchGFGPOTD = async () => {
    try {
        // API from potdController
        const { data } = await axios.get('https://practiceapi.geeksforgeeks.org/api/vr/problems-of-day/problem/today');
        
        return {
            id: `gfg_potd_${new Date().toISOString().split('T')[0]}`,
            name: data.problem_name,
            url: data.problem_url,
            platform: "GeeksForGeeks",
            status: "ACTIVE",
            prize: "GeekBits"
        };
    } catch (error) {
        console.error("Error fetching GFG POTD:", error);
        return null;
    }
};

export const getAggregatedChallenges = async () => {
    try {
        const [lc, gfg, ai, cc, cf] = await Promise.allSettled([
            fetchLeetCodePOTD(),
            fetchGFGPOTD(),
            fetchOneStopDaily(),
            fetchCodeChefDaily(),
            fetchCodeforcesDaily()
        ]);
        
        const challenges = [];
        if (ai.status === 'fulfilled' && ai.value) challenges.push(ai.value);
        if (lc.status === 'fulfilled' && lc.value) challenges.push(lc.value);
        if (cc.status === 'fulfilled' && cc.value) challenges.push(cc.value);
        if (cf.status === 'fulfilled' && cf.value) challenges.push(cf.value);
        if (gfg.status === 'fulfilled' && gfg.value) {
            challenges.push({
                ...gfg.value,
                date: new Date().toISOString()
            });
        }
        
        return challenges;
    } catch (e) {
        return [];
    }
}
