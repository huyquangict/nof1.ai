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
 * Lesson Generator
 *
 * Uses a reasoner LLM (e.g., DeepSeek Reasoner) to analyze trading reflections
 * and extract actionable lessons from patterns in winning vs losing predictions.
 *
 * Refactored to use VoltAgent's Agent system for consistency with trading agent.
 */

import { Agent } from "@voltagent/core";
import { createOpenAI } from "@ai-sdk/openai";
import type { Logger } from "@voltagent/logger";
import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export interface ParsedLesson {
  category: string;
  symbols: string;
  text: string;
  supportingIds: string[];
}

/**
 * Generate prompt for reasoner LLM
 *
 * Creates a comprehensive analysis prompt with winning and losing reflections
 */
function generateLessonPrompt(winners: any[], losers: any[]): string {
  return `You are an expert trading analyst. Analyze these recent trading predictions and outcomes to extract actionable lessons.

📊 WINNING PREDICTIONS (Feedback Score ≥ 7):
${winners.map(w => `
Symbol: ${w.symbol}
Vision: ${w.vision}
Confidence: ${w.confidence_score}/10
Reasoning: ${w.reasoning || 'N/A'}
Target: ${w.target_price || 'N/A'}, Actual: ${w.actual_price}
Price Change: ${w.price_change_percent?.toFixed(2)}%
Feedback Score: ${w.feedback_score}/10
PnL: ${w.pnl_result ? `$${w.pnl_result.toFixed(2)}` : 'N/A'}
Outcome: ${w.outcome_type}
Reflection ID: ${w.id}
`).join('\n---\n')}

📉 LOSING PREDICTIONS (Feedback Score ≤ 4):
${losers.map(l => `
Symbol: ${l.symbol}
Vision: ${l.vision}
Confidence: ${l.confidence_score}/10
Reasoning: ${l.reasoning || 'N/A'}
Target: ${l.target_price || 'N/A'}, Actual: ${l.actual_price}
Price Change: ${l.price_change_percent?.toFixed(2)}%
Feedback Score: ${l.feedback_score}/10
PnL: ${l.pnl_result ? `$${l.pnl_result.toFixed(2)}` : 'N/A'}
Outcome: ${l.outcome_type}
Reflection ID: ${l.id}
`).join('\n---\n')}

🎯 TASK:
Extract 3-5 **specific, actionable lessons** that explain:
1. What patterns/signals led to winning predictions?
2. What patterns/signals led to losing predictions?
3. What should the AI do differently?

FORMAT EACH LESSON AS:
[CATEGORY: entry_timing|exit_timing|risk_management|symbol_behavior|market_conditions|time_of_day|funding_rate]
[SYMBOLS: BTC,ETH or "all"]
[LESSON: One concise sentence describing the pattern and recommended action]
[SUPPORTING_IDS: comma-separated IDs of reflections that support this lesson]

EXAMPLE:
[CATEGORY: entry_timing]
[SYMBOLS: BTC]
[LESSON: RSI recovery from oversold (< 30) + volume spike > 1.5x avg = 85% win rate for longs within 15min]
[SUPPORTING_IDS: 1,3,7,12]

Be specific, quantitative, and actionable. Focus on REPEATABLE patterns. Only extract lessons if you have strong evidence (3+ supporting examples).`;
}

/**
 * Parse lessons from reasoner LLM response
 *
 * Extracts structured lesson data from formatted text
 */
function parseLessonsFromResponse(text: string, logger: Logger): ParsedLesson[] {
  const lessons: ParsedLesson[] = [];

  // Split by [CATEGORY: to find lesson blocks
  const lessonBlocks = text.split('[CATEGORY:').slice(1);

  logger.info(`🔍 Found ${lessonBlocks.length} potential lesson(s) in response`);

  for (const block of lessonBlocks) {
    try {
      // Extract category
      const categoryMatch = block.match(/^([^\]]+)/);
      const category = categoryMatch ? categoryMatch[1].trim() : null;

      // Extract symbols
      const symbolsMatch = block.match(/\[SYMBOLS:\s*([^\]]+)\]/);
      const symbols = symbolsMatch ? symbolsMatch[1].trim() : 'all';

      // Extract lesson text
      const lessonMatch = block.match(/\[LESSON:\s*([^\]]+)\]/);
      const lessonText = lessonMatch ? lessonMatch[1].trim() : null;

      // Extract supporting IDs
      const idsMatch = block.match(/\[SUPPORTING_IDS:\s*([^\]]+)\]/);
      const supportingIds = idsMatch
        ? idsMatch[1].split(',').map(id => id.trim()).filter(id => id)
        : [];

      // Validate lesson has required fields
      if (category && lessonText && supportingIds.length > 0) {
        lessons.push({
          category,
          symbols,
          text: lessonText,
          supportingIds,
        });

        logger.info(`✅ Parsed lesson: [${category}] ${lessonText.substring(0, 60)}...`);
      } else {
        logger.warn(`⚠️  Skipped incomplete lesson block: category=${category}, text=${!!lessonText}, ids=${supportingIds.length}`);
      }
    } catch (error: any) {
      logger.error(`Failed to parse lesson block:`, error);
    }
  }

  return lessons;
}

/**
 * Store a lesson in the database
 *
 * Calculates success rate and other metrics from supporting reflections
 */
async function storeLessonInDB(
  lesson: ParsedLesson,
  allReflections: any[],
  logger: Logger
): Promise<number | null> {
  try {
    // Find supporting reflections
    const supportingReflections = allReflections.filter(r =>
      lesson.supportingIds.includes(r.id.toString())
    );

    if (supportingReflections.length === 0) {
      logger.warn(`No supporting reflections found for lesson, skipping`);
      return null;
    }

    // Calculate success rate
    const winnerThreshold = parseInt(process.env.LESSON_WINNER_SCORE || "7", 10);
    const successCount = supportingReflections.filter(r => r.feedback_score >= winnerThreshold).length;
    const successRate = (successCount / supportingReflections.length) * 100;

    // Calculate average PnL
    const pnlValues = supportingReflections
      .filter(r => r.pnl_result !== null)
      .map(r => parseFloat(r.pnl_result));
    const avgPnl = pnlValues.length > 0
      ? pnlValues.reduce((sum, pnl) => sum + pnl, 0) / pnlValues.length
      : 0;

    // Determine confidence level
    const highConfidenceMin = parseInt(process.env.LESSON_HIGH_CONFIDENCE_MIN || "20", 10);
    const mediumConfidenceMin = parseInt(process.env.LESSON_MEDIUM_CONFIDENCE_MIN || "10", 10);
    const confidenceLevel =
      supportingReflections.length >= highConfidenceMin ? 'high' :
      supportingReflections.length >= mediumConfidenceMin ? 'medium' : 'low';

    // Determine market condition (from most recent reflection)
    const recentReflection = supportingReflections[supportingReflections.length - 1];
    const marketCondition = recentReflection.price_change_percent > 2 ? 'bull' :
                           recentReflection.price_change_percent < -2 ? 'bear' : 'sideways';

    // Insert lesson
    const result = await dbClient.execute({
      sql: `INSERT INTO learned_lessons (
        created_at, lesson_category, lesson_text, supporting_reflections,
        success_rate, avg_pnl, confidence_level, applicable_symbols,
        market_condition, created_by_model, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [
        new Date().toISOString(),
        lesson.category,
        lesson.text,
        JSON.stringify(lesson.supportingIds),
        successRate,
        avgPnl,
        confidenceLevel,
        lesson.symbols,
        marketCondition,
        process.env.REASONER_MODEL || 'deepseek/deepseek-reasoner'
      ]
    });

    const lessonId = Number(result.lastInsertRowid);

    // Link reflections to this lesson
    for (const id of lesson.supportingIds) {
      await dbClient.execute({
        sql: `UPDATE trading_reflections SET lesson_id = ? WHERE id = ?`,
        args: [lessonId, id]
      });
    }

    logger.info(
      `💡 Stored lesson #${lessonId}: ${lesson.text.substring(0, 60)}... ` +
      `(${successRate.toFixed(0)}% success, ${supportingReflections.length} examples, ${confidenceLevel} confidence)`
    );

    return lessonId;

  } catch (error: any) {
    logger.error(`Failed to store lesson in database:`, error);
    return null;
  }
}

/**
 * Generate lessons from reflections using reasoner LLM
 *
 * Main entry point for lesson generation
 */
export async function generateLessons(logger: Logger): Promise<number> {
  try {
    logger.info("🧠 Starting lesson generation...");

    // Check if learning is enabled
    const learningEnabled = await dbClient.execute({
      sql: "SELECT value FROM system_config WHERE key = 'learning_enabled'",
      args: [],
    });

    if (learningEnabled.rows.length === 0 || learningEnabled.rows[0].value !== '1') {
      logger.info("AI Learning disabled, skipping lesson generation");
      return 0;
    }

    // Fetch recent reflections with feedback that haven't been converted to lessons
    const reflectionsResult = await dbClient.execute({
      sql: `SELECT * FROM trading_reflections
            WHERE feedback_score IS NOT NULL
              AND lesson_id IS NULL
              AND datetime(timestamp) >= datetime('now', '-7 days')
            ORDER BY timestamp DESC
            LIMIT 50`,
      args: [],
    });

    const allReflections = reflectionsResult.rows;

    // Configurable thresholds
    const minReflections = parseInt(process.env.LESSON_MIN_REFLECTIONS || "10", 10);
    const winnerThreshold = parseInt(process.env.LESSON_WINNER_SCORE || "7", 10);
    const loserThreshold = parseInt(process.env.LESSON_LOSER_SCORE || "4", 10);
    const minExamplesPerGroup = parseInt(process.env.LESSON_MIN_EXAMPLES || "3", 10);

    if (allReflections.length < minReflections) {
      logger.info(`Not enough reflections yet (need ${minReflections}+, have ${allReflections.length}), skipping...`);
      return 0;
    }

    // Group by outcome
    const winners = allReflections.filter((r: any) => r.feedback_score >= winnerThreshold);
    const losers = allReflections.filter((r: any) => r.feedback_score <= loserThreshold);

    logger.info(`📊 Analyzing ${allReflections.length} reflections (${winners.length} winners, ${losers.length} losers)`);

    if (winners.length < minExamplesPerGroup && losers.length < minExamplesPerGroup) {
      logger.info(`Not enough clear winners or losers for pattern extraction (need ${minExamplesPerGroup}+ in at least one group), skipping...`);
      return 0;
    }

    // Generate prompt
    const prompt = generateLessonPrompt(winners, losers);

    // Call reasoner LLM using VoltAgent's Agent (same as trading agent)
    logger.info("🤖 Calling reasoner LLM for pattern analysis...");

    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY || "",
      baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    });

    const modelName = process.env.REASONER_MODEL || "deepseek/deepseek-reasoner";

    // Create agent for lesson generation
    const lessonAgent = new Agent({
      name: "lesson-generator",
      instructions: "You are an expert trading analyst. Analyze the trading reflections and extract actionable lessons following the format specified in the prompt.",
      model: openai.chat(modelName),
      tools: [], // No tools needed for lesson generation
    });

    // Run the agent with the prompt
    const response = await lessonAgent.generateText(prompt);

    // Extract text from response (VoltAgent returns an object with text property)
    const responseText = typeof response === 'string' ? response : (response as any).text || '';

    logger.info(`✅ Reasoner response received (${responseText.length} characters)`);

    // Parse lessons from response
    const lessons = parseLessonsFromResponse(responseText, logger);

    if (lessons.length === 0) {
      logger.warn("No valid lessons extracted from reasoner response");
      return 0;
    }

    // Store lessons in database
    let storedCount = 0;
    for (const lesson of lessons) {
      const lessonId = await storeLessonInDB(lesson, allReflections, logger);
      if (lessonId !== null) {
        storedCount++;
      }
    }

    logger.info(`✅ Lesson generation complete: ${storedCount} lesson(s) stored`);

    return storedCount;

  } catch (error: any) {
    logger.error("Lesson generation failed:", error);
    throw error;
  }
}
