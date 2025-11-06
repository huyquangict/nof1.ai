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
 * 快速同步持仓（不重置数据库）
 * 只从交易所同步持仓到本地数据库
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { createExchangeClient } from "../services/exchange";

const logger = createPinoLogger({
  name: "sync-positions",
  level: "info",
});

async function syncPositionsOnly() {
  try {
    logger.info("🔄 从交易所同步持仓...");

    // 1. 连接数据库
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const client = createClient({
      url: dbUrl,
    });

    // 2. 检查表是否存在，不存在则创建
    try {
      await client.execute("SELECT COUNT(*) FROM positions");
      logger.info("✅ 数据库表已存在");
    } catch (error) {
      logger.warn("⚠️  数据库表不存在，正在创建...");
      // 创建必要的表
      await client.execute(`
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
          profit_target REAL,
          stop_loss REAL,
          tp_order_id TEXT,
          sl_order_id TEXT,
          entry_order_id TEXT,
          opened_at TEXT NOT NULL,
          closed_at TEXT
        )
      `);
      logger.info("✅ 数据库表创建完成");
    }

    // 3. 从交易所获取持仓 (adapter already filters non-zero positions)
    const exchangeClient = createExchangeClient();
    const positions = await exchangeClient.getPositions();

    logger.info(`\n📊 交易所当前持仓数: ${positions.length}`);

    // 4. 保存现有持仓的元数据 (sl_orders, tp_orders等)
    const dbResult = await client.execute("SELECT symbol, sl_orders, tp_orders, sl_order_id, tp_order_id, sl_percentage, tp_percentage, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );
    logger.info(`💾 已保存 ${dbResult.rows.length} 个持仓的元数据`);

    // 5. 清空本地持仓表
    await client.execute("DELETE FROM positions");
    logger.info("✅ 已清空本地持仓表");

    // 6. 同步持仓到数据库
    if (positions.length > 0) {
      logger.info(`\n🔄 同步 ${positions.length} 个持仓到数据库...`);

      for (const pos of positions) {
        const symbol = pos.symbol;
        const entryPrice = pos.entryPrice;
        const currentPrice = pos.currentPrice;
        const leverage = pos.leverage;
        const side = pos.side;
        const quantity = pos.quantity;
        const pnl = pos.unrealizedPnl;
        const liqPrice = pos.liquidationPrice;

        // 从保存的元数据中恢复
        const dbPos = dbPositionsMap.get(symbol);
        const entryOrderId = dbPos?.entry_order_id || "synced";
        const openedAt = dbPos?.opened_at || new Date().toISOString();

        await client.execute({
          sql: `INSERT INTO positions
                (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
                 leverage, side, entry_order_id, opened_at, sl_orders, tp_orders, sl_order_id, tp_order_id,
                 sl_percentage, tp_percentage, stop_loss, profit_target)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            symbol,
            quantity,
            entryPrice,
            currentPrice,
            liqPrice,
            pnl,
            leverage,
            side,
            entryOrderId,
            openedAt,
            dbPos?.sl_orders || null,  // 🔧 保留 SL 订单数组
            dbPos?.tp_orders || null,  // 🔧 保留 TP 订单数组
            dbPos?.sl_order_id || null,
            dbPos?.tp_order_id || null,
            dbPos?.sl_percentage || null,
            dbPos?.tp_percentage || null,
            dbPos?.stop_loss || null,
            dbPos?.profit_target || null,
          ],
        });
        
        logger.info(`   ✅ ${symbol}: ${quantity} 张 (${side}) @ ${entryPrice} | 盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      }
    } else {
      logger.info("✅ 当前无持仓");
    }
    
    client.close();
    logger.info("\n✅ 持仓同步完成");

  } catch (error: any) {
    logger.error("❌ 同步失败:", error);
    process.exit(1);
  }
}

// 执行同步
syncPositionsOnly();

