import { createClient } from '@libsql/client';

async function checkBtcTrades() {
  const db = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  const result = await db.execute({
    sql: 'SELECT timestamp, symbol, side, type, close_reason, pnl FROM trades WHERE symbol = ? ORDER BY timestamp DESC LIMIT 10',
    args: ['BTC']
  });

  console.log('BTC trades (last 10):\n');
  for (const row of result.rows) {
    const r = row as any;
    console.log(`${r.timestamp} | ${r.side} ${r.type} | ${r.close_reason || 'N/A'} | PnL: ${r.pnl || 'N/A'}`);
  }

  process.exit(0);
}

checkBtcTrades().catch(console.error);
