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

const logger = createPinoLogger({
  name: "check-trades",
  level: "info",
});

async function checkTrades() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    const client = createClient({ url: dbUrl });
    
    logger.info("📊 Query last 5 trade records...\n");
    
    const result = await client.execute({
      sql: `SELECT id, symbol, side, type, price, quantity, leverage, fee, timestamp 
            FROM trades 
            ORDER BY timestamp DESC 
            LIMIT 5`,
      args: [],
    });
    
    if (result.rows.length === 0) {
      logger.info("No trade records");
      return;
    }
    
    console.log("Trade records:");
    console.log("=".repeat(100));
    
    for (const row of result.rows) {
      const typeText = row.type === 'open' ? 'open' : 'close';
      const sideText = row.side === 'long' ? '多' : '空';
      const feeText = row.fee ? `${Number(row.fee).toFixed(4)}` : '0';
      
      console.log(`ID: ${row.id}`);
      console.log(`  symbol: ${row.symbol}`);
      console.log(`  操作: ${typeText}${sideText} (side=${row.side}, type=${row.type})`);
      console.log(`  价格: ${Number(row.price).toFixed(4)}`);
      console.log(`  数量: ${row.quantity}`);
      console.log(`  leverage: ${row.leverage}x`);
      console.log(`  fee: ${feeText} USDT`);
      console.log(`  time: ${row.timestamp}`);
      console.log("-".repeat(100));
    }
    
    process.exit(0);
  } catch (error: any) {
    logger.error(`❌ queryfailed: ${error.message}`);
    process.exit(1);
  }
}

checkTrades();

