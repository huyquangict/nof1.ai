/**
 * open-nof1.ai - AI 加密货币自动交易系统
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
 * 数据库初始化脚本
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { CREATE_TABLES_SQL } from "./schema";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "database-init",
  level: "info",
});

async function initDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

    logger.info(`Initializing database: ${dbUrl}`);

    const client = createClient({
      url: dbUrl,
    });

    // Create tables
    logger.info("Creating database tables...");
    await client.executeMultiple(CREATE_TABLES_SQL);

    // Check if re-initialization is needed
    const existingHistory = await client.execute(
      "SELECT COUNT(*) as count FROM account_history"
    );
    const count = (existingHistory.rows[0] as any).count as number;

    if (count > 0) {
      // Check if initial balance has changed
      const firstRecord = await client.execute(
        "SELECT total_value FROM account_history ORDER BY id ASC LIMIT 1"
      );
      const firstBalance = Number.parseFloat(firstRecord.rows[0]?.total_value as string || "0");

      if (firstBalance !== initialBalance) {
        logger.warn(`⚠️  Initial balance changed: ${firstBalance} USDT -> ${initialBalance} USDT`);
        logger.info("Clearing existing data, re-initializing...");

        // Clear all trading data
        await client.execute("DELETE FROM trades");
        await client.execute("DELETE FROM positions");
        await client.execute("DELETE FROM account_history");
        await client.execute("DELETE FROM trading_signals");
        await client.execute("DELETE FROM agent_decisions");

        logger.info("✅ Old data cleared");
      } else {
        logger.info(`Database has ${count} account history records, skipping initialization`);
        // Show current status and return
        const latestAccount = await client.execute(
          "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
        );
        if (latestAccount.rows.length > 0) {
          const account = latestAccount.rows[0] as any;
          logger.info("Current account status:");
          logger.info(`  Total assets: ${account.total_value} USDT`);
          logger.info(`  Available: ${account.available_cash} USDT`);
          logger.info(`  Unrealized PnL: ${account.unrealized_pnl} USDT`);
          logger.info(`  Total return: ${account.return_percent}%`);
        }

        const positions = await client.execute("SELECT * FROM positions");
        if (positions.rows.length > 0) {
          logger.info(`\nCurrent positions (${positions.rows.length}):`);
          for (const pos of positions.rows) {
            const p = pos as any;
            logger.info(`  ${p.symbol}: ${p.quantity} @ ${p.entry_price} (${p.side}, ${p.leverage}x)`);
          }
        } else {
          logger.info("\nNo current positions");
        }

        logger.info("\n✅ Database initialization complete");
        client.close();
        return;
      }
    }

    // Insert initial account record
    logger.info(`Inserting initial balance record: ${initialBalance} USDT`);
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
    logger.info("✅ Initial balance record created");

    // Display current account status
    const latestAccount = await client.execute(
      "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
    );

    if (latestAccount.rows.length > 0) {
      const account = latestAccount.rows[0] as any;
      logger.info("Current account status:");
      logger.info(`  Total assets: ${account.total_value} USDT`);
      logger.info(`  Available: ${account.available_cash} USDT`);
      logger.info(`  Unrealized PnL: ${account.unrealized_pnl} USDT`);
      logger.info(`  Total return: ${account.return_percent}%`);
    }

    // Display current positions
    const positions = await client.execute(
      "SELECT * FROM positions"
    );

    if (positions.rows.length > 0) {
      logger.info(`\nCurrent positions (${positions.rows.length}):`);
      for (const pos of positions.rows) {
        const p = pos as any;
        logger.info(`  ${p.symbol}: ${p.quantity} @ ${p.entry_price} (${p.side}, ${p.leverage}x)`);
      }
    } else {
      logger.info("\nNo current positions");
    }

    logger.info("\n✅ Database initialization complete");
    client.close();
  } catch (error) {
    logger.error("❌ Database initialization failed:", error as any);
    process.exit(1);
  }
}

export { initDatabase };

