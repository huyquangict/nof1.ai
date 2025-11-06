/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Lesson Scheduler - AI Learning System
 *
 * Runs every 2 hours to:
 * - Fetch reflections with feedback that haven't been analyzed
 * - Call reasoner LLM to extract patterns and lessons
 * - Store lessons in database with success rates and metadata
 *
 * This is the "meta-learning" component where the AI learns from its
 * own trading history to improve future decisions.
 */

import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { generateLessons } from "../learning/lessons/lessonGenerator";

const logger = createPinoLogger({
  name: "lesson-scheduler",
  level: "info",
});

/**
 * Start the lesson generator scheduler
 *
 * Runs every 2 hours to analyze reflections and extract lessons
 */
export function startLessonScheduler() {
  logger.info("🧠 Starting Lesson Generator Scheduler (runs every 2 hours)");

  // Run every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    logger.info("🔄 Lesson Scheduler: Starting lesson generation cycle");
    try {
      const lessonsGenerated = await generateLessons(logger);

      if (lessonsGenerated > 0) {
        logger.info(`✅ Lesson Scheduler: Generated ${lessonsGenerated} new lesson(s)`);
      } else {
        logger.info("ℹ️  Lesson Scheduler: No new lessons generated (need more data)");
      }
    } catch (error: any) {
      logger.error("❌ Lesson Scheduler: Cycle failed:", error);
    }
  });

  // Run initial check after 2 minutes (give feedback scheduler time to process first)
  setTimeout(async () => {
    logger.info("🚀 Lesson Scheduler: Running initial lesson generation");
    try {
      const lessonsGenerated = await generateLessons(logger);

      if (lessonsGenerated > 0) {
        logger.info(`✅ Initial lesson generation: ${lessonsGenerated} lesson(s) created`);
      } else {
        logger.info("ℹ️  Initial lesson generation: No lessons yet (need more reflections with feedback)");
      }
    } catch (error: any) {
      logger.error("❌ Initial lesson generation failed:", error);
    }
  }, 120000); // 2 minutes
}
