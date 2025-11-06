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
 * Feedback Scheduler - AI Learning System
 *
 * Runs every 5 minutes to:
 * - Fetch trading reflections created 10-60 minutes ago
 * - Calculate prediction accuracy and feedback scores
 * - Update database with outcomes
 *
 * This enables the AI to learn from its own predictions by comparing
 * what it predicted vs what actually happened.
 */

import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createExchangeClient } from "../services/exchange";
import {
  calculateFeedback,
  type Reflection,
} from "../learning/reflections/feedbackCalculator";

const logger = createPinoLogger({
  name: "feedback-scheduler",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

const exchangeClient = createExchangeClient();

/**
 * Update feedback for trading reflections
 *
 * Fetches reflections without feedback that are 10-60 minutes old,
 * calculates accuracy scores, and updates the database.
 */
async function updateReflectionFeedback(): Promise<void> {
  try {
    // Check if learning is enabled
    const learningEnabled = await dbClient.execute({
      sql: "SELECT value FROM system_config WHERE key = 'learning_enabled'",
      args: [],
    });

    if (learningEnabled.rows.length === 0 || learningEnabled.rows[0].value !== '1') {
      logger.debug("AI Learning disabled, skipping feedback updates");
      return;
    }

    // Get reflections without feedback (created 10-60 mins ago)
    const reflectionsResult = await dbClient.execute({
      sql: `SELECT * FROM trading_reflections
            WHERE feedback_score IS NULL
              AND datetime(timestamp) <= datetime('now', '-10 minutes')
              AND datetime(timestamp) >= datetime('now', '-60 minutes')`,
      args: [],
    });

    if (reflectionsResult.rows.length === 0) {
      logger.debug("No reflections pending feedback");
      return;
    }

    logger.info(`📊 Updating feedback for ${reflectionsResult.rows.length} reflection(s)`);

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
          `✅ ${reflection.symbol} reflection #${reflection.id}: ` +
            `Accuracy ${feedback.prediction_accuracy}/10, Score ${feedback.feedback_score}/10, ` +
            `Type: ${feedback.outcome_type}`
        );
      } catch (error: any) {
        logger.error(`Failed to update reflection ${reflection.id}:`, error);
      }
    }
  } catch (error: any) {
    logger.error("Failed to update reflection feedback:", error);
  }
}

/**
 * Start the feedback scheduler
 *
 * Runs every 5 minutes to process pending reflections
 */
export function startFeedbackScheduler() {
  logger.info("🎯 Starting Feedback Scheduler (runs every 5 minutes)");

  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    logger.info("🔄 Feedback Scheduler: Starting feedback update cycle");
    try {
      await updateReflectionFeedback();
      logger.info("✅ Feedback Scheduler: Cycle completed");
    } catch (error: any) {
      logger.error("❌ Feedback Scheduler: Cycle failed:", error);
    }
  });

  // Also run immediately on startup (after 30 seconds)
  setTimeout(async () => {
    logger.info("🚀 Feedback Scheduler: Running initial feedback check");
    try {
      await updateReflectionFeedback();
    } catch (error: any) {
      logger.error("❌ Initial feedback check failed:", error);
    }
  }, 30000);
}
