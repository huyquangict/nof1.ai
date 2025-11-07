/**
 * Migration: Add close data columns to trading_reflections
 *
 * Adds new columns for capturing complete learning data:
 * - decision_indicators: Technical indicators at decision time
 * - close_price: Exact price when position closes
 * - close_reason: Why position was closed
 * - close_indicators: Technical indicators at close time
 */

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "migration-reflection-close-data",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

async function migrate() {
  try {
    logger.info("🔄 Starting migration: Add close data columns to trading_reflections");

    // Add decision_indicators column
    await dbClient.execute({
      sql: "ALTER TABLE trading_reflections ADD COLUMN decision_indicators TEXT",
      args: [],
    });
    logger.info("✅ Added column: decision_indicators");

    // Add close_price column
    await dbClient.execute({
      sql: "ALTER TABLE trading_reflections ADD COLUMN close_price REAL",
      args: [],
    });
    logger.info("✅ Added column: close_price");

    // Add close_reason column
    await dbClient.execute({
      sql: "ALTER TABLE trading_reflections ADD COLUMN close_reason TEXT",
      args: [],
    });
    logger.info("✅ Added column: close_reason");

    // Add close_indicators column
    await dbClient.execute({
      sql: "ALTER TABLE trading_reflections ADD COLUMN close_indicators TEXT",
      args: [],
    });
    logger.info("✅ Added column: close_indicators");

    logger.info("✅ Migration completed successfully!");

  } catch (error: any) {
    // If error is "duplicate column", it means migration already ran
    if (error.message?.includes("duplicate column")) {
      logger.info("ℹ️  Migration already applied (columns exist)");
    } else {
      logger.error("❌ Migration failed:", error);
      throw error;
    }
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error("Migration error:", error);
    process.exit(1);
  });
