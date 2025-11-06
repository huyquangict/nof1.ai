#!/usr/bin/env node
import { createExchangeClient } from './src/services/exchange/index.js';

async function main() {
  const client = createExchangeClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();
  
  console.log('\n3. Binance SOL Position:');
  
  try {
    // Get position from Binance
    const positions = await client.getPositions();
    const solPos = positions.find(p => p.symbol === 'SOL');
    
    if (solPos) {
      console.log(`   Position: ${solPos.side.toUpperCase()} ${solPos.quantity} @ ${solPos.entryPrice}`);
      console.log(`   PnL: ${solPos.unrealizedPnl} USDT`);
    } else {
      console.log('   No SOL position on Binance');
    }
    
    // Check orders
    const ccxtSymbol = client.normalizeSymbol('SOL');
    const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
    
    if (conditionalOrders.length > 0) {
      console.log(`\n4. Binance SOL Orders (${conditionalOrders.length}):`);
      for (const order of conditionalOrders) {
        console.log(`   ${order.id}: ${order.type} ${order.side} @ ${order.stopPrice} (${order.amount} contracts)`);
      }
    } else {
      console.log('\n4. No SOL orders on Binance');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main().catch(console.error);
