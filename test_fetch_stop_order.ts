#!/usr/bin/env node
/**
 * Test if fetchOrder() can fetch STOP_MARKET orders
 */

import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();

  console.log('=== Testing fetchOrder() with STOP_MARKET orders ===\n');

  // Get known conditional orders (using TP orders since SL were cancelled)
  const testCases = [
    { symbol: 'SOL', orderId: '168106430675' },  // TP order
    { symbol: 'LTC', orderId: '39755020184' },   // TP order
  ];

  for (const { symbol, orderId } of testCases) {
    console.log(`\nTest: ${symbol} SL order ${orderId}`);

    const ccxtSymbol = client.normalizeSymbol(symbol);

    // Test 1: Using fetchOrder (what getOrder() uses)
    console.log('  Method 1: fetchOrder() - What BinanceAdapter.getOrder() uses');
    try {
      const order = await ccxt.fetchOrder(orderId, ccxtSymbol);
      console.log(`    ✅ Found: ${order.type} ${order.side} @ ${order.stopPrice || order.price} (status: ${order.status})`);
    } catch (error: any) {
      console.log(`    ❌ ERROR: ${error.message}`);
    }

    // Test 2: Using fetchOpenOrders with { stop: true }
    console.log('  Method 2: fetchOpenOrders with { stop: true }');
    try {
      const orders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
      const found = orders.find((o: any) => o.id === orderId);
      if (found) {
        console.log(`    ✅ Found: ${found.type} ${found.side} @ ${found.stopPrice || found.price} (status: ${found.status})`);
      } else {
        console.log(`    ❌ Not found in conditional orders`);
      }
    } catch (error: any) {
      console.log(`    ❌ ERROR: ${error.message}`);
    }
  }

  console.log('\n=== Test Complete ===');
  console.log('\n💡 If fetchOrder() fails but fetchOpenOrders works, then getOrder() needs to be fixed.');
}

main().catch(console.error);
