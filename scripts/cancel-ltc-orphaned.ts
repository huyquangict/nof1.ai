import { createExchangeClient } from '../src/services/exchange';

async function cancelLtcOrphaned() {
  const client = createExchangeClient();

  const orphanedIds = ['39727964202', '39727965191', '39727966198'];

  console.log('Canceling 3 orphaned LTC orders...\n');

  for (const orderId of orphanedIds) {
    try {
      await client.cancelOrder(orderId, 'LTC');
      console.log(`✅ Canceled order ${orderId}`);
    } catch (e: any) {
      console.log(`❌ Failed to cancel order ${orderId}: ${e.message}`);
    }
  }

  console.log('\nDone!');
  process.exit(0);
}

cancelLtcOrphaned().catch(console.error);
