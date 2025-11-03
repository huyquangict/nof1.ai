/**
 * Check Binance for closed orders and compare with database
 */

import { createClient } from "@libsql/client";
import ccxt from 'ccxt';

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// Create Binance client
const testnet = process.env.USE_TESTNET === 'true';
const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
  options: {
    defaultType: 'future',
    adjustForTimeDifference: true,
  },
});

if (testnet) {
  exchange.setSandboxMode(true);
}

function normalizeSymbol(symbol: string): string {
  if (symbol.includes('/')) {
    return symbol;
  }
  return `${symbol}/USDT:USDT`;
}

async function checkClosedOrders() {
  console.log('🔍 Checking Binance for closed orders vs database...\n');

  // Get all order IDs from database
  const dbTradesResult = await dbClient.execute('SELECT order_id, type, status FROM trades');
  const dbOrderIds = new Set(dbTradesResult.rows.map((r: any) => r.order_id));

  console.log(`📊 Total trades in database: ${dbTradesResult.rows.length}`);
  console.log(`📊 Unique order IDs in database: ${dbOrderIds.size}\n`);

  // Get current positions with SL/TP orders
  const positionsResult = await dbClient.execute('SELECT symbol, sl_order_id, tp_orders, tp_order_id FROM positions');

  console.log('📍 Current positions and their SL/TP orders:\n');

  const allSlTpOrders: Array<{orderId: string, type: string, symbol: string}> = [];

  for (const row of positionsResult.rows) {
    const r = row as any;
    console.log(`${r.symbol}:`);

    // Check stop-loss
    if (r.sl_order_id) {
      console.log(`  SL Order: ${r.sl_order_id}`);
      allSlTpOrders.push({ orderId: r.sl_order_id, type: 'SL', symbol: r.symbol });
    }

    // Check multiple TP orders (new format)
    if (r.tp_orders) {
      try {
        const tpOrders = JSON.parse(r.tp_orders);
        for (const tp of tpOrders) {
          console.log(`  TP Order: ${tp.orderId} (${tp.percentage}% @ ${tp.price}, triggered: ${tp.triggered})`);
          allSlTpOrders.push({ orderId: tp.orderId, type: 'TP', symbol: r.symbol });
        }
      } catch (e) {
        console.log(`  Error parsing tp_orders`);
      }
    }

    // Check legacy single TP
    if (r.tp_order_id) {
      console.log(`  TP Order (legacy): ${r.tp_order_id}`);
      allSlTpOrders.push({ orderId: r.tp_order_id, type: 'TP', symbol: r.symbol });
    }
    console.log('');
  }

  console.log(`\n🔍 Checking ${allSlTpOrders.length} SL/TP orders on Binance...\n`);

  const closedButNotInDb: Array<{orderId: string, type: string, symbol: string, status: string, price: number}> = [];

  for (const {orderId, type, symbol} of allSlTpOrders) {
    try {
      const ccxtSymbol = normalizeSymbol(symbol);
      const order = await exchange.fetchOrder(orderId, ccxtSymbol);

      const isInDb = dbOrderIds.has(orderId);
      const isClosed = order.status === 'closed' || order.status === 'canceled';

      const price = order.average || order.price || 0;

      console.log(`${type} ${orderId} (${symbol}): status=${order.status}, in_db=${isInDb}, closed=${isClosed}, price=${price}`);

      if (isClosed && !isInDb && order.status === 'closed') {
        console.log(`  ⚠️  FOUND: Closed order NOT in database!`);
        closedButNotInDb.push({
          orderId,
          type,
          symbol,
          status: order.status,
          price: price
        });
      }

      // Add small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (error: any) {
      console.log(`${type} ${orderId} (${symbol}): ERROR - ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total SL/TP orders checked: ${allSlTpOrders.length}`);
  console.log(`Closed orders NOT in database: ${closedButNotInDb.length}\n`);

  if (closedButNotInDb.length > 0) {
    console.log('❌ Missing closed orders in database:');
    for (const order of closedButNotInDb) {
      console.log(`  ${order.type} ${order.orderId} (${order.symbol}): status=${order.status}, price=${order.price}`);
    }
  } else {
    console.log('✅ All closed SL/TP orders are recorded in database!');
  }
}

checkClosedOrders().catch(console.error);
