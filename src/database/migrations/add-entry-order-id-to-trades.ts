/**
 * Migration: Add entry_order_id to trades table
 *
 * This links close trades back to their entry trades, completing the ID-based tracking system.
 *
 * Before:
 *   trades table has only order_id (the ID of this specific trade's order)
 *
 * After:
 *   trades table has both:
 *   - order_id: ID of this trade's order (entry order for open, close/SL/TP order for close)
 *   - entry_order_id: ID of the entry order (NULL for open trades, set for close trades)
 *
 * Benefits:
 *   1. Can trace any close trade back to its entry trade
 *   2. Easy PnL verification by joining entry/close trades
 *   3. Reconstruct complete position lifecycle
 *   4. Handle multiple open/close cycles for same symbol
 */

import { createClient } from '@libsql/client';

const dbClient = createClient({
  url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
});

async function migrate() {
  console.log('🔄 Starting migration: add entry_order_id to trades table...\n');

  try {
    // 1. Check if column already exists
    const result = await dbClient.execute("PRAGMA table_info(trades)");
    const hasColumn = result.rows.some((row: any) => row.name === 'entry_order_id');

    if (hasColumn) {
      console.log('✅ Column entry_order_id already exists, skipping migration');
      return;
    }

    // 2. Add the column
    console.log('📝 Adding entry_order_id column to trades table...');
    await dbClient.execute(`
      ALTER TABLE trades ADD COLUMN entry_order_id TEXT;
    `);
    console.log('✅ Column added successfully\n');

    // 3. Try to populate existing close trades with entry_order_id by matching symbol and timestamp
    console.log('📝 Attempting to populate entry_order_id for existing close trades...');

    // Get all close trades without entry_order_id
    const closeTrades = await dbClient.execute(`
      SELECT id, symbol, timestamp, side
      FROM trades
      WHERE type = 'close' AND entry_order_id IS NULL
      ORDER BY timestamp ASC
    `);

    console.log(`Found ${closeTrades.rows.length} close trades to populate\n`);

    let populatedCount = 0;
    for (const closeTrade of closeTrades.rows) {
      const ct = closeTrade as any;

      // Find the most recent open trade for this symbol before this close trade
      const openTrades = await dbClient.execute({
        sql: `
          SELECT order_id
          FROM trades
          WHERE symbol = ?
            AND side = ?
            AND type = 'open'
            AND timestamp < ?
          ORDER BY timestamp DESC
          LIMIT 1
        `,
        args: [ct.symbol, ct.side, ct.timestamp]
      });

      if (openTrades.rows.length > 0) {
        const entryOrderId = (openTrades.rows[0] as any).order_id;

        await dbClient.execute({
          sql: 'UPDATE trades SET entry_order_id = ? WHERE id = ?',
          args: [entryOrderId, ct.id]
        });

        populatedCount++;
        console.log(`  ✅ Trade #${ct.id} (${ct.symbol} close) → entry_order_id = ${entryOrderId}`);
      } else {
        console.log(`  ⚠️  Trade #${ct.id} (${ct.symbol} close) → no matching entry trade found`);
      }
    }

    console.log(`\n✅ Populated ${populatedCount} / ${closeTrades.rows.length} close trades with entry_order_id\n`);

    // 4. Add index for better query performance
    console.log('📝 Creating index on entry_order_id...');
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_trades_entry_order_id ON trades(entry_order_id);
    `);
    console.log('✅ Index created\n');

    console.log('✅ Migration complete!\n');
    console.log('Summary:');
    console.log(`  - Added entry_order_id column to trades table`);
    console.log(`  - Populated ${populatedCount} existing close trades`);
    console.log(`  - Created index for performance`);
    console.log(`  - Future close trades will include entry_order_id automatically\n`);

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log('✅ Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });
