#!/usr/bin/env tsx
/**
 * Manually Trigger AI Learning Review Flow
 *
 * This script:
 * 1. Calculates feedback for pending reflections (ignores 10-60 min window)
 * 2. Generates lessons from reflections with feedback
 */

import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createExchangeClient } from "../src/services/exchange";
import { calculateFeedback, type Reflection } from "../src/learning/reflections/feedbackCalculator";
import { generateLessons } from "../src/learning/lessons/lessonGenerator";

const logger = createPinoLogger({
  name: "trigger-learning",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

const exchangeClient = createExchangeClient();

/**
 * Calculate feedback for ALL pending reflections (skip time window check)
 */
async function calculateAllPendingFeedback(): Promise<number> {
  try {
    // Get ALL reflections without feedback
    const reflectionsResult = await dbClient.execute({
      sql: `SELECT * FROM trading_reflections
            WHERE feedback_score IS NULL`,
      args: [],
    });

    if (reflectionsResult.rows.length === 0) {
      logger.info("📭 No reflections pending feedback");
      return 0;
    }

    logger.info(`📊 Calculating feedback for ${reflectionsResult.rows.length} reflection(s)...`);

    let updated = 0;
    for (const row of reflectionsResult.rows) {
      const reflection = row as any as Reflection;

      try {
        // Get current price
        const ticker = await exchangeClient.getFuturesTicker(reflection.symbol);
        const actualPrice = ticker.lastPrice;

        // Get PnL from trades if position was closed
        let pnlResult: number | null = null;
        if (reflection.order_id) {
          const tradeResult = await dbClient.execute({
            sql: `SELECT pnl FROM trades
                  WHERE (order_id = ? OR entry_order_id = ?)
                    AND type = 'close'
                  LIMIT 1`,
            args: [reflection.order_id, reflection.order_id],
          });

          if (tradeResult.rows.length > 0) {
            pnlResult = parseFloat((tradeResult.rows[0] as any).pnl);
          }
        }

        // Calculate feedback
        const feedback = calculateFeedback(reflection, actualPrice, pnlResult, logger);

        // Update reflection in database
        await dbClient.execute({
          sql: `UPDATE trading_reflections SET
                actual_price = ?,
                price_change_percent = ?,
                prediction_accuracy = ?,
                feedback_score = ?,
                pnl_result = ?,
                outcome_type = ?,
                time_to_feedback_minutes = ?,
                reviewed = 1
                WHERE id = ?`,
          args: [
            feedback.actual_price,
            feedback.price_change_percent,
            feedback.prediction_accuracy,
            feedback.feedback_score,
            pnlResult,
            feedback.outcome_type,
            feedback.time_to_feedback_minutes,
            reflection.id,
          ],
        });

        logger.info(
          `  ✅ ${reflection.symbol} #${reflection.id}: ` +
            `Accuracy ${feedback.prediction_accuracy}/10, Score ${feedback.feedback_score}/10, ` +
            `Outcome: ${feedback.outcome_type}, ` +
            `Price: ${reflection.price_at_decision.toFixed(4)} → ${actualPrice.toFixed(4)} (${feedback.price_change_percent.toFixed(2)}%)`
        );

        updated++;
      } catch (error: any) {
        logger.error(`  ❌ Failed to update reflection ${reflection.id}:`, error.message);
      }
    }

    return updated;
  } catch (error: any) {
    logger.error("Failed to calculate feedback:", error);
    return 0;
  }
}

async function main() {
  try {
    logger.info("🧪 ============================================");
    logger.info("🧪 MANUAL TRIGGER: AI Learning Review Flow");
    logger.info("🧪 ============================================");
    logger.info("");

    // Step 1: Calculate feedback
    logger.info("📊 STEP 1: Calculate Feedback for Reflections");
    logger.info("─────────────────────────────────────────────");
    const feedbackCount = await calculateAllPendingFeedback();
    logger.info("");

    if (feedbackCount > 0) {
      logger.info(`✅ Updated feedback for ${feedbackCount} reflection(s)`);
    } else {
      logger.info("ℹ️  No pending reflections to process");
    }

    logger.info("");
    logger.info("─────────────────────────────────────────────");
    logger.info("");

    // Step 2: Generate lessons
    logger.info("🧠 STEP 2: Generate Lessons from Patterns");
    logger.info("─────────────────────────────────────────────");
    const lessonsGenerated = await generateLessons(logger);
    logger.info("");

    if (lessonsGenerated > 0) {
      logger.info(`✅ Generated ${lessonsGenerated} new lesson(s)`);
    } else {
      logger.info("ℹ️  No lessons generated");
      logger.info("   Requirement: 10+ reflections with feedback_score");
    }

    logger.info("");
    logger.info("🧪 ============================================");
    logger.info("🧪 Learning Flow Trigger Complete!");
    logger.info("🧪 ============================================");

  } catch (error: any) {
    logger.error("❌ Learning flow trigger failed:", error);
    process.exit(1);
  }
}

main();
