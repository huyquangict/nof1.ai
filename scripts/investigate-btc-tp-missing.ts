import { createClient } from '@libsql/client';

async function investigate() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  console.log('=== 1. BTC POSITION OPENING TRADE ===\n');

  // Find when BTC position was opened
  const btcOpenTrade = await dbClient.execute(
    `SELECT * FROM trades WHERE symbol = 'BTC' AND type = 'open' ORDER BY timestamp DESC LIMIT 1`
  );

  if (btcOpenTrade.rows.length > 0) {
    const trade = btcOpenTrade.rows[0] as any;
    console.log(`BTC Position Opened:`);
    console.log(`  Timestamp: ${trade.timestamp}`);
    console.log(`  Order ID: ${trade.order_id}`);
    console.log(`  Price: ${trade.price}`);
    console.log(`  Quantity: ${trade.quantity}`);
    console.log(`  Leverage: ${trade.leverage}x`);
    console.log();

    // Find agent decision around that time
    console.log('=== 2. AGENT DECISION AT THAT TIME ===\n');

    const decision = await dbClient.execute({
      sql: `SELECT * FROM agent_decisions WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp LIMIT 3`,
      args: [
        new Date(new Date(trade.timestamp).getTime() - 60000).toISOString(),
        new Date(new Date(trade.timestamp).getTime() + 60000).toISOString(),
      ]
    });

    for (const d of decision.rows) {
      const dec = d as any;
      console.log(`Timestamp: ${dec.timestamp}`);
      console.log(`Decision: ${dec.decision}`);
      console.log(`Actions Taken:`);
      console.log(dec.actions_taken);
      console.log();
    }
  }

  console.log('=== 3. ALL BTC TRADES (LAST 10) ===\n');

  const allBtcTrades = await dbClient.execute(
    `SELECT timestamp, type, close_reason, order_id FROM trades WHERE symbol = 'BTC' ORDER BY timestamp DESC LIMIT 10`
  );

  for (const row of allBtcTrades.rows) {
    const r = row as any;
    console.log(`${r.timestamp} | ${r.type} | ${r.close_reason || 'N/A'} | Order: ${r.order_id}`);
  }

  console.log('\n=== 4. RECENT POSITION CHANGES ===\n');

  // Check if there were previous BTC positions that got closed
  const btcCloseTrades = await dbClient.execute(
    `SELECT timestamp, close_reason, order_id FROM trades WHERE symbol = 'BTC' AND type = 'close' ORDER BY timestamp DESC LIMIT 5`
  );

  console.log(`BTC Close Trades (Last 5):`);
  for (const row of btcCloseTrades.rows) {
    const r = row as any;
    console.log(`  ${r.timestamp} | Reason: ${r.close_reason} | Order: ${r.order_id}`);
  }

  console.log('\n=== 5. RECENT AGENT DECISIONS (LAST 5) ===\n');

  const recentDecisions = await dbClient.execute(
    `SELECT timestamp, decision, actions_taken FROM agent_decisions ORDER BY timestamp DESC LIMIT 5`
  );

  for (const d of recentDecisions.rows) {
    const dec = d as any;
    console.log(`[${dec.timestamp}]`);
    console.log(`Decision: ${dec.decision}`);
    console.log(`Actions:`);
    console.log(dec.actions_taken);
    console.log('---\n');
  }

  process.exit(0);
}

investigate().catch(console.error);
