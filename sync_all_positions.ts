#!/usr/bin/env node
import { createExchangeClient } from './src/services/exchange/index.js';
import { createDbClient } from './src/database/client.js';

async function main() {
  const client = createExchangeClient();
  const dbClient = createDbClient();
  const binanceAdapter = client as any;
  const ccxt = binanceAdapter.getUnderlyingExchange();

  console.log('=== Syncing All Positions with SL/TP Orders ===\n');

  // Get all positions from database
  const dbResult = await dbClient.execute("SELECT symbol, quantity, side FROM positions");
  
  for (const row of dbResult.rows) {
    const symbol = row.symbol as string;
    const dbQuantity = row.quantity as number;
    const side = row.side as string;
    
    console.log(`\n📊 ${symbol} ${side.toUpperCase()} (DB: ${dbQuantity} contracts)`);
    
    try {
      const ccxtSymbol = client.normalizeSymbol(symbol);
      
      // Fetch conditional orders
      const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
      const slOrders = conditionalOrders.filter((o: any) => o.type === 'stop_market');
      const tpOrders = conditionalOrders.filter((o: any) => o.type === 'take_profit_market');
      
      console.log(`  Binance: ${slOrders.length} SL + ${tpOrders.length} TP orders`);
      
      if (slOrders.length === 0 && tpOrders.length === 0) {
        console.log(`  ⚠️  No orders on Binance`);
        continue;
      }
      
      // Build SL orders array
      const slOrdersArray = slOrders.map((o: any) => ({
        price: o.stopPrice,
        percentage: Math.round((o.amount / dbQuantity) * 100),
        orderId: o.id,
        triggered: false
      }));
      
      // Build TP orders array
      const tpOrdersArray = tpOrders.map((o: any) => ({
        price: o.stopPrice,
        percentage: Math.round((o.amount / dbQuantity) * 100),
        orderId: o.id,
        triggered: false
      }));
      
      // Update database
      await dbClient.execute({
        sql: "UPDATE positions SET sl_orders = ?, tp_orders = ? WHERE symbol = ?",
        args: [
          slOrdersArray.length > 0 ? JSON.stringify(slOrdersArray) : null,
          tpOrdersArray.length > 0 ? JSON.stringify(tpOrdersArray) : null,
          symbol
        ]
      });
      
      console.log(`  ✅ Updated: ${slOrdersArray.length} SL, ${tpOrdersArray.length} TP`);
      
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n=== Sync Complete ===');
}

main().catch(console.error);
