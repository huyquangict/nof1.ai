import { createExchangeClient } from '../src/services/exchange';

const TIMEFRAME_CONFIGS: Record<string, { interval: string; candleCount: number }> = {
  "1m": { interval: "1m", candleCount: 60 },
  "3m": { interval: "3m", candleCount: 100 },
  "5m": { interval: "5m", candleCount: 100 },
  "15m": { interval: "15m", candleCount: 96 },
  "30m": { interval: "30m", candleCount: 90 },
  "1h": { interval: "1h", candleCount: 120 },
  "4h": { interval: "4h", candleCount: 60 },
  "8h": { interval: "8h", candleCount: 30 },
};

async function testTimeframes() {
  const client = createExchangeClient();
  const symbol = 'BTC';

  console.log(`Testing all timeframes for ${symbol}...\n`);

  for (const [timeframe, config] of Object.entries(TIMEFRAME_CONFIGS)) {
    try {
      console.log(`Testing ${timeframe} (interval: ${config.interval}, count: ${config.candleCount})...`);

      const start = Date.now();
      const candles = await client.getFuturesCandles(symbol, config.interval as any, config.candleCount);
      const duration = Date.now() - start;

      if (candles && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        console.log(`  ✅ SUCCESS: Fetched ${candles.length} candles in ${duration}ms`);
        console.log(`  Latest candle: time=${lastCandle.t}, open=${lastCandle.o}, high=${lastCandle.h}, low=${lastCandle.l}, close=${lastCandle.c}, volume=${lastCandle.v}`);
      } else {
        console.log(`  ⚠️  WARNING: No candles returned`);
      }
    } catch (error: any) {
      console.log(`  ❌ ERROR: ${error.message}`);
    }

    console.log();
  }

  console.log('Test completed!');
  process.exit(0);
}

testTimeframes().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
