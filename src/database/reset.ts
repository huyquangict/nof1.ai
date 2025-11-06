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

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import "dotenv/config";
import { CREATE_TABLES_SQL } from "./schema";

const logger = createPinoLogger({
  name: "db-reset",
  level: "info",
});

/**
 * Force reinitialize database
 * Clear all data and recreate tables
 */
async function resetDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

    logger.info("⚠️  Force reinitialize database");
    logger.info(`Database path: ${dbUrl}`);
    logger.info(`initial capital: ${initialBalance} USDT`);

    const client = createClient({
      url: dbUrl,
    });

    // Backup system_config and AI learning data before reset
    logger.info("💾 Backing up system_config and AI learning data...");

    const systemConfigBackup = await client.execute("SELECT * FROM system_config");
    const reflectionsBackup = await client.execute("SELECT * FROM trading_reflections");
    const lessonsBackup = await client.execute("SELECT * FROM learned_lessons");
    const applicationsBackup = await client.execute("SELECT * FROM lesson_applications");

    logger.info(`📦 Backed up: ${systemConfigBackup.rows.length} config entries, ${reflectionsBackup.rows.length} reflections, ${lessonsBackup.rows.length} lessons`);

    // Drop ONLY trading tables (preserve system_config and AI learning tables)
    logger.info("🗑️  Dropping trading tables only...");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
    await client.execute("DROP TABLE IF EXISTS trades");
    await client.execute("DROP TABLE IF EXISTS positions");
    await client.execute("DROP TABLE IF EXISTS account_history");

    // NOTE: We intentionally DO NOT drop:
    // - system_config (custom instructions, pause state, reverse state, learning settings)
    // - trading_reflections (AI predictions and outcomes)
    // - learned_lessons (extracted patterns from reasoner)
    // - lesson_applications (effectiveness tracking)

    logger.info("✅ Trading tables dropped (system_config and AI learning tables preserved)");

    // recreate tables
    logger.info("📦 create new tables...");
    await client.executeMultiple(CREATE_TABLES_SQL);
    logger.info("✅ tables created");

    // insert initial capital record
    logger.info(`💰 insert initial capital record: ${initialBalance} USDT`);
    await client.execute({
      sql: `INSERT INTO account_history 
            (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        initialBalance,
        initialBalance,
        0,
        0,
        0,
      ],
    });

    // verify initialization results
    const latestAccount = await client.execute(
      "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
    );

    if (latestAccount.rows.length > 0) {
      const account = latestAccount.rows[0] as any;
      logger.info("\n" + "=".repeat(60));
      logger.info("✅ Database reset successful!");
      logger.info("=".repeat(60));
      logger.info("\n📊 Initial account status:");
      logger.info(`  Total balance: ${account.total_value} USDT`);
      logger.info(`  Available balance: ${account.available_cash} USDT`);
      logger.info(`  Unrealized PnL: ${account.unrealized_pnl} USDT`);
      logger.info(`  Realized PnL: ${account.realized_pnl} USDT`);
      logger.info(`  Total return rate: ${account.return_percent}%`);
      logger.info("\nCurrently no positions");
      logger.info("\n💾 Preserved data:");
      logger.info(`  Custom instructions: ${systemConfigBackup.rows.filter((r: any) => r.key === 'custom_instructions').length > 0 ? 'YES' : 'NO'}`);
      logger.info(`  AI learning reflections: ${reflectionsBackup.rows.length} records`);
      logger.info(`  AI learned lessons: ${lessonsBackup.rows.length} lessons`);
      logger.info("\n" + "=".repeat(60));
    }

    client.close();
    logger.info("\n🎉 Database reset to initial state! Custom instructions and AI learning data preserved!");
    
  } catch (error) {
    logger.error("❌ database reset failed:", error as any);
    process.exit(1);
  }
}

// execute reset
resetDatabase();

