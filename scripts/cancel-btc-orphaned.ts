import { createExchangeClient } from '../src/services/exchange';

async function cancelBtcOrphaned() {
  const client = createExchangeClient();

  const orderId = '809430713279';

  console.log(`Canceling orphaned BTC order ${orderId}...\n`);

  try {
    await client.cancelOrder(orderId, 'BTC');
    console.log(`✅ Canceled order ${orderId}`);
  } catch (e: any) {
    console.log(`❌ Failed: ${e.message}`);
  }

  console.log('\nDone!');
  process.exit(0);
}

cancelBtcOrphaned().catch(console.error);
