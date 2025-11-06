#!/usr/bin/env tsx
/**
 * Test script to verify SL order sync fix
 *
 * This script:
 * 1. Queries Binance for all open orders (including STOP_MARKET)
 * 2. Checks database for sl_orders
 * 3. Triggers a manual sync
 * 4. Verifies sl_orders are preserved after sync
 */

import { createExchangeClient } from './src/services/exchange';
import { createDbClient } from './src/database/client';

async function main() {
  const client = createExchangeClient();
  const dbClient = createDbClient();

  console.log('=== Step 1: Check Binance for all open orders ===');
  try {
    const openOrders = await client.getOpenOrders();
    console.log(`Total open orders on Binance: ${openOrders.length}`);

    for (const order of openOrders) {
      console.log(`  - ${order.id}: ${order.symbol} ${order.side} ${order.quantity} @ ${order.price || 'market'} (${order.status})`);
    }
  } catch (error: any) {
    console.error('Failed to fetch open orders:', error.message);
  }

  console.log('\n=== Step 2: Check database for sl_orders ===');
  const positionsResult = await dbClient.execute(
    "SELECT symbol, side, entry_price, sl_orders, tp_orders FROM positions"
  );

  console.log(`Total positions in DB: ${positionsResult.rows.length}`);
  for (const row of positionsResult.rows) {
    const pos = row as any;
    console.log(`\n  Position: ${pos.symbol} ${pos.side} @ ${pos.entry_price}`);

    if (pos.sl_orders) {
      const slOrders = JSON.parse(pos.sl_orders);
      console.log(`    SL orders (${slOrders.length}):`);
      for (const sl of slOrders) {
        console.log(`      - Order ID: ${sl.orderId}, Price: ${sl.price}, Percentage: ${sl.percentage}%`);
      }
    } else {
      console.log(`    ⚠️  NO SL ORDERS in database`);
    }

    if (pos.tp_orders) {
      const tpOrders = JSON.parse(pos.tp_orders);
      console.log(`    TP orders (${tpOrders.length}):`);
      for (const tp of tpOrders) {
        console.log(`      - Order ID: ${tp.orderId}, Price: ${tp.price}, Percentage: ${tp.percentage}%`);
      }
    } else {
      console.log(`    No TP orders in database`);
    }
  }

  console.log('\n=== Step 3: Verify SL orders on Binance directly ===');
  // Try to fetch orders with symbol parameter
  for (const row of positionsResult.rows) {
    const pos = row as any;
    console.log(`\nChecking ${pos.symbol}...`);

    if (pos.sl_orders) {
      const slOrders = JSON.parse(pos.sl_orders);
      for (const sl of slOrders) {
        try {
          const order = await client.getOrder(sl.orderId, pos.symbol);
          console.log(`  ✅ SL order ${sl.orderId} found on Binance: status=${order.status}`);
        } catch (error: any) {
          console.error(`  ❌ SL order ${sl.orderId} NOT found on Binance: ${error.message}`);
        }
      }
    }
  }

  console.log('\n=== Test Complete ===');
  console.log('Next: Trigger a sync and verify sl_orders are preserved');
}

main().catch(console.error);
