#!/usr/bin/env node
/**
 * Clean up orphan BTC SL orders
 */

import { createExchangeClient } from './src/services/exchange/index.js';
import { createDbClient } from './src/database/client.js';

async function main() {
  const client = createExchangeClient();
  const dbClient = createDbClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();

  console.log('=== Cleaning up BTC orphan orders ===\n');

  // Get tracked SL from database
  const dbResult = await dbClient.execute({
    sql: "SELECT sl_orders FROM positions WHERE symbol = 'BTC'",
    args: []
  });

  let trackedOrderIds: string[] = [];
  if (dbResult.rows.length > 0) {
    const row = dbResult.rows[0] as any;
    if (row.sl_orders) {
      const slOrders = JSON.parse(row.sl_orders);
      trackedOrderIds = slOrders.map((sl: any) => sl.orderId);
      console.log('Tracked SL orders in database:', trackedOrderIds);
    }
  }

  // Get all conditional orders for BTC
  const ccxtSymbol = client.normalizeSymbol('BTC');
  const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });

  console.log(`\nFound ${conditionalOrders.length} conditional orders on Binance:`);

  let cancelledCount = 0;
  for (const order of conditionalOrders) {
    const isTracked = trackedOrderIds.includes(order.id);

    if (isTracked) {
      console.log(`  ✅ ${order.id}: ${order.type} ${order.side} @ ${order.stopPrice} - TRACKED (keeping)`);
    } else {
      console.log(`  🔴 ${order.id}: ${order.type} ${order.side} @ ${order.stopPrice} - ORPHAN (canceling...)`);
      try {
        await ccxt.cancelOrder(order.id, ccxtSymbol);
        console.log(`     ✅ Cancelled`);
        cancelledCount++;
      } catch (error: any) {
        console.error(`     ❌ Failed: ${error.message}`);
      }
    }
  }

  console.log(`\n=== Cleanup Complete ===`);
  console.log(`Cancelled ${cancelledCount} orphan orders`);
}

main().catch(console.error);
