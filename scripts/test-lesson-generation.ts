/**
 * Test Lesson Generation Manually
 *
 * Useful for debugging why lesson generation isn't running
 */

import { createPinoLogger } from "@voltagent/logger";
import { generateLessons } from "../src/learning/lessons/lessonGenerator";

const logger = createPinoLogger({
  name: "test-lesson-gen",
  level: "info",
});

async function main() {
  logger.info("🧪 Testing lesson generation manually...");

  try {
    const lessonsGenerated = await generateLessons(logger);

    logger.info(`✅ Test complete: ${lessonsGenerated} lesson(s) generated`);

    if (lessonsGenerated === 0) {
      logger.warn("⚠️  No lessons generated - check if requirements are met:");
      logger.warn("   - Minimum 10 reflections with feedback (configurable via LESSON_MIN_REFLECTIONS)");
      logger.warn("   - At least 3 winners (score ≥ 7) OR 3 losers (score ≤ 4)");
      logger.warn("   - Learning must be enabled in system_config");
    }

  } catch (error: any) {
    logger.error("❌ Test failed:", error);
    process.exit(1);
  }
}

main();
