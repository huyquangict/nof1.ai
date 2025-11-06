#!/usr/bin/env tsx
/**
 * Verify orphan SL/TP orders and sync fix
 */

import { createExchangeClient } from './src/services/exchange';
import { createDbClient } from './src/database/client';

async function main() {
  const client = createExchangeClient();
  const dbClient = createDbClient();

  console.log('=== Verification Report ===\n');

  // 1. Get all positions from database
  const dbPositions = await dbClient.execute("SELECT symbol, side, entry_price, sl_orders, tp_orders FROM positions");

  console.log(`📊 Database Positions: ${dbPositions.rows.length}`);
  for (const row of dbPositions.rows) {
    const pos = row as any;
    console.log(`\n  ${pos.symbol} ${pos.side} @ ${pos.entry_price}`);

    if (pos.sl_orders) {
      const slOrders = JSON.parse(pos.sl_orders);
      console.log(`    SL orders in DB: ${slOrders.length}`);
      slOrders.forEach((sl: any, i: number) => {
        console.log(`      SL${i+1}: ${sl.orderId} @ ${sl.price} (${sl.percentage}%)`);
      });
    } else {
      console.log(`    ⚠️  NO SL orders in database`);
    }

    if (pos.tp_orders) {
      const tpOrders = JSON.parse(pos.tp_orders);
      console.log(`    TP orders in DB: ${tpOrders.length}`);
      tpOrders.forEach((tp: any, i: number) => {
        console.log(`      TP${i+1}: ${tp.orderId} @ ${tp.price} (${tp.percentage}%)`);
      });
    } else {
      console.log(`    NO TP orders in database`);
    }
  }

  // 2. Get all open orders from exchange
  console.log('\n\n🔍 Checking Binance for ALL open orders...\n');
  const allOpenOrders = await client.getOpenOrders();

  console.log(`Total open orders on Binance: ${allOpenOrders.length}`);

  if (allOpenOrders.length > 0) {
    for (const order of allOpenOrders) {
      console.log(`  Order ${order.id}: ${order.symbol} ${order.side} ${order.quantity} @ ${order.price || 'market'}`);
    }

    // 3. Check for orphans (orders on exchange but not in database)
    console.log('\n\n🚨 Checking for ORPHAN orders...\n');

    for (const order of allOpenOrders) {
      let isOrphan = true;

      // Check if this order is tracked in any position
      for (const row of dbPositions.rows) {
        const pos = row as any;

        if (pos.sl_orders) {
          const slOrders = JSON.parse(pos.sl_orders);
          if (slOrders.some((sl: any) => sl.orderId === order.id)) {
            isOrphan = false;
            break;
          }
        }

        if (pos.tp_orders) {
          const tpOrders = JSON.parse(pos.tp_orders);
          if (tpOrders.some((tp: any) => tp.orderId === order.id)) {
            isOrphan = false;
            break;
          }
        }
      }

      if (isOrphan) {
        console.log(`  ⚠️  ORPHAN: Order ${order.id} (${order.symbol}) not tracked in database!`);
      } else {
        console.log(`  ✅ Order ${order.id} (${order.symbol}) properly tracked`);
      }
    }
  } else {
    console.log('  ✅ No open orders on Binance');
  }

  console.log('\n\n=== Verification Complete ===');
}

main().catch(console.error);
