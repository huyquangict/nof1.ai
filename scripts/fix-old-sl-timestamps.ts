import { createClient } from '@libsql/client';

async function fixOldSlTimestamps() {
  const db = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  console.log('Fixing old stop-loss timestamps to consistent UTC format...\n');

  // Get all stop_loss trades with old timestamp format (ending in Z with milliseconds)
  const result = await db.execute({
    sql: `SELECT id, timestamp, symbol, order_id FROM trades WHERE close_reason = 'stop_loss' AND timestamp LIKE '%.%Z'`,
    args: []
  });

  console.log(`Found ${result.rows.length} stop-loss trades with old timestamp format:\n`);

  for (const row of result.rows) {
    const r = row as any;
    const oldTimestamp = r.timestamp;

    // Parse and convert to clean UTC format (no milliseconds)
    const date = new Date(oldTimestamp);
    const newTimestamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z');

    console.log(`ID ${r.id} | ${r.symbol} | Order ${r.order_id}`);
    console.log(`  Old: ${oldTimestamp}`);
    console.log(`  New: ${newTimestamp}`);

    // Update the timestamp
    await db.execute({
      sql: 'UPDATE trades SET timestamp = ? WHERE id = ?',
      args: [newTimestamp, r.id]
    });

    console.log(`  ✅ Updated\n`);
  }

  console.log('Done!');
  process.exit(0);
}

fixOldSlTimestamps().catch(console.error);
