/**
 * Manual Test Script for Lesson Generation
 *
 * Tests the lesson generator with current reflection data
 */

import { generateLessons } from "./src/learning/lessons/lessonGenerator";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";

const logger = createPinoLogger({
  name: "test-lesson-gen",
  level: "info"
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

async function checkReflectionData() {
  console.log("\n========================================");
  console.log("📊 Checking Reflection Data");
  console.log("========================================\n");

  // Check total reflections
  const totalResult = await dbClient.execute({
    sql: "SELECT COUNT(*) as count FROM trading_reflections",
    args: [],
  });
  console.log(`Total reflections: ${totalResult.rows[0].count}`);

  // Check reflections with feedback
  const feedbackResult = await dbClient.execute({
    sql: "SELECT COUNT(*) as count FROM trading_reflections WHERE feedback_score IS NOT NULL",
    args: [],
  });
  console.log(`Reflections with feedback: ${feedbackResult.rows[0].count}`);

  // Check reflections with close data
  const closeDataResult = await dbClient.execute({
    sql: "SELECT COUNT(*) as count FROM trading_reflections WHERE close_price IS NOT NULL",
    args: [],
  });
  console.log(`Reflections with close data: ${closeDataResult.rows[0].count}`);

  // Check a sample reflection
  const sampleResult = await dbClient.execute({
    sql: `SELECT symbol, feedback_score, close_price, close_reason,
          decision_indicators, close_indicators
          FROM trading_reflections
          WHERE feedback_score IS NOT NULL
          LIMIT 1`,
    args: [],
  });

  if (sampleResult.rows.length > 0) {
    console.log("\n📋 Sample Reflection:");
    const sample = sampleResult.rows[0] as any;
    console.log(`  Symbol: ${sample.symbol}`);
    console.log(`  Feedback Score: ${sample.feedback_score}`);
    console.log(`  Close Price: ${sample.close_price || 'N/A'}`);
    console.log(`  Close Reason: ${sample.close_reason || 'N/A'}`);
    console.log(`  Has Decision Indicators: ${sample.decision_indicators ? 'Yes' : 'No'}`);
    console.log(`  Has Close Indicators: ${sample.close_indicators ? 'Yes' : 'No'}`);
  }

  // Check existing lessons
  const lessonsResult = await dbClient.execute({
    sql: "SELECT COUNT(*) as count FROM learned_lessons",
    args: [],
  });
  console.log(`\nExisting lessons: ${lessonsResult.rows[0].count}`);
}

async function testLessonGeneration() {
  console.log("\n========================================");
  console.log("🧠 Testing Lesson Generation");
  console.log("========================================\n");

  try {
    const count = await generateLessons(logger);

    console.log("\n========================================");
    console.log(`✅ Lesson Generation Complete`);
    console.log(`Generated ${count} new lesson(s)`);
    console.log("========================================\n");

    if (count > 0) {
      // Show the new lessons
      const lessonsResult = await dbClient.execute({
        sql: `SELECT id, lesson_category, lesson_text, success_rate,
              confidence_level, applicable_symbols
              FROM learned_lessons
              ORDER BY id DESC
              LIMIT ${count}`,
        args: [],
      });

      console.log("\n📚 New Lessons:\n");
      for (const lesson of lessonsResult.rows) {
        const l = lesson as any;
        console.log(`[#${l.id}] ${l.lesson_category.toUpperCase()}`);
        console.log(`  Symbols: ${l.applicable_symbols}`);
        console.log(`  Confidence: ${l.confidence_level}`);
        console.log(`  Success Rate: ${l.success_rate?.toFixed(1)}%`);
        console.log(`  Lesson: ${l.lesson_text}`);
        console.log("");
      }
    }

  } catch (error: any) {
    console.error("\n❌ Lesson Generation Failed:");
    console.error(error.message);
    console.error(error.stack);
  }
}

async function main() {
  console.log("\n🚀 Starting Lesson Generation Test\n");

  await checkReflectionData();
  await testLessonGeneration();

  console.log("\n✅ Test Complete\n");
  process.exit(0);
}

main().catch((error) => {
  console.error("\n💥 Fatal Error:", error);
  process.exit(1);
});
