/**
 * Check Binance Trading Rules and Precision Requirements
 */

import ccxt from 'ccxt';

async function checkBinancePrecision() {
  console.log('=== Binance Trading Rules & Precision ===\n');

  const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    options: {
      defaultType: 'future',
    },
  });

  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'BCH/USDT', 'DOGE/USDT', 'LTC/USDT', 'HBAR/USDT'];

  try {
    // Load markets to get trading rules
    await exchange.loadMarkets();

    for (const symbol of symbols) {
      console.log(`\n${symbol}:`);
      console.log('='.repeat(50));

      const market = exchange.market(symbol);

      if (market) {
        console.log(`  Market ID: ${market.id}`);
        console.log(`  Base: ${market.base}, Quote: ${market.quote}`);
        console.log(`  Active: ${market.active}`);
        console.log(`  Contract: ${market.contract}`);

        // Precision
        console.log('\n  PRECISION:');
        console.log(`    Amount: ${market.precision?.amount} decimals`);
        console.log(`    Price: ${market.precision?.price} decimals`);
        console.log(`    Base: ${market.precision?.base} decimals`);
        console.log(`    Quote: ${market.precision?.quote} decimals`);

        // Limits
        console.log('\n  LIMITS:');
        if (market.limits?.amount) {
          console.log(`    Amount Min: ${market.limits.amount.min}`);
          console.log(`    Amount Max: ${market.limits.amount.max}`);
        }
        if (market.limits?.price) {
          console.log(`    Price Min: ${market.limits.price.min}`);
          console.log(`    Price Max: ${market.limits.price.max}`);
        }
        if (market.limits?.cost) {
          console.log(`    Cost (Notional) Min: ${market.limits.cost.min} USDT`);
          console.log(`    Cost (Notional) Max: ${market.limits.cost.max} USDT`);
        }

        // Contract details
        if (market.info) {
          console.log('\n  CONTRACT INFO:');
          console.log(`    Contract Size: ${market.contractSize || market.info.contractSize || 'N/A'}`);
          console.log(`    Tick Size: ${market.info.filters?.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize || 'N/A'}`);
          console.log(`    Step Size: ${market.info.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize || 'N/A'}`);
          console.log(`    Min Qty: ${market.info.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.minQty || 'N/A'}`);
          console.log(`    Max Qty: ${market.info.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.maxQty || 'N/A'}`);
          console.log(`    Min Notional: ${market.info.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL')?.notional || 'N/A'}`);
        }

        // Calculate example order sizes
        console.log('\n  EXAMPLE CALCULATIONS:');
        const currentPrice = (await exchange.fetchTicker(symbol)).last || 0;
        console.log(`    Current Price: ${currentPrice}`);

        const minNotional = market.limits?.cost?.min || 5; // Default to 5 USDT if not specified
        const minQty = market.limits?.amount?.min || 0.001;
        const stepSize = market.info?.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize || 0.001;

        console.log(`    Min Notional: ${minNotional} USDT`);
        console.log(`    Min Quantity: ${minQty} ${market.base}`);
        console.log(`    Step Size: ${stepSize} ${market.base}`);

        // Calculate minimum order for 10 USDT with 15x leverage
        const orderValue = 10; // USDT
        const leverage = 15;
        const positionValue = orderValue * leverage; // 150 USDT
        const quantity = positionValue / currentPrice;
        const roundedQty = Math.floor(quantity / parseFloat(stepSize)) * parseFloat(stepSize);

        console.log(`\n    For ${orderValue} USDT at ${leverage}x leverage:`);
        console.log(`      Position Value: ${positionValue} USDT`);
        console.log(`      Raw Quantity: ${quantity.toFixed(8)} ${market.base}`);
        console.log(`      Rounded Quantity: ${roundedQty.toFixed(8)} ${market.base}`);
        console.log(`      Actual Notional: ${(roundedQty * currentPrice).toFixed(2)} USDT`);
        console.log(`      Valid: ${roundedQty >= minQty && (roundedQty * currentPrice) >= minNotional ? '✅' : '❌'}`);
      } else {
        console.log(`  ❌ Market not found`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ All trading rules retrieved successfully');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBinancePrecision();
