import { createExchangeClient } from '../src/services/exchange';

async function cancelAllOrders() {
  const client = createExchangeClient();
  const symbols = ['BTC', 'LTC', 'HBAR', 'SOL'];

  let totalCanceled = 0;

  for (const symbol of symbols) {
    try {
      const orders = await client.getOpenOrders(symbol);

      if (orders.length > 0) {
        console.log(`\n${symbol}: Canceling ${orders.length} orders...`);

        for (const order of orders) {
          try {
            await client.cancelOrder(order.id);
            console.log(`  ✅ Canceled order ${order.id}`);
            totalCanceled++;
          } catch (e: any) {
            console.log(`  ❌ Failed to cancel order ${order.id}: ${e.message}`);
          }
        }
      } else {
        console.log(`${symbol}: No orders to cancel`);
      }
    } catch (e: any) {
      console.log(`${symbol}: Error - ${e.message}`);
    }
  }

  console.log(`\n✅ Total canceled: ${totalCanceled} orders`);
}

cancelAllOrders().catch(console.error);
