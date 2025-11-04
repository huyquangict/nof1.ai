import { createClient } from '@libsql/client';

async function checkDb() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  const result = await dbClient.execute(
    'SELECT symbol, sl_order_id, tp_orders FROM positions'
  );

  console.log('Database positions after cleanup:\n');
  for (const row of result.rows) {
    const r = row as any;
    console.log(`${r.symbol}:`);
    console.log(`  SL Order ID: ${r.sl_order_id || 'NULL'}`);
    console.log(`  TP Orders: ${r.tp_orders || 'NULL'}`);

    if (r.tp_orders) {
      try {
        const tps = JSON.parse(r.tp_orders);
        console.log(`  TP Details:`);
        for (const tp of tps) {
          console.log(`    - ${tp.percentage}% @ ${tp.price} (Order: ${tp.orderId})`);
        }
      } catch (e) {
        // ignore
      }
    }
    console.log();
  }

  process.exit(0);
}

checkDb().catch(console.error);
