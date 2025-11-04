import { createExchangeClient } from '../src/services/exchange';
import { createClient } from '@libsql/client';

async function cleanupOrphanedOrders() {
  const client = createExchangeClient();
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  // Get current positions from database
  const positionsResult = await dbClient.execute('SELECT symbol, tp_orders, sl_order_id FROM positions WHERE quantity > 0');

  const activeOrderIds = new Set<string>();

  for (const row of positionsResult.rows) {
    const symbol = row.symbol as string;
    const tpOrders = row.tp_orders ? JSON.parse(row.tp_orders as string) : [];
    const slOrderId = row.sl_order_id as string;

    if (slOrderId) {
      activeOrderIds.add(slOrderId);
    }

    for (const tp of tpOrders) {
      if (tp.orderId) {
        activeOrderIds.add(tp.orderId);
      }
    }
  }

  const activeIds = Array.from(activeOrderIds);
  console.log(`Active order IDs from database (${activeIds.length}): ${activeIds.join(', ')}\n`);

  const symbols = ['BTC', 'LTC', 'HBAR', 'SOL'];
  let totalCanceled = 0;

  for (const symbol of symbols) {
    try {
      const orders = await client.getOpenOrders(symbol);

      if (orders.length > 0) {
        console.log(`\n${symbol}: ${orders.length} open orders on exchange`);

        for (const order of orders) {
          if (!activeOrderIds.has(order.id)) {
            console.log(`  - Canceling orphaned order ${order.id}`);
            try {
              await client.cancelOrder(order.id);
              totalCanceled++;
            } catch (e: any) {
              console.log(`    Error canceling: ${e.message}`);
            }
          } else {
            console.log(`  - Keeping active order ${order.id}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`${symbol}: Error - ${e.message}`);
    }
  }

  console.log(`\n✅ Cleanup complete! Canceled ${totalCanceled} orphaned orders.`);
}

cleanupOrphanedOrders().catch(console.error);
