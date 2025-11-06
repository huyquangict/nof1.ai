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
    positions_count INTEGER NOT NULL
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
 * close position所有position
 */
async function closeAllPositions(): Promise<void> {
  const exchangeClient = createExchangeClient();
  const exchangeName = exchangeClient.getExchangeName();

  try {
    logger.info(`📊 获取 ${exchangeName} currently holding...`);

    const positions = await exchangeClient.getPositions();

    if (positions.length === 0) {
      logger.info("✅ current无position,跳过close position");
      return;
    }

    logger.warn(`⚠️  发现 ${positions.length} position,open始close position...`);

    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side === 'long' ? "多头" : "空头";
      const quantity = pos.quantity;

      try {
        logger.info(`🔄 close position中: ${symbol} ${side} ${quantity} contracts`);

        await exchangeClient.placeOrder({
          symbol,
          side: pos.side === 'long' ? 'short' : 'long', // Opposite side to close
          quantity,
          reduceOnly: true, // 只减仓
        });

        logger.info(`✅ 已close position: ${symbol} ${side} ${quantity} contracts`);
      } catch (error: any) {
        logger.error(`❌ close positionfailed: ${symbol} - ${error.message}`);
      }
    }
    
    logger.info("✅ 所有positionclose position完成");
  } catch (error: any) {
    logger.error(`❌ close position过程出错: ${error.message}`);
    throw error;
  }
}

/**
 * 重置database
 */
async function resetDatabase(): Promise<void> {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const initialBalance = Number.parseFloat(process.env.INITIAL_BALANCE || "1000");

    logger.info("🗄️  open始重置database...");
    logger.info(`Database path: ${dbUrl}`);
    logger.info(`初始资金: ${initialBalance} USDT`);

    const client = createClient({
      url: dbUrl,
    });

    // delete所有表
    logger.info("🗑️  delete现有表...");
    await client.execute("DROP TABLE IF EXISTS trade_logs");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
    await client.execute("DROP TABLE IF EXISTS positions");
    await client.execute("DROP TABLE IF EXISTS account_history");
    logger.info("✅ 现有表已delete");

    // 重new创建表
    logger.info("📦 创建new表...");
    await client.executeMultiple(CREATE_TABLES_SQL);
    logger.info("✅ 表创建完成");

    // insert初始资金记录
    logger.info(`💰 insert初始资金记录: ${initialBalance} USDT`);
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

    // verifyinitialize结果
    const latestAccount = await client.execute(
      "SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1"
    );

    if (latestAccount.rows.length > 0) {
      const account = latestAccount.rows[0] as any;
      logger.info("\n" + "=".repeat(60));
      logger.info("✅ database重置successful！");
      logger.info("=".repeat(60));
      logger.info("\n📊 初始account状态:");
      logger.info(`  total balance: ${account.total_value} USDT`);
      logger.info(`  available balance: ${account.available_cash} USDT`);
      logger.info(`  unrealized PnL: ${account.unrealized_pnl} USDT`);
      logger.info(`  realized PnL: ${account.realized_pnl} USDT`);
      logger.info(`  总return rate: ${account.return_percent}%`);
      logger.info("\ncurrent无position");
      logger.info("\n" + "=".repeat(60));
    }

    client.close();
    
  } catch (error) {
    logger.error("❌ database重置failed:", error as any);
    throw error;
  }
}

/**
 * syncposition数据
 */
async function syncPositions(): Promise<void> {
  const exchangeClient = createExchangeClient();
  const exchangeName = exchangeClient.getExchangeName();
  const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";

  try {
    logger.info(`🔄 从 ${exchangeName} syncposition...`);

    const client = createClient({
      url: dbUrl,
    });

    // 从交易所获取position
    const positions = await exchangeClient.getPositions();

    logger.info(`📊 ${exchangeName} currently holding数: ${positions.length}`);

    // 清空本地position表
    await client.execute("DELETE FROM positions");
    logger.info("✅ 已清空本地position表");

    // syncposition到database
    if (positions.length > 0) {
      logger.info(`🔄 sync ${positions.length} position到database...`);

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
      logger.info("✅ current无position");
    }
    
    client.close();
    logger.info("✅ positionsync完成");
    
  } catch (error: any) {
    logger.error(`❌ positionsyncfailed: ${error.message}`);
    throw error;
  }
}

/**
 * 主执行函数
 */
async function closeAndReset() {
  logger.info("=".repeat(80));
  logger.info("🔄 open始执行close position并重置database");
  logger.info("=".repeat(80));
  logger.info("");
  
  try {
    // 步骤1:close position所有position
    logger.info("【步骤 1/3】close position所有position");
    logger.info("-".repeat(80));
    await closeAllPositions();
    logger.info("");
    
    // 等待2秒确保close position完成
    logger.info("⏱️  等待2秒确保close position完成...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    logger.info("");
    
    // 步骤2:重置database
    logger.info("【步骤 2/3】重置database");
    logger.info("-".repeat(80));
    await resetDatabase();
    logger.info("");
    
    // 步骤3:syncposition数据
    logger.info("【步骤 3/3】从交易所syncposition数据");
    logger.info("-".repeat(80));
    await syncPositions();
    logger.info("");
    
    logger.info("=".repeat(80));
    logger.info("🎉 close position并重置完成！系统已恢复到初始状态");
    logger.info("=".repeat(80));
    logger.info("");
    logger.info("💡 提示:can重newstart交易系统open始new 交易");
    
  } catch (error) {
    logger.error("=".repeat(80));
    logger.error("❌ 执行failed:", error as any);
    logger.error("=".repeat(80));
    process.exit(1);
  }
}

// 执行主函数
closeAndReset();

