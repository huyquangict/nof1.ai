#!/usr/bin/env node
import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();
  
  // Try both HBAR and HBA
  for (const symbol of ['HBAR', 'HBA']) {
    try {
      const ccxtSymbol = client.normalizeSymbol(symbol);
      console.log(`\n=== Checking ${symbol} orders on Binance ===`);
      
      const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
      console.log(`Found ${conditionalOrders.length} conditional orders:`);
      
      const slOrders = conditionalOrders.filter(o => o.type === 'stop_market');
      const tpOrders = conditionalOrders.filter(o => o.type === 'take_profit_market');
      
      console.log(`\nSL Orders (${slOrders.length}):`);
      for (const order of slOrders) {
        console.log(`  ${order.id}: ${order.side} @ ${order.stopPrice} (${order.amount} contracts)`);
      }
      
      console.log(`\nTP Orders (${tpOrders.length}):`);
      for (const order of tpOrders) {
        console.log(`  ${order.id}: ${order.side} @ ${order.stopPrice} (${order.amount} contracts)`);
      }
      
      if (conditionalOrders.length > 0) break;
    } catch (error: any) {
      console.log(`No position for ${symbol}`);
    }
  }
}

main().catch(console.error);
