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
 * Migration: Add AI Learning System Tables
 *
 * Creates tables for:
 * - trading_reflections: LLM predictions and outcomes
 * - learned_lessons: Extracted patterns from reasoner
 * - lesson_applications: Effectiveness tracking
 */

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "migration-ai-learning",
  level: "info",
});

export const AI_LEARNING_TABLES_SQL = `
-- Trading reflections (predictions + outcomes)
CREATE TABLE IF NOT EXISTS trading_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decision_type TEXT NOT NULL,      -- open_long, open_short, close, hold, add
  vision TEXT NOT NULL,              -- What LLM predicted
  confidence_score INTEGER NOT NULL CHECK(confidence_score >= 1 AND confidence_score <= 10),
  reasoning TEXT,                    -- Why this decision
  price_at_decision REAL NOT NULL,
  target_price REAL,
  prediction_timeframe TEXT,         -- 10m, 30m, 1h
  order_id TEXT,

  -- Feedback (filled 10-60 mins later)
  actual_price REAL,
  price_change_percent REAL,
  prediction_accuracy INTEGER CHECK(prediction_accuracy >= 0 AND prediction_accuracy <= 10),
  feedback_score INTEGER CHECK(feedback_score >= 1 AND feedback_score <= 10),
  pnl_result REAL,
  outcome_type TEXT,                 -- big_win, small_win, neutral, small_loss, big_loss
  time_to_feedback_minutes INTEGER,

  lesson_id INTEGER,
  reviewed INTEGER DEFAULT 0,

  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id)
);

-- Indexes for trading_reflections
CREATE INDEX IF NOT EXISTS idx_reflections_symbol ON trading_reflections(symbol);
CREATE INDEX IF NOT EXISTS idx_reflections_timestamp ON trading_reflections(timestamp);
CREATE INDEX IF NOT EXISTS idx_reflections_feedback ON trading_reflections(feedback_score);
CREATE INDEX IF NOT EXISTS idx_reflections_reviewed ON trading_reflections(reviewed);
CREATE INDEX IF NOT EXISTS idx_reflections_lesson ON trading_reflections(lesson_id);

-- Learned lessons (extracted by reasoner)
CREATE TABLE IF NOT EXISTS learned_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  lesson_category TEXT NOT NULL CHECK(lesson_category IN (
    'entry_timing', 'exit_timing', 'risk_management',
    'symbol_behavior', 'market_conditions', 'time_of_day', 'funding_rate'
  )),
  lesson_text TEXT NOT NULL,
  supporting_reflections TEXT,       -- JSON array of reflection IDs
  counter_examples TEXT,             -- JSON array of IDs where lesson failed

  success_rate REAL CHECK(success_rate >= 0 AND success_rate <= 100),
  avg_pnl REAL,
  confidence_level TEXT CHECK(confidence_level IN ('high', 'medium', 'low')),

  market_condition TEXT,             -- bull, bear, sideways, high_volatility
  applicable_symbols TEXT,           -- "BTC,ETH" or "all"

  times_applied INTEGER DEFAULT 0,
  times_helpful INTEGER DEFAULT 0,
  effectiveness_rate REAL,

  is_active INTEGER DEFAULT 1,
  created_by_model TEXT,
  last_validated TEXT
);

-- Indexes for learned_lessons
CREATE INDEX IF NOT EXISTS idx_lessons_category ON learned_lessons(lesson_category);
CREATE INDEX IF NOT EXISTS idx_lessons_success_rate ON learned_lessons(success_rate);
CREATE INDEX IF NOT EXISTS idx_lessons_active ON learned_lessons(is_active);
CREATE INDEX IF NOT EXISTS idx_lessons_effectiveness ON learned_lessons(effectiveness_rate);
CREATE INDEX IF NOT EXISTS idx_lessons_created_at ON learned_lessons(created_at);

-- Lesson applications (track effectiveness)
CREATE TABLE IF NOT EXISTS lesson_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  trade_reflection_id INTEGER,
  was_helpful INTEGER CHECK(was_helpful IN (0, 1)),
  pnl_impact REAL,

  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id),
  FOREIGN KEY (trade_reflection_id) REFERENCES trading_reflections(id)
);

-- Indexes for lesson_applications
CREATE INDEX IF NOT EXISTS idx_applications_lesson ON lesson_applications(lesson_id);
CREATE INDEX IF NOT EXISTS idx_applications_helpful ON lesson_applications(was_helpful);
CREATE INDEX IF NOT EXISTS idx_applications_reflection ON lesson_applications(trade_reflection_id);
CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON lesson_applications(applied_at);
`;

/**
 * Run migration
 */
export async function migrateAILearningTables() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
  });

  logger.info("🚀 Starting AI Learning Tables migration...");

  try {
    // Execute migration SQL
    const statements = AI_LEARNING_TABLES_SQL.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        await dbClient.execute(statement.trim());
      }
    }

    logger.info("✅ AI Learning Tables created successfully");

    // Add default configuration
    await dbClient.execute({
      sql: `INSERT INTO system_config (key, value, updated_at)
            VALUES ('learning_enabled', '0', datetime('now'))
            ON CONFLICT(key) DO NOTHING`,
      args: [],
    });

    await dbClient.execute({
      sql: `INSERT INTO system_config (key, value, updated_at)
            VALUES ('lesson_count', '10', datetime('now'))
            ON CONFLICT(key) DO NOTHING`,
      args: [],
    });

    await dbClient.execute({
      sql: `INSERT INTO system_config (key, value, updated_at)
            VALUES ('min_success_rate', '70', datetime('now'))
            ON CONFLICT(key) DO NOTHING`,
      args: [],
    });

    await dbClient.execute({
      sql: `INSERT INTO system_config (key, value, updated_at)
            VALUES ('lesson_age_days', '30', datetime('now'))
            ON CONFLICT(key) DO NOTHING`,
      args: [],
    });

    logger.info("✅ Default learning configuration added");

    // Verify tables exist
    const tables = await dbClient.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%reflection%' OR name LIKE '%lesson%'"
    );

    logger.info("📊 Created tables:", tables.rows);

    return { success: true, tables: tables.rows };

  } catch (error: any) {
    logger.error("❌ Migration failed:", error);
    throw error;
  } finally {
    // Note: LibSQL client doesn't have close method, connection is managed automatically
  }
}

// Run migration if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  migrateAILearningTables()
    .then(() => {
      logger.info("✅ Migration completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("❌ Migration failed:", error);
      process.exit(1);
    });
}
