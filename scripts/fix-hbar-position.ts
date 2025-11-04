import { createExchangeClient } from '../src/services/exchange';
import { createClient } from '@libsql/client';

async function fixHbarPosition() {
  const client = createExchangeClient();
  const dbClient = createClient({
    url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db',
  });

  console.log('🔧 Fixing HBAR position...\n');

  // 1. Cancel all orphaned orders
  console.log('Step 1: Canceling all open HBAR orders...');
  try {
    const orders = await client.getOpenOrders('HBAR');
    console.log(`Found ${orders.length} open orders`);

    for (const order of orders) {
      try {
        await client.cancelOrder(order.id, 'HBAR');
        console.log(`  ✅ Canceled order ${order.id}`);
      } catch (e: any) {
        console.log(`  ⚠️  Could not cancel order ${order.id}: ${e.message}`);
      }
    }
  } catch (error: any) {
    console.log(`  Error getting orders: ${error.message}`);
  }

  // 2. Get current position from exchange
  console.log('\nStep 2: Getting current position from exchange...');
  const positions = await client.getPositions();
  const hbarPos = positions.find(p => p.symbol === 'HBAR');

  if (!hbarPos) {
    console.log('  ❌ No HBAR position on exchange!');
    // Clear database
    await dbClient.execute({
      sql: 'DELETE FROM positions WHERE symbol = ?',
      args: ['HBAR']
    });
    console.log('  ✅ Cleaned database');
    process.exit(0);
  }

  console.log(`  Position: ${hbarPos.side} ${hbarPos.quantity} @ ${hbarPos.entryPrice}`);
  console.log(`  Current price: ${hbarPos.currentPrice}`);
  console.log(`  Unrealized PnL: ${hbarPos.unrealizedPnl}`);

  // 3. Update database with correct values
  console.log('\nStep 3: Updating database...');
  await dbClient.execute({
    sql: `UPDATE positions
          SET quantity = ?, entry_price = ?, current_price = ?, unrealized_pnl = ?,
              stop_loss = NULL, profit_target = NULL, sl_order_id = NULL, tp_orders = NULL
          WHERE symbol = ?`,
    args: [hbarPos.quantity, hbarPos.entryPrice, hbarPos.currentPrice, hbarPos.unrealizedPnl, 'HBAR']
  });
  console.log('  ✅ Database updated');

  // 4. Calculate correct stop-loss price for SHORT position
  console.log('\nStep 4: Calculating correct stop-loss...');
  const ticker = await client.getFuturesTicker('HBAR');
  const currentPrice = ticker.lastPrice;

  // For SHORT: stop-loss should be ABOVE entry price (to limit losses if price rises)
  // Example: entry 0.17624, use -2% stop = 0.17624 * 1.02 = 0.17977
  const stopLossPercent = 0.02; // 2% stop-loss
  const stopLossPrice = hbarPos.entryPrice * (1 + stopLossPercent);

  console.log(`  Entry: ${hbarPos.entryPrice}`);
  console.log(`  Current: ${currentPrice}`);
  console.log(`  Calculated SL: ${stopLossPrice.toFixed(5)} (${(stopLossPercent * 100).toFixed(1)}% above entry)`);

  if (stopLossPrice < currentPrice) {
    console.log(`  ⚠️  WARNING: SL ${stopLossPrice.toFixed(5)} is below current price ${currentPrice.toFixed(5)}!`);
    console.log(`  This position is already in loss. Consider manual close or adjust SL.`);
  }

  console.log('\n✅ Fix complete!');
  console.log('\nNext steps:');
  console.log('1. Use setStopLoss tool to set stop-loss at:', stopLossPrice.toFixed(5));
  console.log('2. Use setTakeProfit tool to set take-profit orders');
  console.log('3. Monitor position closely');

  process.exit(0);
}

fixHbarPosition().catch((error) => {
  console.error('❌ Fix failed:', error);
  process.exit(1);
});
