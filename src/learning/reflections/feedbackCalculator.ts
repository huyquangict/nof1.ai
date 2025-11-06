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
 * Feedback Calculator
 *
 * Automatically scores the accuracy of trading predictions by comparing
 * predicted outcomes with actual market movements.
 */

import type { Logger } from "@voltagent/logger";

export interface Reflection {
  id: number;
  timestamp: string;
  symbol: string;
  decision_type: string;
  vision: string;
  confidence_score: number;
  reasoning: string;
  price_at_decision: number;
  target_price: number | null;
  prediction_timeframe: string;
  order_id: string | null;
}

export interface FeedbackResult {
  actual_price: number;
  price_change_percent: number;
  prediction_accuracy: number;
  feedback_score: number;
  outcome_type: string;
  time_to_feedback_minutes: number;
}

/**
 * Calculate prediction accuracy (0-10)
 *
 * Compares target price vs actual price to determine how close the prediction was.
 */
export function calculatePredictionAccuracy(
  reflection: Reflection,
  actualPrice: number
): number {
  if (!reflection.target_price) {
    // If no target price, use directional accuracy only
    return 5; // Neutral score
  }

  const expectedChange = reflection.target_price - reflection.price_at_decision;
  const actualChange = actualPrice - reflection.price_at_decision;

  // If both are zero or very small, neutral
  if (Math.abs(expectedChange) < 0.001 && Math.abs(actualChange) < 0.001) {
    return 5;
  }

  // Calculate accuracy: perfect prediction = 10, opposite = 0
  const accuracy = Math.max(
    0,
    Math.min(
      10,
      10 * (1 - Math.abs(expectedChange - actualChange) / Math.abs(expectedChange))
    )
  );

  return Math.round(accuracy);
}

/**
 * Calculate feedback score (1-10)
 *
 * Weighted scoring based on:
 * - Price prediction accuracy (40%)
 * - PnL outcome (30%)
 * - Directional correctness (30%)
 */
export function calculateFeedbackScore(
  reflection: Reflection,
  actualPrice: number,
  pnlResult: number | null
): number {
  let score = 5; // Start neutral

  // 1. Price prediction accuracy (±40%)
  if (reflection.target_price && reflection.decision_type.includes("open")) {
    const priceDiff = Math.abs(actualPrice - reflection.target_price);
    const priceAccuracy = 1 - priceDiff / reflection.price_at_decision;
    score += Math.max(-4, Math.min(4, priceAccuracy * 4));
  }

  // 2. PnL outcome (±30%)
  if (pnlResult !== null) {
    if (pnlResult > 0) {
      score += Math.min(pnlResult / 20, 3); // Cap at +3
    } else {
      score += Math.max(pnlResult / 20, -3); // Cap at -3
    }
  }

  // 3. Directional correctness (±30%)
  const expectedDirection = reflection.decision_type.includes("long") ? 1 : -1;
  const priceChangePercent =
    ((actualPrice - reflection.price_at_decision) / reflection.price_at_decision) * 100;
  const actualDirection = priceChangePercent > 0 ? 1 : -1;

  if (reflection.decision_type.includes("open")) {
    if (expectedDirection === actualDirection) {
      score += 3;
    } else {
      score -= 3;
    }
  }

  return Math.max(1, Math.min(10, Math.round(score)));
}

/**
 * Determine outcome type based on price change and PnL
 */
export function determineOutcomeType(
  priceChangePercent: number,
  pnlResult: number | null
): string {
  if (pnlResult === null) return "neutral";

  if (pnlResult > 50) return "big_win";
  if (pnlResult > 10) return "small_win";
  if (pnlResult > -10) return "neutral";
  if (pnlResult > -50) return "small_loss";
  return "big_loss";
}

/**
 * Calculate complete feedback for a reflection
 */
export function calculateFeedback(
  reflection: Reflection,
  actualPrice: number,
  pnlResult: number | null,
  logger?: Logger
): FeedbackResult {
  const priceChangePercent =
    ((actualPrice - reflection.price_at_decision) / reflection.price_at_decision) * 100;

  const predictionAccuracy = calculatePredictionAccuracy(reflection, actualPrice);
  const feedbackScore = calculateFeedbackScore(reflection, actualPrice, pnlResult);
  const outcomeType = determineOutcomeType(priceChangePercent, pnlResult);

  const timeToFeedbackMinutes =
    (Date.now() - new Date(reflection.timestamp).getTime()) / 60000;

  if (logger) {
    logger.info(
      `📊 Feedback calculated for ${reflection.symbol}: ` +
        `Accuracy: ${predictionAccuracy}/10, Score: ${feedbackScore}/10, Type: ${outcomeType}`
    );
  }

  return {
    actual_price: actualPrice,
    price_change_percent: priceChangePercent,
    prediction_accuracy: predictionAccuracy,
    feedback_score: feedbackScore,
    outcome_type: outcomeType,
    time_to_feedback_minutes: Math.round(timeToFeedbackMinutes),
  };
}
