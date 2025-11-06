#!/usr/bin/env node
import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();
  const ccxtSymbol = client.normalizeSymbol('SOL');

  console.log('=== Checking SOL orders on Binance ===\n');

  // Check conditional orders (SL/TP)
  try {
    const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
    console.log(`Found ${conditionalOrders.length} conditional orders:`);
    for (const order of conditionalOrders) {
      console.log(`  ${order.id}: ${order.type} ${order.side} @ ${order.stopPrice || order.price} (amount: ${order.amount})`);
    }
  } catch (error: any) {
    console.error('Error fetching conditional orders:', error.message);
  }

  // Check regular orders
  try {
    const regularOrders = await ccxt.fetchOpenOrders(ccxtSymbol);
    console.log(`\nFound ${regularOrders.length} regular orders:`);
    for (const order of regularOrders) {
      console.log(`  ${order.id}: ${order.type} ${order.side} @ ${order.price} (amount: ${order.amount})`);
    }
  } catch (error: any) {
    console.error('Error fetching regular orders:', error.message);
  }
}

main().catch(console.error);
