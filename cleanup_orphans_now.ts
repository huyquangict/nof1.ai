#!/usr/bin/env node
/**
 * Emergency cleanup of orphan conditional orders
 */

import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();

  console.log('=== EMERGENCY: Cleaning up orphan orders ===\n');

  // Get current positions
  const positions = await client.getPositions();
  const positionMap = new Map(positions.map(p => [p.symbol, p]));

  console.log('Current positions:');
  for (const pos of positions) {
    console.log(`  ${pos.symbol}: ${pos.side} qty=${pos.quantity}`);
  }

  // Fetch all conditional orders
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();

  const symbols = ['SOL', 'LTC'];
  let totalCancelled = 0;

  for (const symbol of symbols) {
    console.log(`\n🔍 Checking ${symbol}...`);

    const position = positionMap.get(symbol);
    if (!position) {
      console.log(`  ⚠️  No position found, skipping`);
      continue;
    }

    const ccxtSymbol = client.normalizeSymbol(symbol);

    try {
      // Fetch conditional orders
      const conditionalOrders = await ccxt.fetchOpenOrders(
        ccxtSymbol,
        undefined,
        undefined,
        { stop: true }
      );

      console.log(`  Found ${conditionalOrders.length} conditional orders`);

      for (const order of conditionalOrders) {
        // Determine if this is an orphan
        let isOrphan = false;
        const orderSide = order.side; // 'buy' or 'sell'

        // For long positions: sell orders are for exit (TP/SL), buy orders are orphans from old long
        // For short positions: buy orders are for exit (TP/SL), sell orders are orphans from old short

        if (position.side === 'long') {
          // Current position is long
          // sell orders (TP/SL for long) should be kept if stopPrice > entryPrice
          // buy orders are orphans from old long position
          if (orderSide === 'buy') {
            isOrphan = true;
            console.log(`  🔴 ORPHAN (buy order for long position): ${order.id} ${order.type} ${orderSide} @ ${order.stopPrice || order.price}`);
          } else if (orderSide === 'sell') {
            // Check if stopPrice suggests it's from old short position
            const stopPrice = order.stopPrice || order.price || 0;
            if (stopPrice < position.entryPrice) {
              // This is a stop-loss below entry for a LONG - that's wrong, must be orphan from short
              isOrphan = true;
              console.log(`  🔴 ORPHAN (SL below entry for long): ${order.id} ${order.type} ${orderSide} @ ${stopPrice}`);
            }
          }
        } else if (position.side === 'short') {
          // Current position is short
          // buy orders (TP/SL for short) should be kept if stopPrice < entryPrice
          // sell orders are orphans from old short position
          if (orderSide === 'sell') {
            isOrphan = true;
            console.log(`  🔴 ORPHAN (sell order for short position): ${order.id} ${order.type} ${orderSide} @ ${order.stopPrice || order.price}`);
          } else if (orderSide === 'buy') {
            // Check if stopPrice suggests it's from old long position
            const stopPrice = order.stopPrice || order.price || 0;
            if (stopPrice > position.entryPrice) {
              // This is a stop-loss above entry for a SHORT - that's wrong, must be orphan from long
              isOrphan = true;
              console.log(`  🔴 ORPHAN (SL above entry for short): ${order.id} ${order.type} ${orderSide} @ ${stopPrice}`);
            }
          }
        }

        if (isOrphan) {
          try {
            await ccxt.cancelOrder(order.id, ccxtSymbol);
            console.log(`  ✅ Cancelled orphan order ${order.id}`);
            totalCancelled++;
          } catch (err: any) {
            console.error(`  ❌ Failed to cancel ${order.id}: ${err.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`  ❌ Error processing ${symbol}: ${error.message}`);
    }
  }

  console.log(`\n=== Cleanup Complete ===`);
  console.log(`Total orphan orders cancelled: ${totalCancelled}`);
}

main().catch(console.error);
