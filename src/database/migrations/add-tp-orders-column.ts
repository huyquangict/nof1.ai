/**
 * Migration: Add tp_orders column to positions table
 *
 * This migration adds support for multiple take-profit orders per position.
 * Existing single TP data (profit_target, tp_order_id, tp_percentage) will be
 * preserved for backward compatibility.
 */

import { createClient } from '@libsql/client';

const DATABASE_URL = process.env.DATABASE_URL || 'file:./.voltagent/trading.db';

async function migrate() {
  console.log('Starting migration: add tp_orders column...');

  const client = createClient({
    url: DATABASE_URL,
  });

  try {
    // Add tp_orders column if it doesn't exist
    await client.execute(`
      ALTER TABLE positions ADD COLUMN tp_orders TEXT;
    `);

    console.log('✅ Successfully added tp_orders column to positions table');

    // Migrate existing single TP data to new format
    const positions = await client.execute('SELECT * FROM positions WHERE profit_target IS NOT NULL');

    let migratedCount = 0;
    for (const row of positions.rows) {
      const symbol = row.symbol as string;
      const profitTarget = row.profit_target as number;
      const tpOrderId = row.tp_order_id as string;
      const tpPercentage = (row.tp_percentage as number) || 100;

      if (profitTarget && tpOrderId) {
        const tpOrders = [{
          price: profitTarget,
          percentage: tpPercentage,
          orderId: tpOrderId,
          triggered: false,
        }];

        await client.execute({
          sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
          args: [JSON.stringify(tpOrders), symbol],
        });

        migratedCount++;
      }
    }

    console.log(`✅ Migrated ${migratedCount} existing take-profit orders to new format`);
    console.log('Migration completed successfully!');

  } catch (error: any) {
    if (error.message?.includes('duplicate column name')) {
      console.log('⚠️ Column tp_orders already exists, skipping...');
    } else {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  } finally {
    client.close();
  }
}

migrate();
