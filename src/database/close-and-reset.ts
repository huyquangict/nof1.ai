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
 * Close positions and reset database script
 * Used for quick system state reset at runtime
 */
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { createExchangeClient } from "../services/exchange/ExchangeFactory";
import "dotenv/config";

const logger = createPinoLogger({
  name: "close-and-reset",
  level: "info",
});

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS account_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    total_value REAL NOT NULL,
    available_cash REAL NOT NULL,
    unrealized_pnl REAL NOT NULL,
    realized_pnl REAL NOT NULL,
    return_percent REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL NOT NULL,
    liquidation_price REAL NOT NULL,
    unrealized_pnl REAL NOT NULL,
    leverage INTEGER NOT NULL,
    side TEXT NOT NULL,
    entry_order_id TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS trading_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    price REAL NOT NULL,
    ema_20 REAL,
    ema_50 REAL,
    macd REAL,
    rsi_7 REAL,
    rsi_14 REAL,
    volume REAL,
    funding_rate REAL
);

CREATE TABLE IF NOT EXISTS agent_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    market_analysis TEXT NOT NULL,
    decision TEXT NOT NULL,
    actions_taken TEXT NOT NULL,
    account_value REAL NOT NULL,
    positions_quantity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    order_id TEXT,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    amount REAL NOT NULL,
    leverage INTEGER,
    pnl REAL,
    fee REAL,
    status TEXT NOT NULL
);
`;

/**
 * close all positions
 */
async function closeAllPositions(): Promise<void> {
  const exchangeClient = createExchangeClient();
  const exchangeName = exchangeClient.getExchangeName();

  try {
    logger.info(`📊 get/fetch ${exchangeName} currently holding...`);

    const positions = await exchangeClient.getPositions();

    if (positions.length === 0) {
      logger.info("✅ currently no positions, skip closing positions");
      return;
    }

    logger.warn(`⚠️  Found ${positions.length} positions, starting to close positions...`);

    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side === 'long' ? "long" : "short";
      const quantity = pos.quantity;

      try {
        logger.info(`🔄 Closing position: ${symbol} ${side} ${quantity} contracts`);

        await exchangeClient.placeOrder({
          symbol,
          side: pos.side === 'long' ? 'short' : 'long', // Opposite side to close
          quantity,
          reduceOnly: true, // Reduce only
        });

        logger.info(`✅ Position closed: ${symbol} ${side} ${quantity} contracts`);
      } catch (error: any) {
        logger.error(`❌ close position failed: ${symbol} - ${error.message}`);
      }
    }
    
    logger.info("✅ All positions closed");
  } catch (error: any) {
    logger.error(`❌ Error during position closing: ${error.message}`);
    throw error;
  }
}

/**
 * Reset database
 */
async function resetDatabase(): Promise<void> {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

    logger.info("🗄️  Starting database reset...");
    logger.info(`Database path: ${dbUrl}`);
    logger.info(`initial capital: ${initialBalance} USDT`);

    const client = createClient({
      url: dbUrl,
    });

    // drop all tables
    logger.info("🗑️  drop existing tables...");
    await client.execute("DROP TABLE IF EXISTS trade_logs");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
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
    
  } catch (error) {
    logger.error("❌ database reset failed:", error as any);
    throw error;
  }
}

/**
 * Sync position data
 */
async function syncPositions(): Promise<void> {
  const exchangeClient = createExchangeClient();
  const exchangeName = exchangeClient.getExchangeName();
  const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";

  try {
    logger.info(`🔄 Syncing positions from ${exchangeName}...`);

    const client = createClient({
      url: dbUrl,
    });

    // fetch positions from exchange
    const positions = await exchangeClient.getPositions();

    logger.info(`📊 ${exchangeName} currently holding: ${positions.length} positions`);

    // clear local position table
    await client.execute("DELETE FROM positions");
    logger.info("✅ local position table cleared");

    // sync positions to database
    if (positions.length > 0) {
      logger.info(`🔄 sync ${positions.length} positions to database...`);

      for (const pos of positions) {
        if (pos.quantity === 0) continue;

        const symbol = pos.symbol;
        const entryPrice = pos.entryPrice;
        const currentPrice = pos.currentPrice;
        const leverage = pos.leverage;
        const side = pos.side;
        const quantity = pos.quantity;
        const pnl = pos.unrealizedPnl;
        const liqPrice = pos.liquidationPrice;
        
        await client.execute({
          sql: `INSERT INTO positions 
                (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
                 leverage, side, entry_order_id, opened_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            symbol,
            quantity,
            entryPrice,
            currentPrice,
            liqPrice,
            pnl,
            leverage,
            side,
            "synced",
            new Date().toISOString(),
          ],
        });
        
        logger.info(`   ✅ ${symbol}: ${quantity}  contracts (${side}) @ ${entryPrice} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      }
    } else {
      logger.info("✅ currently no positions");
    }
    
    client.close();
    logger.info("✅ position sync complete");
    
  } catch (error: any) {
    logger.error(`❌ positionsyncfailed: ${error.message}`);
    throw error;
  }
}

/**
 * Main execution function
 */
async function closeAndReset() {
  logger.info("=".repeat(80));
  logger.info("🔄 Starting to close positions and reset database");
  logger.info("=".repeat(80));
  logger.info("");
  
  try {
    // Step 1: close all positions
    logger.info("【Step 1/3】 Close all positions");
    logger.info("-".repeat(80));
    await closeAllPositions();
    logger.info("");
    
    // Wait 2 seconds to ensure positions are closed
    logger.info("⏱️  Waiting 2 seconds to ensure positions are closed...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    logger.info("");
    
    // Step 2: reset database
    logger.info("【Step 2/3】 Reset database");
    logger.info("-".repeat(80));
    await resetDatabase();
    logger.info("");
    
    // Step 3: sync position data
    logger.info("【Step 3/3】 Sync position data from exchange");
    logger.info("-".repeat(80));
    await syncPositions();
    logger.info("");
    
    logger.info("=".repeat(80));
    logger.info("🎉 Close positions and reset complete! System restored to initial state");
    logger.info("=".repeat(80));
    logger.info("");
    logger.info("💡 Tip: You can now restart the trading system to start new trades");
    
  } catch (error) {
    logger.error("=".repeat(80));
    logger.error("❌ Execution failed:", error as any);
    logger.error("=".repeat(80));
    process.exit(1);
  }
}

// Execute main function
closeAndReset();

