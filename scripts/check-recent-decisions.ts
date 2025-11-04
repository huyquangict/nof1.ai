import { createClient } from '@libsql/client';

async function checkRecentDecisions() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  const result = await dbClient.execute(
    'SELECT timestamp, decision, actions_taken FROM agent_decisions ORDER BY timestamp DESC LIMIT 5'
  );

  console.log('Last 5 agent decisions:\n');

  for (const row of result.rows) {
    const r = row as any;
    console.log(`[${r.timestamp}]`);
    console.log(`Decision: ${r.decision.substring(0, 200)}${r.decision.length > 200 ? '...' : ''}`);
    console.log(`Actions: ${r.actions_taken}`);
    console.log('---\n');
  }

  // Check recent trades
  console.log('\nLast 5 trades:\n');
  const trades = await dbClient.execute(
    'SELECT timestamp, symbol, side, type, close_reason FROM trades ORDER BY timestamp DESC LIMIT 5'
  );

  for (const row of trades.rows) {
    const r = row as any;
    console.log(`${r.timestamp} | ${r.symbol} ${r.side} ${r.type} | ${r.close_reason || 'N/A'}`);
  }

  process.exit(0);
}

checkRecentDecisions().catch(console.error);
