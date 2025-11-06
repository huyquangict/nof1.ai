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
  name: "db-migration-fee",
  level: "info",
});

/**
 * Add fee field to trades table
 */
async function addFeeColumn() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    logger.info(`📦 Connect to database: ${dbUrl}`);
    
    const client = createClient({
      url: dbUrl,
    });
    
    logger.info("🔧 Checking trades table structure...");
    
    // Check if fee column already exists
    const tableInfo = await client.execute({
      sql: "PRAGMA table_info(trades)",
      args: [],
    });
    
    const hasFeeColumn = tableInfo.rows.some((row: any) => row.name === 'fee');
    
    if (hasFeeColumn) {
      logger.info("✅ fee field already exists, no need to add");
      return;
    }
    
    // Add fee column
    logger.info("➕ Adding fee field to trades table...");
    await client.execute({
      sql: "ALTER TABLE trades ADD COLUMN fee REAL",
      args: [],
    });
    
    logger.info("✅ Fee field added successfully");
    
    // verify
    const newTableInfo = await client.execute({
      sql: "PRAGMA table_info(trades)",
      args: [],
    });
    
    logger.info("\nCurrent trades table structure:");
    for (const row of newTableInfo.rows) {
      logger.info(`  - ${row.name}: ${row.type}`);
    }
    
    logger.info("\n✅ Database migration complete!");
    
    process.exit(0);
  } catch (error: any) {
    logger.error(`❌ Migration failed: ${error.message}`);
    process.exit(1);
  }
}

addFeeColumn();

