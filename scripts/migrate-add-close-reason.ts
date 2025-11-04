/**
 * Migration script: Add close_reason column to trades table
 */

import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

async function migrate() {
  console.log("🔄 Running migration: add close_reason to trades table...");

  try {
    // Check if column already exists
    const tableInfo = await dbClient.execute("PRAGMA table_info(trades)");
    const hasCloseReason = tableInfo.rows.some((row: any) => row.name === 'close_reason');

    if (hasCloseReason) {
      console.log("✅ Column 'close_reason' already exists. Migration skipped.");
      return;
    }

    // Add the column
    await dbClient.execute(`
      ALTER TABLE trades ADD COLUMN close_reason TEXT
    `);

    console.log("✅ Migration completed successfully!");
    console.log("📝 Added 'close_reason' column to trades table");

  } catch (error: any) {
    console.error("❌ Migration failed:", error.message);
    throw error;
  }
}

migrate().catch(console.error);
