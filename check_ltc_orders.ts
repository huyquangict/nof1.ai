#!/usr/bin/env node
import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();
  const ccxtSymbol = client.normalizeSymbol('LTC');

  console.log('=== Checking LTC orders on Binance ===\n');

  try {
    const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
    console.log(`Found ${conditionalOrders.length} conditional orders:`);
    
    const slOrders = conditionalOrders.filter((o: any) => o.type === 'stop_market');
    const tpOrders = conditionalOrders.filter((o: any) => o.type === 'take_profit_market');
    
    console.log(`\nSL Orders (${slOrders.length}):`);
    for (const order of slOrders) {
      console.log(`  ${order.id}: ${order.side} @ ${order.stopPrice} (${order.amount} contracts)`);
    }
    
    console.log(`\nTP Orders (${tpOrders.length}):`);
    for (const order of tpOrders) {
      console.log(`  ${order.id}: ${order.side} @ ${order.stopPrice} (${order.amount} contracts)`);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main().catch(console.error);
