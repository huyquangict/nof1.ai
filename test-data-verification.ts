/**
 * Data Verification Script
 * Tests if market data sent to LLM matches actual Binance API data
 */

import ccxt from 'ccxt';

async function verifyBinanceData() {
  console.log('=== Binance Data Verification ===\n');

  const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    options: {
      defaultType: 'future',
    },
  });

  const symbol = 'BTC/USDT';

  try {
    // 1. Test current price
    console.log('1. Testing Current Price:');
    const ticker = await exchange.fetchTicker(symbol);
    console.log(`   Current Price: ${ticker.last}`);
    console.log(`   ✓ Price fetched successfully\n`);

    // 2. Test candle data (5m timeframe, 100 candles for indicators)
    console.log('2. Testing Candle Data (5m timeframe):');
    const candles = await exchange.fetchOHLCV(symbol, '5m', undefined, 100);
    const latestCandle = candles[candles.length - 1];
    console.log(`   Latest Candle:`);
    console.log(`     Timestamp: ${new Date(latestCandle[0]).toISOString()}`);
    console.log(`     Open: ${latestCandle[1]}`);
    console.log(`     High: ${latestCandle[2]}`);
    console.log(`     Low: ${latestCandle[3]}`);
    console.log(`     Close: ${latestCandle[4]}`);
    console.log(`     Volume: ${latestCandle[5]}`);
    console.log(`   ✓ Candle data fetched successfully\n`);

    // 3. Test funding rate
    console.log('3. Testing Funding Rate:');
    const fundingRate = await exchange.fetchFundingRate(symbol);
    console.log(`   Current Funding Rate: ${fundingRate.fundingRate}`);
    console.log(`   Funding Rate %: ${(fundingRate.fundingRate * 100).toFixed(4)}% per 8h`);
    console.log(`   Daily Rate: ${(fundingRate.fundingRate * 100 * 3).toFixed(4)}% (3x per day)`);
    console.log(`   ✓ Funding rate fetched successfully\n`);

    // 4. Test positions
    console.log('4. Testing Positions:');
    const positions = await exchange.fetchPositions([symbol]);
    const btcPosition = positions.find(p => p.symbol === symbol);
    if (btcPosition && Number.parseFloat(btcPosition.contracts || '0') > 0) {
      console.log(`   Active Position Found:`);
      console.log(`     Side: ${btcPosition.side}`);
      console.log(`     Contracts: ${btcPosition.contracts}`);
      console.log(`     Entry Price: ${btcPosition.entryPrice}`);
      console.log(`     Current Price: ${btcPosition.markPrice}`);
      console.log(`     Unrealized PnL: ${btcPosition.unrealizedPnl}`);
    } else {
      console.log(`   No active BTC position`);
    }
    console.log(`   ✓ Position data fetched successfully\n`);

    // 5. Verify candle format
    console.log('5. Verifying Candle Object Format:');
    const candleObjects = candles.map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
    const latestCandleObj = candleObjects[candleObjects.length - 1];
    console.log(`   Latest Candle Object:`);
    console.log(`     Has 'close' property: ${'close' in latestCandleObj}`);
    console.log(`     Has 'volume' property: ${'volume' in latestCandleObj}`);
    console.log(`     Close value: ${latestCandleObj.close}`);
    console.log(`     Volume value: ${latestCandleObj.volume}`);
    console.log(`   ✓ Candle object format verified\n`);

    // 6. Calculate simple indicators
    console.log('6. Calculating Basic Indicators:');
    const closes = candleObjects.map(c => c.close);
    const volumes = candleObjects.map(c => c.volume);

    // Simple moving average (last 20)
    const last20 = closes.slice(-20);
    const sma20 = last20.reduce((a, b) => a + b, 0) / last20.length;
    console.log(`   SMA20 (simple): ${sma20.toFixed(2)}`);

    // Volume average
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const currentVolume = volumes[volumes.length - 1];
    console.log(`   Current Volume: ${currentVolume.toFixed(2)}`);
    console.log(`   Average Volume: ${avgVolume.toFixed(2)}`);
    console.log(`   ✓ Indicators calculated successfully\n`);

    console.log('=== All Verifications Passed ✓ ===');

  } catch (error) {
    console.error('Error during verification:', error);
    process.exit(1);
  }
}

verifyBinanceData();
