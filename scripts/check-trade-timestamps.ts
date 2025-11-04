import { createClient } from '@libsql/client';

async function checkTimestamps() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  const result = await dbClient.execute(
    'SELECT timestamp, symbol, close_reason, type FROM trades ORDER BY id DESC LIMIT 10'
  );

  console.log('Recent trades timestamps:');
  for (const row of result.rows) {
    const r = row as any;
    console.log(`${r.timestamp} | ${r.symbol} | ${r.type} | ${r.close_reason || 'N/A'}`);
  }

  process.exit(0);
}

checkTimestamps().catch(console.error);
