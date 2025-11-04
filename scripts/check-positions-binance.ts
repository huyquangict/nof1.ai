import { createExchangeClient } from '../src/services/exchange';

async function checkPositions() {
  const client = createExchangeClient();

  console.log('Checking positions on Binance...\n');

  const positions = await client.getPositions();

  if (positions.length === 0) {
    console.log('No open positions on Binance');
    return;
  }

  for (const pos of positions) {
    console.log(`\n${pos.symbol} ${pos.side.toUpperCase()}:`);
    console.log(`  Quantity: ${pos.quantity}`);
    console.log(`  Entry Price: ${pos.entryPrice}`);
    console.log(`  Current Price: ${pos.currentPrice}`);
    console.log(`  Leverage: ${pos.leverage}x`);
    console.log(`  Unrealized PnL: ${pos.unrealizedPnl} USDT`);
    console.log(`  Margin: ${pos.margin} USDT`);
  }
}

checkPositions().catch(console.error);
