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
 * Database migration script: add peak_pnl_percent field to positions table
 */
import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

async function addPeakPnlColumn() {
  try {
    console.log("Starting database migration: adding peak_pnl_percent field...");
    
    // Check if field already exists
    const tableInfo = await dbClient.execute("PRAGMA table_info(positions)");
    const columnExists = tableInfo.rows.some((row: any) => row.name === "peak_pnl_percent");
    
    if (columnExists) {
      console.log("✅ peak_pnl_percent field already exists, no migration needed");
      return;
    }
    
    // 添加字段
    await dbClient.execute(`
      ALTER TABLE positions 
      ADD COLUMN peak_pnl_percent REAL DEFAULT 0
    `);
    
    console.log("✅ successful添加 peak_pnl_percent 字段到 positions 表");
    
    // 为现有positioninitializepeakPnL
    const positions = await dbClient.execute("SELECT * FROM positions");
    
    for (const pos of positions.rows) {
      const entryPrice = Number.parseFloat(pos.entry_price as string);
      const currentPrice = Number.parseFloat(pos.current_price as string);
      const leverage = Number.parseInt(pos.leverage as string);
      const side = pos.side as string;
      
      // 计算currentPnL百分比
      const priceChangePercent = entryPrice > 0 
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;
      
      // initializepeak为currentPnL(If是正数) or 0
      const initialPeak = Math.max(pnlPercent, 0);
      
      await dbClient.execute({
        sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
        args: [initialPeak, pos.symbol],
      });
    }
    
    console.log(`✅ initialize ${positions.rows.length} position peakPnL百分比`);
    
  } catch (error: any) {
    console.error("❌ database迁移failed:", error.message);
    process.exit(1);
  }
}

addPeakPnlColumn().then(() => {
  console.log("database迁移完成");
  process.exit(0);
});

