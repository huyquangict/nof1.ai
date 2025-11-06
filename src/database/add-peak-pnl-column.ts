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
    
    // add field
    await dbClient.execute(`
      ALTER TABLE positions 
      ADD COLUMN peak_pnl_percent REAL DEFAULT 0
    `);
    
    console.log("✅ Successfully added peak_pnl_percent field to positions table");
    
    // Initialize peak PnL for existing positions
    const positions = await dbClient.execute("SELECT * FROM positions");
    
    for (const pos of positions.rows) {
      const entryPrice = Number.parseFloat(pos.entry_price as string);
      const currentPrice = Number.parseFloat(pos.current_price as string);
      const leverage = Number.parseInt(pos.leverage as string);
      const side = pos.side as string;
      
      // Calculate current PnL percentage
      const priceChangePercent = entryPrice > 0 
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;
      
      // Initialize peak to current PnL (if positive) or 0
      const initialPeak = Math.max(pnlPercent, 0);
      
      await dbClient.execute({
        sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
        args: [initialPeak, pos.symbol],
      });
    }
    
    console.log(`✅ Initialized peak PnL percentage for ${positions.rows.length} positions`);
    
  } catch (error: any) {
    console.error("❌ Database migration failed:", error.message);
    process.exit(1);
  }
}

addPeakPnlColumn().then(() => {
  console.log("Database migration complete");
  process.exit(0);
});

