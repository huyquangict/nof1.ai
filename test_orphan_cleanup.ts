#!/usr/bin/env node
/**
 * Test orphan cleanup by checking Binance for conditional orders
 */

import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();

  console.log('=== Testing Orphan Order Cleanup ===\n');

  // Get exchange name
  const exchangeName = client.getExchangeName();
  console.log(`Exchange: ${exchangeName}\n`);

  if (exchangeName !== 'Binance') {
    console.log('⚠️  This test is designed for Binance only');
    return;
  }

  // Get positions to know which symbols to check
  const positions = await client.getPositions();
  console.log(`Current positions: ${positions.length}`);

  for (const pos of positions) {
    console.log(`\n📊 Position: ${pos.symbol} ${pos.side} (qty: ${pos.quantity})`);

    // Test 1: Regular open orders (without conditional)
    console.log('\n  Test 1: Fetching regular open orders...');
    const regularOrders = await client.getOpenOrders(pos.symbol);
    console.log(`  ✅ Found ${regularOrders.length} regular orders`);
    for (const order of regularOrders) {
      console.log(`     - Order ${order.id}: ${order.type} ${order.side} @ ${order.price || 'market'}`);
    }

    // Test 2: Conditional orders using CCXT directly
    console.log('\n  Test 2: Fetching conditional (STOP_MARKET/TAKE_PROFIT_MARKET) orders...');
    try {
      const binanceAdapter = client as any;
      const ccxt = binanceAdapter.getUnderlyingExchange();
      const ccxtSymbol = client.normalizeSymbol(pos.symbol);

      const conditionalOrders = await ccxt.fetchOpenOrders(
        ccxtSymbol,
        undefined,
        undefined,
        { stop: true }
      );

      console.log(`  ✅ Found ${conditionalOrders.length} conditional orders`);
      for (const order of conditionalOrders) {
        console.log(`     - Order ${order.id}: ${order.type} ${order.side} @ ${order.stopPrice || order.price || 'market'}`);
      }
    } catch (error: any) {
      console.error(`  ❌ Error fetching conditional orders: ${error.message}`);
    }
  }

  // Test 3: Try fetching without symbol (all symbols)
  console.log('\n\n=== Test 3: Fetching all conditional orders (all symbols) ===');
  try {
    const binanceAdapter = client as any;
    const ccxt = binanceAdapter.getUnderlyingExchange();

    const allConditional = await ccxt.fetchOpenOrders(
      undefined,
      undefined,
      undefined,
      { stop: true }
    );

    console.log(`✅ Found ${allConditional.length} total conditional orders across all symbols`);
    for (const order of allConditional) {
      console.log(`   - ${order.symbol}: Order ${order.id} (${order.type}) ${order.side} @ ${order.stopPrice || order.price}`);
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }

  console.log('\n=== Test Complete ===');
  console.log('\n💡 If conditional orders are found, the orphan cleanup will work correctly.');
}

main().catch(console.error);
