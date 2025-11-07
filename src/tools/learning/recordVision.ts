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
 * Record Trading Vision Tool
 *
 * Allows the trading LLM to record its predictions with confidence scores
 * before executing trades. This enables meta-learning by tracking accuracy
 * and extracting lessons from outcomes.
 */

import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { createExchangeClient } from "../../services/exchange";

const logger = createPinoLogger({
  name: "record-vision-tool",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * Record Trading Vision Tool
 *
 * Records the LLM's prediction before executing a trade decision.
 * This creates a "reflection" that will be scored later based on actual outcomes.
 */
export const recordTradingVisionTool = createTool({
  name: "recordTradingVision",
  description: `Record your trading prediction and confidence BEFORE executing the trade.
This allows the system to learn from your predictions by comparing them to actual outcomes.

Use this tool when you have a strong conviction about a price movement and are about to:
- Open a new position (long or short)
- Close an existing position
- Add to a position

The system will automatically score your prediction accuracy 10-60 minutes later.`,

  parameters: z.object({
    symbol: z.string().describe("Trading symbol (e.g., 'BTC', 'ETH')"),

    vision: z.string().describe(
      "Your specific prediction about price movement. Be precise and quantitative. " +
      "Example: 'BTC will rise 0.8% in next 10min due to RSI recovery + volume spike'"
    ),

    confidence: z.number().min(1).max(10).describe(
      "Your confidence level in this prediction (1-10). " +
      "10 = extremely confident, 5 = moderate, 1 = low confidence"
    ),

    decision: z.enum(["open_long", "open_short", "close", "hold", "add"]).describe(
      "The trading action you're about to take"
    ),

    reasoning: z.string().describe(
      "Detailed reasoning for this decision. Include key indicators, patterns, " +
      "and market conditions that support your vision."
    ),

    targetPrice: z.number().optional().describe(
      "Expected price target. Used to calculate prediction accuracy."
    ),

    predictionTimeframe: z.enum(["10m", "30m", "1h", "4h"]).default("10m").describe(
      "Time horizon for your prediction"
    ),

    orderId: z.string().optional().describe(
      "Order ID if you've already placed an order"
    ),
  }),

  execute: async ({
    symbol,
    vision,
    confidence,
    decision,
    reasoning,
    targetPrice,
    predictionTimeframe,
    orderId
  }) => {
    try {
      // Check if learning is enabled
      const learningEnabled = await dbClient.execute({
        sql: "SELECT value FROM system_config WHERE key = 'learning_enabled'",
        args: [],
      });

      if (learningEnabled.rows.length === 0 || learningEnabled.rows[0].value !== '1') {
        return {
          success: false,
          message: "❌ AI Learning is disabled. Enable it in the UI to record visions.",
          recorded: false,
        };
      }

      // Get current price
      const exchangeClient = createExchangeClient();
      const ticker = await exchangeClient.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;

      // Insert reflection into database
      const result = await dbClient.execute({
        sql: `INSERT INTO trading_reflections (
          timestamp, symbol, decision_type, vision, confidence_score,
          reasoning, price_at_decision, target_price, prediction_timeframe,
          order_id, reviewed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [
          new Date().toISOString(),
          symbol,
          decision,
          vision,
          confidence,
          reasoning,
          currentPrice,
          targetPrice || null,
          predictionTimeframe,
          orderId || null,
        ],
      });

      const reflectionId = result.lastInsertRowid;

      logger.info(`📝 Trading vision recorded: ${symbol} - ${decision} - Confidence: ${confidence}/10`);
      logger.info(`   Vision: ${vision}`);
      logger.info(`   Current price: $${currentPrice}, Target: $${targetPrice || 'N/A'}`);

      return {
        success: true,
        message: `✅ Vision recorded (ID: ${reflectionId}). Your prediction will be scored in ${predictionTimeframe}.`,
        reflectionId: Number(reflectionId),
        recorded: true,
        details: {
          symbol,
          vision,
          confidence,
          currentPrice,
          targetPrice,
          timeframe: predictionTimeframe,
        },
      };

    } catch (error: any) {
      logger.error("Failed to record trading vision:", error);
      return {
        success: false,
        message: `❌ Failed to record vision: ${error.message}`,
        recorded: false,
      };
    }
  },
});
