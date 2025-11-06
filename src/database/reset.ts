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

    // drop all tables
    logger.info("🗑️  drop existing tables...");
    await client.execute("DROP TABLE IF EXISTS system_config");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
    await client.execute("DROP TABLE IF EXISTS trades");
    await client.execute("DROP TABLE IF EXISTS positions");
    await client.execute("DROP TABLE IF EXISTS account_history");
    logger.info("✅ existing tables dropped");

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
      logger.info("✅ database reset successful！");
      logger.info("=".repeat(60));
      logger.info("\n📊 initial account status:");
      logger.info(`  total balance: ${account.total_value} USDT`);
      logger.info(`  available balance: ${account.available_cash} USDT`);
      logger.info(`  unrealized PnL: ${account.unrealized_pnl} USDT`);
      logger.info(`  realized PnL: ${account.realized_pnl} USDT`);
      logger.info(`  total return rate: ${account.return_percent}%`);
      logger.info("\ncurrently no positions");
      logger.info("\n" + "=".repeat(60));
    }

    client.close();
    logger.info("\n🎉 database reset to initial state, can start trading！");
    
  } catch (error) {
    logger.error("❌ database reset failed:", error as any);
    process.exit(1);
  }
}

// execute reset
resetDatabase();

