import { createClient } from '@libsql/client';

async function fixAllTimestamps() {
  const db = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  console.log('Converting all non-UTC timestamps to consistent UTC format...\n');

  // Get all trades with non-standard timestamp format (contains +08:00 or has milliseconds)
  const result = await db.execute(
    'SELECT id, timestamp, symbol, type, close_reason FROM trades ORDER BY id'
  );

  let updatedCount = 0;

  for (const row of result.rows) {
    const r = row as any;
    const oldTimestamp = r.timestamp;

    // Check if it needs conversion (has +08:00 or has milliseconds with .Z)
    if (oldTimestamp.includes('+08:00') || oldTimestamp.match(/\.\d{3}Z$/)) {
      // Parse and convert to clean UTC format
      const date = new Date(oldTimestamp);
      const newTimestamp = date.toISOString();

      console.log(`ID ${r.id} | ${r.symbol} ${r.type} ${r.close_reason || ''}`);
      console.log(`  ${oldTimestamp} → ${newTimestamp}`);

      // Update the timestamp
      await db.execute({
        sql: 'UPDATE trades SET timestamp = ? WHERE id = ?',
        args: [newTimestamp, r.id]
      });

      updatedCount++;
    }
  }

  console.log(`\n✅ Updated ${updatedCount} timestamps to consistent UTC format`);
  process.exit(0);
}

fixAllTimestamps().catch(console.error);
