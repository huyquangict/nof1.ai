import { createClient } from '@libsql/client';

async function checkSlTpTrades() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  // Get all stop_loss and take_profit trades
  const result = await dbClient.execute(
    `SELECT timestamp, symbol, side, close_reason, price, quantity, leverage, pnl, fee
     FROM trades
     WHERE close_reason IN ('stop_loss', 'take_profit', 'take_profit_partial')
     ORDER BY timestamp DESC
     LIMIT 20`
  );

  console.log('SL/TP Trades in Database:');
  console.log('='.repeat(120));

  if (result.rows.length === 0) {
    console.log('No SL/TP triggered trades found in database');
  } else {
    for (const row of result.rows) {
      const r = row as any;
      console.log(`\nTimestamp: ${r.timestamp}`);
      console.log(`Symbol: ${r.symbol} | Side: ${r.side} | Reason: ${r.close_reason}`);
      console.log(`Price: ${r.price} | Quantity: ${r.quantity} | Leverage: ${r.leverage}x`);
      console.log(`PnL: ${r.pnl} USDT | Fee: ${r.fee} USDT`);

      // Check if fee is 0 (indicates old calculation)
      if (r.fee === 0 || r.fee === null) {
        console.log('⚠️  WARNING: Fee is 0 or null - this trade was recorded with OLD code');
      } else {
        console.log('✅ Fee is set - this trade was recorded with NEW code');
      }
    }
  }

  process.exit(0);
}

checkSlTpTrades().catch(console.error);
