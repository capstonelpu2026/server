import dotenv from "dotenv";
dotenv.config();

import connectDB from "./src/db.js";
import { generateDailyAIContest } from "./src/cron/aiContestCron.js";

const run = async () => {
  try {
    console.log("Connecting to DB...");
    await connectDB();
    console.log("DB connected. Triggering AI Contest Generator...");
    await generateDailyAIContest();
    console.log("Done.");
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
};

run();
