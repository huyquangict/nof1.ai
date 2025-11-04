import { createClient } from '@libsql/client';
import { createExchangeClient } from '../src/services/exchange';

async function verifySlTpMatch() {
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  const exchangeClient = createExchangeClient();

  console.log('=== DATABASE POSITIONS ===\n');

  // Get positions from database
  const posResult = await dbClient.execute(
    'SELECT symbol, quantity, entry_price, side, leverage, sl_order_id, tp_orders, stop_loss, profit_target FROM positions'
  );

  const dbPositions = new Map();

  for (const row of posResult.rows) {
    const r = row as any;
    console.log(`${r.symbol} ${r.side.toUpperCase()}:`);
    console.log(`  Quantity: ${r.quantity}`);
    console.log(`  Entry Price: ${r.entry_price}`);
    console.log(`  Leverage: ${r.leverage}x`);
    console.log(`  Stop-Loss Order ID: ${r.sl_order_id || 'NULL'}`);
    console.log(`  Stop-Loss Price: ${r.stop_loss || 'NULL'}`);
    console.log(`  Profit Target Price: ${r.profit_target || 'NULL'}`);

    if (r.tp_orders) {
      try {
        const tpOrders = JSON.parse(r.tp_orders);
        console.log(`  TP Orders (${tpOrders.length}):`);
        for (const tp of tpOrders) {
          console.log(`    - TP${tp.level || ''}: ${tp.percentage}% @ ${tp.price} (Order ID: ${tp.orderId}, Triggered: ${tp.triggered})`);
        }
      } catch (e) {
        console.log(`  TP Orders: ${r.tp_orders}`);
      }
    } else {
      console.log(`  TP Orders: NULL`);
    }
    console.log();

    dbPositions.set(r.symbol, r);
  }

  console.log('\n=== EXCHANGE ORDERS ===\n');

  // Get open orders for each position symbol
  for (const [symbol, pos] of dbPositions) {
    const orders = await exchangeClient.getOpenOrders(symbol);
    console.log(`${symbol}: ${orders.length} open orders on exchange`);

    for (const order of orders) {
      console.log(`  - Order ${order.id}: ${order.side} ${order.quantity} @ ${order.price}`);
    }
    console.log();
  }

  console.log('\n=== VERIFICATION ===\n');

  for (const [symbol, pos] of dbPositions) {
    const orders = await exchangeClient.getOpenOrders(symbol);

    // Count expected orders: 1 SL + number of TPs
    let expectedOrders = 0;
    if (pos.sl_order_id) expectedOrders += 1;

    let tpCount = 0;
    if (pos.tp_orders) {
      try {
        const tpOrders = JSON.parse(pos.tp_orders);
        tpCount = tpOrders.filter((tp: any) => !tp.triggered).length;
        expectedOrders += tpCount;
      } catch (e) {
        // ignore
      }
    }

    console.log(`${symbol}:`);
    console.log(`  Expected: ${expectedOrders} orders (1 SL + ${tpCount} TPs)`);
    console.log(`  Actual on exchange: ${orders.length} orders`);

    if (orders.length > expectedOrders) {
      console.log(`  ⚠️  WARNING: ${orders.length - expectedOrders} extra orphaned orders!`);
    } else if (orders.length < expectedOrders) {
      console.log(`  ⚠️  WARNING: Missing ${expectedOrders - orders.length} orders!`);
    } else {
      console.log(`  ✅ Match!`);
    }
    console.log();
  }

  process.exit(0);
}

verifySlTpMatch().catch(console.error);
