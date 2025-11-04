import { createExchangeClient } from '../src/services/exchange';

async function checkOrders() {
  const client = createExchangeClient();
  
  const symbols = ['BTC', 'LTC', 'HBAR', 'SOL'];
  
  console.log('Checking open orders on Binance...\n');
  
  for (const symbol of symbols) {
    try {
      const orders = await client.getOpenOrders(symbol);
      if (orders.length > 0) {
        console.log(`${symbol}: ${orders.length} open orders`);
        orders.forEach(o => {
          console.log(`  - ID ${o.id}: ${o.side} ${o.type} @ ${o.price} (amount: ${o.amount})`);
        });
        console.log('');
      } else {
        console.log(`${symbol}: No open orders\n`);
      }
    } catch (e: any) {
      console.log(`${symbol}: Error - ${e.message}\n`);
    }
  }
}

checkOrders().catch(console.error);
