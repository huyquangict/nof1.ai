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
 * Quick position sync (without resetting database)
 * Only sync positions from exchange to local database
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
    logger.info("🔄 Syncing positions from exchange...");

    // 1. Connect to database
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const client = createClient({
      url: dbUrl,
    });

    // 2. check if tables exist, create if not
    try {
      await client.execute("SELECT COUNT(*) FROM positions");
      logger.info("✅ database tables already exist");
    } catch (error) {
      logger.warn("⚠️  database tables do not exist, creating now...");
      // create necessary tables
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
      logger.info("✅ database tables created");
    }

    // 3. fetch positions from exchange (adapter already filters non-zero positions)
    const exchangeClient = createExchangeClient();
    const positions = await exchangeClient.getPositions();

    logger.info(`\n📊 exchange currently holding quantity: ${positions.length}`);

    // 4. save existing position metadata (sl_orders, tp_orders, etc.)
    const dbResult = await client.execute("SELECT symbol, sl_orders, tp_orders, sl_order_id, tp_order_id, sl_percentage, tp_percentage, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );
    logger.info(`💾 saved ${dbResult.rows.length} position metadata`);

    // 5. clear local position table
    await client.execute("DELETE FROM positions");
    logger.info("✅ local position table cleared");

    // 6. sync positions to database
    if (positions.length > 0) {
      logger.info(`\n🔄 sync ${positions.length} positions to database...`);

      for (const pos of positions) {
        const symbol = pos.symbol;
        const entryPrice = pos.entryPrice;
        const currentPrice = pos.currentPrice;
        const leverage = pos.leverage;
        const side = pos.side;
        const quantity = pos.quantity;
        const pnl = pos.unrealizedPnl;
        const liqPrice = pos.liquidationPrice;

        // from saved recover from metadata
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
            dbPos?.sl_orders || null,  // 🔧 preserve/retain SL order array
            dbPos?.tp_orders || null,  // 🔧 preserve/retain TP order array
            dbPos?.sl_order_id || null,
            dbPos?.tp_order_id || null,
            dbPos?.sl_percentage || null,
            dbPos?.tp_percentage || null,
            dbPos?.stop_loss || null,
            dbPos?.profit_target || null,
          ],
        });
        
        logger.info(`   ✅ ${symbol}: ${quantity}  contracts (${side}) @ ${entryPrice} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      }
    } else {
      logger.info("✅ currently no positions");
    }
    
    client.close();
    logger.info("\n✅ position sync complete");

  } catch (error: any) {
    logger.error("❌ syncfailed:", error);
    process.exit(1);
  }
}

// execute sync
syncPositionsOnly();

