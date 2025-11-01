/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Trading Loop - Execute trading decisions periodically
 */
import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createTradingAgent, generateTradingPrompt, getAccountRiskConfig } from "../agents/tradingAgent";
import { createExchangeClient } from "../services/exchange";
import { getChinaTimeISO } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";
import { getQuantoMultiplier } from "../utils/contractUtils";

const logger = createPinoLogger({
  name: "trading-loop",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// Supported trading symbols - read from config
const SYMBOLS = [...RISK_PARAMS.TRADING_SYMBOLS] as string[];

// Trading start time
let tradingStartTime = new Date();
let iterationCount = 0;

// Account risk configuration
let accountRiskConfig = getAccountRiskConfig();

/**
 * Ensure the value is a valid finite number, otherwise return the default value
 */
function ensureFinite(value: number, defaultValue: number = 0): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return value;
}

/**
 * Ensure the value is within the specified range
 */
function ensureRange(value: number, min: number, max: number, defaultValue?: number): number {
  if (!Number.isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : (min + max) / 2;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Collect all market data (including multi-timeframe analysis and time series data)
 * Optimization: Add data validation and error handling, return time series data for prompts
 */
async function collectMarketData() {
  const exchangeClient = createExchangeClient();
  const marketData: Record<string, any> = {};

  for (const symbol of SYMBOLS) {
    try {
      const contract = exchangeClient.normalizeSymbol(symbol);

      // Fetch price (with retry)
      let ticker: any = null;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          ticker = await exchangeClient.getFuturesTicker(symbol);

          // Validate price data validity
          const price = ticker.lastPrice;
          if (price === 0 || !Number.isFinite(price)) {
            throw new Error(`Invalid price: ${price}`);
          }

          break; // Success, break retry loop
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            logger.error(`${symbol} price fetch failed (${maxRetries} retries):`, error as any);
            throw error;
          }
          logger.warn(`${symbol} price fetch failed, retrying ${retryCount}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Fetch candlestick data for all timeframes
      const candles1m = await exchangeClient.getFuturesCandles(symbol, "1m", 60);
      const candles3m = await exchangeClient.getFuturesCandles(symbol, "3m", 60);
      const candles5m = await exchangeClient.getFuturesCandles(symbol, "5m", 100);
      const candles15m = await exchangeClient.getFuturesCandles(symbol, "15m", 96);
      const candles30m = await exchangeClient.getFuturesCandles(symbol, "30m", 90);
      const candles1h = await exchangeClient.getFuturesCandles(symbol, "1h", 120);

      // Calculate indicators for each timeframe
      const indicators1m = calculateIndicators(candles1m);
      const indicators3m = calculateIndicators(candles3m);
      const indicators5m = calculateIndicators(candles5m);
      const indicators15m = calculateIndicators(candles15m);
      const indicators30m = calculateIndicators(candles30m);
      const indicators1h = calculateIndicators(candles1h);

      // Calculate 3-minute time series indicators (use all 60 data points for calculation, but only display the last 10 data points)
      const intradaySeries = calculateIntradaySeries(candles3m);

      // Calculate 1-hour indicators as longer-term context
      const longerTermContext = calculateLongerTermContext(candles1h);

      // Use 5-minute candlestick data as main indicators (for compatibility)
      const indicators = indicators5m;

      // Validate technical indicators validity and data completeness
      const dataTimestamp = new Date().toISOString();
      const dataQuality = {
        price: Number.isFinite(ticker.lastPrice),
        ema20: Number.isFinite(indicators.ema20),
        macd: Number.isFinite(indicators.macd),
        rsi14: Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 0 && indicators.rsi14 <= 100,
        volume: Number.isFinite(indicators.volume) && indicators.volume >= 0,
        candleCount: {
          "1m": candles1m.length,
          "3m": candles3m.length,
          "5m": candles5m.length,
          "15m": candles15m.length,
          "30m": candles30m.length,
          "1h": candles1h.length,
        }
      };

      // Log data quality issues
      const issues: string[] = [];
      if (!dataQuality.price) issues.push("Invalid price");
      if (!dataQuality.ema20) issues.push("Invalid EMA20");
      if (!dataQuality.macd) issues.push("Invalid MACD");
      if (!dataQuality.rsi14) issues.push("Invalid or out-of-range RSI14");
      if (!dataQuality.volume) issues.push("Invalid volume");
      if (indicators.volume === 0) issues.push("Current volume is 0");

      if (issues.length > 0) {
        logger.warn(`${symbol} data quality issues [${dataTimestamp}]: ${issues.join(", ")}`);
        logger.debug(`${symbol} candlestick count:`, dataQuality.candleCount);
      } else {
        logger.debug(`${symbol} data quality check passed [${dataTimestamp}]`);
      }

      // Fetch funding rate
      let fundingRate = 0;
      try {
        const fr = await exchangeClient.getFundingRate(symbol);
        fundingRate = fr.rate;
        if (!Number.isFinite(fundingRate)) {
          fundingRate = 0;
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${symbol} funding rate:`, error as any);
      }

      // Fetch open interest - skip for now
      let openInterest = { latest: 0, average: 0 };
      // Note: Not all exchanges provide open interest data

      // Add multi-timeframe indicators to market data
      marketData[symbol] = {
        price: ticker.lastPrice,
        change24h: ticker.change24h,
        volume24h: ticker.volume24h,
        fundingRate,
        openInterest,
        ...indicators,
        // Add time series data (refer to 1.md format)
        intradaySeries,
        longerTermContext,
        // Add multi-timeframe indicators directly
        timeframes: {
          "1m": indicators1m,
          "3m": indicators3m,
          "5m": indicators5m,
          "15m": indicators15m,
          "30m": indicators30m,
          "1h": indicators1h,
        },
      };

      // Save technical indicators to database (ensure all values are valid)
      await dbClient.execute({
        sql: `INSERT INTO trading_signals
              (symbol, timestamp, price, ema_20, ema_50, macd, rsi_7, rsi_14, volume, funding_rate)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          symbol,
          getChinaTimeISO(),
          ensureFinite(marketData[symbol].price),
          ensureFinite(indicators.ema20),
          ensureFinite(indicators.ema50),
          ensureFinite(indicators.macd),
          ensureFinite(indicators.rsi7, 50), // RSI default 50
          ensureFinite(indicators.rsi14, 50),
          ensureFinite(indicators.volume),
          ensureFinite(fundingRate),
        ],
      });
    } catch (error) {
      logger.error(`Failed to collect market data for ${symbol}:`, error as any);
    }
  }

  return marketData;
}

/**
 * Calculate intraday time series data (3-minute level)
 * Refer to 1.md format
 * @param candles All historical data (at least 60 data points)
 */
function calculateIntradaySeries(candles: any[]) {
  if (!candles || candles.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // Extract closing prices
  const closes = candles.map((c) => {
    // Standard Candle format (Binance, CCXT)
    if (c && typeof c === 'object' && 'close' in c) {
      return Number.parseFloat(c.close);
    }
    // Gate.io format (FuturesCandlestick)
    if (c && typeof c === 'object' && 'c' in c) {
      return Number.parseFloat(c.c);
    }
    // Array format (for backward compatibility)
    if (Array.isArray(c)) {
      return Number.parseFloat(c[4]); // Index 4 for close price
    }
    return NaN;
  }).filter(n => Number.isFinite(n));

  if (closes.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // Calculate indicators for each time point
  const midPrices = closes;
  const ema20Series: number[] = [];
  const macdSeries: number[] = [];
  const rsi7Series: number[] = [];
  const rsi14Series: number[] = [];

  // Calculate indicators for each data point (using all historical data up to that point)
  for (let i = 0; i < closes.length; i++) {
    const historicalPrices = closes.slice(0, i + 1);

    // EMA20 - requires at least 20 data points
    ema20Series.push(historicalPrices.length >= 20 ? calcEMA(historicalPrices, 20) : historicalPrices[historicalPrices.length - 1]);

    // MACD - requires at least 26 data points
    macdSeries.push(historicalPrices.length >= 26 ? calcMACD(historicalPrices) : 0);

    // RSI7 - requires at least 8 data points
    rsi7Series.push(historicalPrices.length >= 8 ? calcRSI(historicalPrices, 7) : 50);

    // RSI14 - requires at least 15 data points
    rsi14Series.push(historicalPrices.length >= 15 ? calcRSI(historicalPrices, 14) : 50);
  }

  // Return only the last 10 data points
  const sliceIndex = Math.max(0, midPrices.length - 10);
  return {
    midPrices: midPrices.slice(sliceIndex),
    ema20Series: ema20Series.slice(sliceIndex),
    macdSeries: macdSeries.slice(sliceIndex),
    rsi7Series: rsi7Series.slice(sliceIndex),
    rsi14Series: rsi14Series.slice(sliceIndex),
  };
}

/**
 * Calculate longer-term context data (1-hour level - for short-term trading)
 * Refer to 1.md format
 */
function calculateLongerTermContext(candles: any[]) {
  if (!candles || candles.length < 26) {
    return {
      ema20: 0,
      ema50: 0,
      atr3: 0,
      atr14: 0,
      currentVolume: 0,
      avgVolume: 0,
      macdSeries: [],
      rsi14Series: [],
    };
  }

  const closes = candles.map((c) => {
    // Standard Candle format (Binance, CCXT)
    if (c && typeof c === 'object' && 'close' in c) {
      return Number.parseFloat(c.close);
    }
    // Gate.io format (FuturesCandlestick)
    if (c && typeof c === 'object' && 'c' in c) {
      return Number.parseFloat(c.c);
    }
    // Array format (for backward compatibility)
    if (Array.isArray(c)) {
      return Number.parseFloat(c[4]); // Index 4 for close price
    }
    return NaN;
  }).filter(n => Number.isFinite(n));

  const highs = candles.map((c) => {
    if (c && typeof c === 'object' && 'high' in c) {
      return Number.parseFloat(c.high);
    }
    if (c && typeof c === 'object' && 'h' in c) {
      return Number.parseFloat(c.h);
    }
    if (Array.isArray(c)) {
      return Number.parseFloat(c[2]); // Index 2 for high price
    }
    return NaN;
  }).filter(n => Number.isFinite(n));

  const lows = candles.map((c) => {
    if (c && typeof c === 'object' && 'low' in c) {
      return Number.parseFloat(c.low);
    }
    if (c && typeof c === 'object' && 'l' in c) {
      return Number.parseFloat(c.l);
    }
    if (Array.isArray(c)) {
      return Number.parseFloat(c[3]); // Index 3 for low price
    }
    return NaN;
  }).filter(n => Number.isFinite(n));

  const volumes = candles.map((c) => {
    if (c && typeof c === 'object' && 'volume' in c) {
      return Number.parseFloat(c.volume);
    }
    if (c && typeof c === 'object' && 'v' in c) {
      return Number.parseFloat(c.v);
    }
    if (Array.isArray(c)) {
      return Number.parseFloat(c[5]); // Index 5 for volume
    }
    return NaN;
  }).filter(n => Number.isFinite(n));

  // Calculate EMA
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);

  // Calculate ATR
  const atr3 = calcATR(highs, lows, closes, 3);
  const atr14 = calcATR(highs, lows, closes, 14);

  // Calculate volume
  const currentVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

  // Calculate MACD and RSI14 for the last 10 data points
  const macdSeries: number[] = [];
  const rsi14Series: number[] = [];

  const recentPoints = Math.min(10, closes.length);
  for (let i = closes.length - recentPoints; i < closes.length; i++) {
    const historicalPrices = closes.slice(0, i + 1);
    macdSeries.push(calcMACD(historicalPrices));
    rsi14Series.push(calcRSI(historicalPrices, 14));
  }

  return {
    ema20,
    ema50,
    atr3,
    atr14,
    currentVolume,
    avgVolume,
    macdSeries,
    rsi14Series,
  };
}

/**
 * Calculate ATR (Average True Range)
 */
function calcATR(highs: number[], lows: number[], closes: number[], period: number) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate average
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;

  return Number.isFinite(atr) ? atr : 0;
}

// Calculate EMA
function calcEMA(prices: number[], period: number) {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : 0;
}

// Calculate RSI
function calcRSI(prices: number[], period: number) {
  if (prices.length < period + 1) return 50; // Insufficient data, return neutral value

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // Ensure RSI is within 0-100 range
  return ensureRange(rsi, 0, 100, 50);
}

// Calculate MACD
function calcMACD(prices: number[]) {
  if (prices.length < 26) return 0; // Insufficient data
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  return Number.isFinite(macd) ? macd : 0;
}

/**
 * Calculate technical indicators
 *
 * Candlestick data format: FuturesCandlestick object
 * {
 *   t: number,    // timestamp
 *   v: number,    // volume
 *   c: string,    // closing price
 *   h: string,    // highest price
 *   l: string,    // lowest price
 *   o: string,    // opening price
 *   sum: string   // total trading value
 * }
 */
function calculateIndicators(candles: any[]) {
  if (!candles || candles.length === 0) {
    return {
      currentPrice: 0,
      ema20: 0,
      ema50: 0,
      macd: 0,
      rsi7: 50,
      rsi14: 50,
      volume: 0,
      avgVolume: 0,
    };
  }

  // Handle different candlestick data formats from different exchanges
  const closes = candles
    .map((c) => {
      // Standard Candle format (Binance, CCXT)
      if (c && typeof c === 'object' && 'close' in c) {
        return Number.parseFloat(c.close);
      }
      // Gate.io format (FuturesCandlestick)
      if (c && typeof c === 'object' && 'c' in c) {
        return Number.parseFloat(c.c);
      }
      // Array format (for backward compatibility)
      if (Array.isArray(c)) {
        return Number.parseFloat(c[4]); // Index 4 is close price in [timestamp, open, high, low, close, volume]
      }
      return NaN;
    })
    .filter(n => Number.isFinite(n));

  const volumes = candles
    .map((c) => {
      // Standard Candle format (Binance, CCXT)
      if (c && typeof c === 'object' && 'volume' in c) {
        const vol = Number.parseFloat(c.volume);
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      // Gate.io format (FuturesCandlestick)
      if (c && typeof c === 'object' && 'v' in c) {
        const vol = Number.parseFloat(c.v);
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      // Array format (for backward compatibility)
      if (Array.isArray(c)) {
        const vol = Number.parseFloat(c[5]); // Index 5 is volume in [timestamp, open, high, low, close, volume]
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      return 0;
    })
    .filter(n => n >= 0); // Filter out negative volumes

  if (closes.length === 0 || volumes.length === 0) {
    return {
      currentPrice: 0,
      ema20: 0,
      ema50: 0,
      macd: 0,
      rsi7: 50,
      rsi14: 50,
      volume: 0,
      avgVolume: 0,
    };
  }

  return {
    currentPrice: ensureFinite(closes.at(-1) || 0),
    ema20: ensureFinite(calcEMA(closes, 20)),
    ema50: ensureFinite(calcEMA(closes, 50)),
    macd: ensureFinite(calcMACD(closes)),
    rsi7: ensureRange(calcRSI(closes, 7), 0, 100, 50),
    rsi14: ensureRange(calcRSI(closes, 14), 0, 100, 50),
    volume: ensureFinite(volumes.at(-1) || 0),
    avgVolume: ensureFinite(volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0),
  };
}

/**
 * Calculate Sharpe Ratio
 * Uses recent 30 days of account history data
 */
async function calculateSharpeRatio(): Promise<number> {
  try {
    // Try to fetch all account history data (not limited to 30 days)
    const result = await dbClient.execute({
      sql: `SELECT total_value, timestamp FROM account_history
            ORDER BY timestamp ASC`,
      args: [],
    });

    if (!result.rows || result.rows.length < 2) {
      return 0; // Insufficient data, return 0
    }

    // Calculate return rate for each trade (not daily)
    const returns: number[] = [];
    for (let i = 1; i < result.rows.length; i++) {
      const prevValue = Number.parseFloat(result.rows[i - 1].total_value as string);
      const currentValue = Number.parseFloat(result.rows[i].total_value as string);

      if (prevValue > 0) {
        const returnRate = (currentValue - prevValue) / prevValue;
        returns.push(returnRate);
      }
    }

    if (returns.length < 2) {
      return 0;
    }

    // Calculate average return rate
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Calculate standard deviation of returns
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return avgReturn > 0 ? 10 : 0; // No volatility but has gains, return high value
    }

    // Sharpe Ratio = (average return - risk-free rate) / standard deviation
    // Assume risk-free rate is 0
    const sharpeRatio = avgReturn / stdDev;

    return Number.isFinite(sharpeRatio) ? sharpeRatio : 0;
  } catch (error) {
    logger.error("Failed to calculate Sharpe Ratio:", error as any);
    return 0;
  }
}

/**
 * Get account information
 *
 * Gate.io's account.total does not include unrealized P&L
 * Total assets (excluding unrealized P&L) = account.total = available + positionMargin
 *
 * Therefore:
 * - totalBalance does not include unrealized P&L
 * - returnPercent reflects realized P&L
 * - unrealizedPnl needs to be added when displaying on the frontend
 */
async function getAccountInfo() {
  const exchangeClient = createExchangeClient();

  try {
    const account = await exchangeClient.getFuturesAccount();

    // Get initial balance from database
    const initialResult = await dbClient.execute(
      "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
    );
    const initialBalance = initialResult.rows[0]
      ? Number.parseFloat(initialResult.rows[0].total_value as string)
      : 100;

    // Extract fields from exchange API response
    const accountTotal = account.totalBalance;
    const availableBalance = account.availableBalance;
    const unrealisedPnl = account.unrealisedPnl;

    // Exchange's totalBalance does not include unrealized P&L
    const totalBalance = accountTotal;

    // Real-time return rate = (total assets - initial balance) / initial balance * 100
    // Total assets do not include unrealized P&L, return rate reflects realized P&L
    const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;

    // Calculate Sharpe Ratio
    const sharpeRatio = await calculateSharpeRatio();

    return {
      totalBalance,      // Total assets (excluding unrealized P&L)
      availableBalance,  // Available balance
      unrealisedPnl,     // Unrealized P&L
      returnPercent,     // Return rate (excluding unrealized P&L)
      sharpeRatio,       // Sharpe ratio
    };
  } catch (error) {
    logger.error("Failed to get account information:", error as any);
    return {
      totalBalance: 0,
      availableBalance: 0,
      unrealisedPnl: 0,
      returnPercent: 0,
      sharpeRatio: 0,
    };
  }
}

/**
 * Sync positions from exchange to database
 * Optimization: Ensure position data accuracy and completeness
 * Position records in the database are mainly used for:
 * 1. Saving metadata such as stop-loss and take-profit order IDs
 * 2. Providing historical queries and monitoring page display
 * Real-time position data should be fetched directly from the exchange
 */
async function syncPositionsFromGate(cachedPositions?: any[]) {
  const exchangeClient = createExchangeClient();

  try {
    // If cached data is provided, use it; otherwise fetch new data
    const positions = cachedPositions || await exchangeClient.getPositions();
    const dbResult = await dbClient.execute("SELECT symbol, sl_order_id, tp_order_id, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );

    // If exchange returns 0 positions but database has positions, it might be API delay, don't clear database
    if (positions.length === 0 && dbResult.rows.length > 0) {
      logger.warn(`Warning: Exchange returned 0 positions, but database has ${dbResult.rows.length} positions, possibly API delay, skipping sync`);
      return;
    }

    await dbClient.execute("DELETE FROM positions");

    let syncedCount = 0;

    for (const pos of positions) {
      const symbol = pos.symbol;
      let entryPrice = pos.entryPrice;
      let currentPrice = pos.currentPrice;
      const leverage = pos.leverage;
      const side = pos.side;
      const quantity = pos.quantity;
      const unrealizedPnl = pos.unrealizedPnl;
      let liquidationPrice = pos.liquidationPrice;

      if (entryPrice === 0 || currentPrice === 0) {
        try {
          const ticker = await exchangeClient.getFuturesTicker(symbol);
          if (currentPrice === 0) {
            currentPrice = ticker.markPrice;
          }
          if (entryPrice === 0) {
            entryPrice = currentPrice;
          }
        } catch (error) {
          logger.error(`Failed to fetch ${symbol} ticker:`, error as any);
        }
      }

      if (liquidationPrice === 0 && entryPrice > 0) {
        liquidationPrice = side === "long"
          ? entryPrice * (1 - 0.9 / leverage)
          : entryPrice * (1 + 0.9 / leverage);
      }

      const dbPos = dbPositionsMap.get(symbol);

      // Preserve original entry_order_id, do not overwrite
      const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;

      await dbClient.execute({
        sql: `INSERT INTO positions
              (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
               leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, entry_order_id, opened_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          symbol,
          quantity,
          entryPrice,
          currentPrice,
          liquidationPrice,
          unrealizedPnl,
          leverage,
          side,
          dbPos?.stop_loss || null,
          dbPos?.profit_target || null,
          dbPos?.sl_order_id || null,
          dbPos?.tp_order_id || null,
          entryOrderId, // Preserve original order ID
          dbPos?.opened_at || new Date().toISOString(), // Preserve original opening time
        ],
      });

      syncedCount++;
    }

    const activePositionsCount = positions.length;
    if (activePositionsCount > 0 && syncedCount === 0) {
      logger.error(`Exchange has ${activePositionsCount} positions, but database sync failed!`);
    }

  } catch (error) {
    logger.error("Failed to sync positions:", error as any);
  }
}

/**
 * Get position information - fetch latest data directly from the exchange
 * @param cachedPositions Optional, already fetched position data to avoid repeated API calls
 * @returns Formatted position data
 */
async function getPositions(cachedPositions?: any[]) {
  const exchangeClient = createExchangeClient();

  try {
    // If cached data is provided, use it; otherwise fetch new data
    const exchangePositions = cachedPositions || await exchangeClient.getPositions();

    // Get position opening time from database (database stores the correct opening time)
    const dbResult = await dbClient.execute("SELECT symbol, opened_at FROM positions");
    const dbOpenedAtMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row.opened_at])
    );

    // Format positions
    const positions = exchangePositions.map((p) => {
        const symbol = p.symbol;

        // Prioritize reading opening time from database to ensure accuracy
        let openedAt = dbOpenedAtMap.get(symbol);

        // If not in database, use current time
        if (!openedAt) {
          openedAt = getChinaTimeISO();
          logger.warn(`Opening time missing for ${symbol} position, using current time`);
        }

        return {
          symbol,
          contract: p.exchangeSymbol,
          quantity: p.quantity,
          side: p.side,
          entry_price: p.entryPrice,
          current_price: p.currentPrice,
          liquidation_price: p.liquidationPrice,
          unrealized_pnl: p.unrealizedPnl,
          leverage: p.leverage,
          margin: p.margin,
          opened_at: openedAt,
        };
      });

    return positions;
  } catch (error) {
    logger.error("Failed to get positions:", error as any);
    return [];
  }
}

/**
 * Get trade history (last 10 records)
 * Fetch historical trade records from database (for monitoring page trade history)
 */
async function getTradeHistory(limit: number = 10) {
  try {
    // Fetch historical trade records from database
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`,
      args: [limit],
    });

    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Convert database format to format needed for prompts
    const trades = result.rows.map((row: any) => {
      return {
        symbol: row.symbol,
        side: row.side, // long/short
        type: row.type, // open/close
        price: Number.parseFloat(row.price || "0"),
        quantity: Number.parseFloat(row.quantity || "0"),
        leverage: Number.parseInt(row.leverage || "1"),
        pnl: row.pnl ? Number.parseFloat(row.pnl) : null,
        fee: Number.parseFloat(row.fee || "0"),
        timestamp: row.timestamp,
        status: row.status,
      };
    });

    // Sort by time in ascending order (oldest to newest)
    trades.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return trades;
  } catch (error) {
    logger.error("Failed to get trade history:", error as any);
    return [];
  }
}

/**
 * Get recent N AI decision records
 */
async function getRecentDecisions(limit: number = 3) {
  try {
    const result = await dbClient.execute({
      sql: `SELECT timestamp, iteration, decision, account_value, positions_count
            FROM agent_decisions
            ORDER BY timestamp DESC
            LIMIT ?`,
      args: [limit],
    });

    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Return formatted decision records (from oldest to newest)
    return result.rows.reverse().map((row: any) => ({
      timestamp: row.timestamp,
      iteration: row.iteration,
      decision: row.decision,
      account_value: Number.parseFloat(row.account_value || "0"),
      positions_count: Number.parseInt(row.positions_count || "0"),
    }));
  } catch (error) {
    logger.error("Failed to get recent decision records:", error as any);
    return [];
  }
}

/**
 * Sync risk configuration to database
 */
async function syncConfigToDatabase() {
  try {
    const config = getAccountRiskConfig();
    const timestamp = getChinaTimeISO();

    // Update or insert configuration
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_stop_loss_usdt', config.stopLossUsdt.toString(), timestamp],
    });

    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_take_profit_usdt', config.takeProfitUsdt.toString(), timestamp],
    });

    logger.info(`Configuration synced to database: stop loss=${config.stopLossUsdt} USDT, take profit=${config.takeProfitUsdt} USDT`);
  } catch (error) {
    logger.error("Failed to sync configuration to database:", error as any);
  }
}

/**
 * Load risk configuration from database
 */
async function loadConfigFromDatabase() {
  try {
    const stopLossResult = await dbClient.execute({
      sql: `SELECT value FROM system_config WHERE key = ?`,
      args: ['account_stop_loss_usdt'],
    });

    const takeProfitResult = await dbClient.execute({
      sql: `SELECT value FROM system_config WHERE key = ?`,
      args: ['account_take_profit_usdt'],
    });

    if (stopLossResult.rows.length > 0 && takeProfitResult.rows.length > 0) {
      accountRiskConfig = {
        stopLossUsdt: Number.parseFloat(stopLossResult.rows[0].value as string),
        takeProfitUsdt: Number.parseFloat(takeProfitResult.rows[0].value as string),
        syncOnStartup: accountRiskConfig.syncOnStartup,
      };

      logger.info(`Configuration loaded from database: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);
    }
  } catch (error) {
    logger.warn("Failed to load configuration from database, using environment variable configuration:", error as any);
  }
}

/**
 * Fix historical P&L records
 * Automatically called at the end of each cycle to ensure all trade records have correct P&L calculations
 */
async function fixHistoricalPnlRecords() {
  try {
    // Query all closing trade records
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades WHERE type = 'close' ORDER BY timestamp DESC LIMIT 50`,
      args: [],
    });

    if (!result.rows || result.rows.length === 0) {
      return;
    }

    let fixedCount = 0;

    for (const closeTrade of result.rows) {
      const id = closeTrade.id;
      const symbol = closeTrade.symbol as string;
      const side = closeTrade.side as string;
      const closePrice = Number.parseFloat(closeTrade.price as string);
      const quantity = Number.parseFloat(closeTrade.quantity as string);
      const recordedPnl = Number.parseFloat(closeTrade.pnl as string || "0");
      const recordedFee = Number.parseFloat(closeTrade.fee as string || "0");
      const timestamp = closeTrade.timestamp as string;

      // Find corresponding opening trade record
      const openResult = await dbClient.execute({
        sql: `SELECT * FROM trades WHERE symbol = ? AND type = 'open' AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
        args: [symbol, timestamp],
      });

      if (!openResult.rows || openResult.rows.length === 0) {
        continue;
      }

      const openTrade = openResult.rows[0];
      const openPrice = Number.parseFloat(openTrade.price as string);

      // Get contract multiplier
      const contract = `${symbol}_USDT`;
      const quantoMultiplier = await getQuantoMultiplier(contract);

      // Recalculate correct P&L
      const priceChange = side === "long"
        ? (closePrice - openPrice)
        : (openPrice - closePrice);

      const grossPnl = priceChange * quantity * quantoMultiplier;
      const openFee = openPrice * quantity * quantoMultiplier * 0.0005;
      const closeFee = closePrice * quantity * quantoMultiplier * 0.0005;
      const totalFee = openFee + closeFee;
      const correctPnl = grossPnl - totalFee;

      // Calculate difference
      const pnlDiff = Math.abs(recordedPnl - correctPnl);
      const feeDiff = Math.abs(recordedFee - totalFee);

      // If difference exceeds 0.5 USDT, fix it
      if (pnlDiff > 0.5 || feeDiff > 0.1) {
        logger.warn(`Fixing trade record ID=${id} (${symbol} ${side})`);
        logger.warn(`  P&L: ${recordedPnl.toFixed(2)} → ${correctPnl.toFixed(2)} USDT (difference: ${pnlDiff.toFixed(2)})`);

        // Update database
        await dbClient.execute({
          sql: `UPDATE trades SET pnl = ?, fee = ? WHERE id = ?`,
          args: [correctPnl, totalFee, id],
        });

        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      logger.info(`Fixed ${fixedCount} historical P&L records`);
    }
  } catch (error) {
    logger.error("Failed to fix historical P&L records:", error as any);
  }
}

/**
 * Close all positions
 */
async function closeAllPositions(reason: string): Promise<void> {
  const exchangeClient = createExchangeClient();

  try {
    logger.warn(`Closing all positions, reason: ${reason}`);

    const positions = await exchangeClient.getPositions();
    // Positions are already filtered (only non-zero positions)

    if (positions.length === 0) {
      return;
    }

    for (const pos of positions) {
      const symbol = pos.symbol;
      const quantity = pos.quantity;
      const side = pos.side;

      try {
        // Place opposite order to close the position
        await exchangeClient.placeOrder({
          symbol,
          side: side === 'long' ? 'short' : 'long',
          quantity,
          isReduceOnly: true,
        });

        logger.info(`Position closed: ${symbol} ${quantity} units`);
      } catch (error) {
        logger.error(`Failed to close position: ${symbol}`, error as any);
      }
    }

    logger.warn(`All positions closed`);
  } catch (error) {
    logger.error("Failed to close all positions:", error as any);
    throw error;
  }
}

/**
 * Check if account balance triggers stop loss or take profit
 * @returns true: exit condition triggered, false: continue running
 */
async function checkAccountThresholds(accountInfo: any): Promise<boolean> {
  const totalBalance = accountInfo.totalBalance;

  // Check stop loss threshold
  if (totalBalance <= accountRiskConfig.stopLossUsdt) {
    logger.error(`Stop loss triggered! Balance: ${totalBalance.toFixed(2)} USDT <= ${accountRiskConfig.stopLossUsdt} USDT`);
    await closeAllPositions(`Account balance triggered stop loss (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  // Check take profit threshold
  if (totalBalance >= accountRiskConfig.takeProfitUsdt) {
    logger.warn(`Take profit triggered! Balance: ${totalBalance.toFixed(2)} USDT >= ${accountRiskConfig.takeProfitUsdt} USDT`);
    await closeAllPositions(`Account balance triggered take profit (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  return false;
}

/**
 * Execute trading decision
 * Optimization: Enhance error handling and data validation to ensure real-time accurate data
 */
async function executeTradingDecision() {
  iterationCount++;
  const minutesElapsed = Math.floor((Date.now() - tradingStartTime.getTime()) / 60000);
  const intervalMinutes = Number.parseInt(process.env.TRADING_INTERVAL_MINUTES || "5");

  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`Trading cycle #${iterationCount} (running for ${minutesElapsed} minutes)`);
  logger.info(`${"=".repeat(80)}\n`);

  let marketData: any = {};
  let accountInfo: any = null;
  let positions: any[] = [];

  try {
    // 1. Collect market data
    try {
      marketData = await collectMarketData();
      const validSymbols = SYMBOLS.filter(symbol => {
        const data = marketData[symbol];
        if (!data || data.price === 0) {
          return false;
        }
        return true;
      });

      if (validSymbols.length === 0) {
        logger.error("Failed to fetch market data, skipping this cycle");
        return;
      }
    } catch (error) {
      logger.error("Failed to collect market data:", error as any);
      return;
    }

    // 2. Get account information
    try {
      accountInfo = await getAccountInfo();

      if (!accountInfo || accountInfo.totalBalance === 0) {
        logger.error("Account data anomaly, skipping this cycle");
        return;
      }

      // Check if account balance triggers stop loss or take profit
      const shouldExit = await checkAccountThresholds(accountInfo);
      if (shouldExit) {
        logger.error("Account balance triggered exit condition, system will stop!");
        setTimeout(() => {
          process.exit(0);
        }, 5000);
        return;
      }

    } catch (error) {
      logger.error("Failed to get account information:", error as any);
      return;
    }

    // 3. Sync position information (Optimization: call API only once to avoid duplication)
    try {
      const exchangeClient = createExchangeClient();
      const rawPositions = await exchangeClient.getPositions();

      // Use the same data for processing and syncing to avoid repeated API calls
      positions = await getPositions(rawPositions);
      await syncPositionsFromGate(rawPositions);

      const dbPositions = await dbClient.execute("SELECT COUNT(*) as count FROM positions");
      const dbCount = (dbPositions.rows[0] as any).count;

      if (positions.length !== dbCount) {
        logger.warn(`Position sync inconsistency: Exchange=${positions.length}, DB=${dbCount}`);
        // Sync again using the same data
        await syncPositionsFromGate(rawPositions);
      }
    } catch (error) {
      logger.error("Failed to sync positions:", error as any);
    }

    // 4. Forced risk control check (before AI execution)
    const exchangeClient = createExchangeClient();

    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side;
      const leverage = pos.leverage;
      const entryPrice = pos.entry_price;
      const currentPrice = pos.current_price;

      // Calculate P&L percentage (considering leverage)
      const priceChangePercent = entryPrice > 0
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;

      // Get and update peak profit
      let peakPnlPercent = 0;
      try {
        const dbPosResult = await dbClient.execute({
          sql: "SELECT peak_pnl_percent FROM positions WHERE symbol = ?",
          args: [symbol],
        });

        if (dbPosResult.rows.length > 0) {
          peakPnlPercent = Number.parseFloat(dbPosResult.rows[0].peak_pnl_percent as string || "0");

          // If current P&L exceeds historical peak, update peak
          if (pnlPercent > peakPnlPercent) {
            peakPnlPercent = pnlPercent;
            await dbClient.execute({
              sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
              args: [peakPnlPercent, symbol],
            });
            logger.info(`${symbol} peak profit updated: ${peakPnlPercent.toFixed(2)}%`);
          }
        }
      } catch (error: any) {
        logger.warn(`Failed to get peak profit for ${symbol}: ${error.message}`);
      }

      let shouldClose = false;
      let closeReason = "";

      // a) 36-hour forced liquidation check
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingHours = (now.getTime() - openedTime.getTime()) / (1000 * 60 * 60);

      if (holdingHours >= 36) {
        shouldClose = true;
        closeReason = `Holding time reached ${holdingHours.toFixed(1)} hours, exceeds 36-hour limit`;
      }

      // b) Dynamic stop loss check (based on strategy and leverage)
      // Get stop loss parameters from strategy configuration
      const { getStrategyParams, getTradingStrategy } = await import("../agents/tradingAgent.js");
      const strategy = getTradingStrategy();
      const params = getStrategyParams(strategy);

      // Determine stop loss line based on leverage multiple
      const leverageMid = Math.floor((params.leverageMin + params.leverageMax) / 2);
      const leverageHigh = Math.floor(params.leverageMin + (params.leverageMax - params.leverageMin) * 0.75);

      let stopLossPercent = params.stopLoss.low; // Default use low
      if (leverage >= leverageHigh) {
        stopLossPercent = params.stopLoss.high; // High leverage, strict stop loss
      } else if (leverage >= leverageMid) {
        stopLossPercent = params.stopLoss.mid;   // Medium leverage
      } else {
        stopLossPercent = params.stopLoss.low;   // Low leverage, loose stop loss
      }

      logger.info(`${symbol} stop loss check: strategy=${strategy}, leverage=${leverage}x, stop loss=${stopLossPercent}%, current P&L=${pnlPercent.toFixed(2)}%`);

      if (pnlPercent <= stopLossPercent) {
        shouldClose = true;
        closeReason = `Triggered dynamic stop loss (${pnlPercent.toFixed(2)}% <= ${stopLossPercent}%, strategy=${strategy}, leverage=${leverage}x)`;
      }

      // c) Trailing take profit check
      if (!shouldClose) {
        let trailingStopPercent = stopLossPercent; // Default use initial stop loss

        if (pnlPercent >= 25) {
          trailingStopPercent = 15;
        } else if (pnlPercent >= 15) {
          trailingStopPercent = 8;
        } else if (pnlPercent >= 8) {
          trailingStopPercent = 3;
        }

        // If current P&L is below trailing stop line
        if (pnlPercent < trailingStopPercent && trailingStopPercent > stopLossPercent) {
          shouldClose = true;
          closeReason = `Triggered trailing take profit (current ${pnlPercent.toFixed(2)}% < trailing stop line ${trailingStopPercent}%)`;
        }
      }

      // d) Peak drawdown protection (if position was ever profitable)
      if (!shouldClose && peakPnlPercent > 5) {
        // Only enable peak drawdown protection for positions that were once profitable > 5%
        const drawdownFromPeak = peakPnlPercent > 0
          ? ((peakPnlPercent - pnlPercent) / peakPnlPercent) * 100
          : 0;

        if (drawdownFromPeak >= 30) {
          shouldClose = true;
          closeReason = `Triggered peak drawdown protection (peak ${peakPnlPercent.toFixed(2)}% → current ${pnlPercent.toFixed(2)}%, drawdown ${drawdownFromPeak.toFixed(1)}% >= 30%)`;
        }
      }

      // Execute forced liquidation
      if (shouldClose) {
        logger.warn(`[Forced Liquidation] ${symbol} ${side} - ${closeReason}`);
        try {
          // 1. Place liquidation order
          const order = await exchangeClient.placeOrder({
            symbol,
            side: side === 'long' ? 'short' : 'long',
            quantity: pos.quantity,
            isReduceOnly: true,
          });

          logger.info(`Forced liquidation order placed for ${symbol}, Order ID: ${order.id}`);

          // 2. Wait for order completion and get fill details (max 5 retries)
          let actualExitPrice = 0;
          let actualQuantity = Math.abs(pos.quantity);
          let pnl = 0;
          let totalFee = 0;
          let orderFilled = false;

          for (let retry = 0; retry < 5; retry++) {
            await new Promise(resolve => setTimeout(resolve, 500));

            try {
              const orderStatus = await exchangeClient.getOrder(order.id?.toString() || "");

              if (orderStatus.status === 'finished') {
                actualExitPrice = orderStatus.price;
                actualQuantity = orderStatus.filled;
                orderFilled = true;

                // Get contract multiplier
                const contract = exchangeClient.normalizeSymbol(symbol);
                const quantoMultiplier = await getQuantoMultiplier(contract);

                // Calculate P&L
                const entryPrice = pos.entry_price;
                const priceChange = side === "long"
                  ? (actualExitPrice - entryPrice)
                  : (entryPrice - actualExitPrice);

                const grossPnl = priceChange * actualQuantity * quantoMultiplier;

                // Calculate fees (entry + exit)
                const openFee = entryPrice * actualQuantity * quantoMultiplier * 0.0005;
                const closeFee = actualExitPrice * actualQuantity * quantoMultiplier * 0.0005;
                totalFee = openFee + closeFee;

                // Net P&L
                pnl = grossPnl - totalFee;

                logger.info(`Position closed: price=${actualExitPrice}, quantity=${actualQuantity}, P&L=${pnl.toFixed(2)} USDT`);
                break;
              }
            } catch (statusError: any) {
              logger.warn(`Failed to query order status (retry ${retry + 1}/5): ${statusError.message}`);
            }
          }

          // 3. Record to trades table (record regardless of whether detailed info was obtained)
          try {
            // Critical validation: check if P&L calculation is correct
            const finalPrice = actualExitPrice || pos.current_price;
            const contract = exchangeClient.normalizeSymbol(symbol);
            const quantoMultiplier = await getQuantoMultiplier(contract);
            const notionalValue = finalPrice * actualQuantity * quantoMultiplier;
            const priceChangeCheck = side === "long"
              ? (finalPrice - pos.entry_price)
              : (pos.entry_price - finalPrice);
            const expectedPnl = priceChangeCheck * actualQuantity * quantoMultiplier - totalFee;

            // Detect if P&L was incorrectly set to notional value
            if (Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
              logger.error(`Alert: [Forced Liquidation] P&L calculation anomaly detected!`);
              logger.error(`  Current pnl: ${pnl.toFixed(2)} USDT close to notional value ${notionalValue.toFixed(2)} USDT`);
              logger.error(`  Expected pnl: ${expectedPnl.toFixed(2)} USDT`);
              logger.error(`  Entry price: ${pos.entry_price}, Exit price: ${finalPrice}, Quantity: ${actualQuantity}, Contract multiplier: ${quantoMultiplier}`);

              // Force correct to correct value
              pnl = expectedPnl;
              logger.warn(`  Automatically corrected pnl to: ${pnl.toFixed(2)} USDT`);
            }

            // Detailed log
            logger.info(`[Forced Liquidation P&L Details] ${symbol} ${side}`);
            logger.info(`  Reason: ${closeReason}`);
            logger.info(`  Entry price: ${pos.entry_price.toFixed(4)}, Exit price: ${finalPrice.toFixed(4)}, Quantity: ${actualQuantity} units`);
            logger.info(`  Net P&L: ${pnl.toFixed(2)} USDT, Fee: ${totalFee.toFixed(4)} USDT`);

            await dbClient.execute({
              sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                order.id?.toString() || "",
                symbol,
                side,
                "close",
                finalPrice, // Use verified price
                actualQuantity,
                pos.leverage || 1,
                pnl, // Verified and corrected P&L
                totalFee,
                getChinaTimeISO(),
                orderFilled ? "filled" : "pending",
              ],
            });
            logger.info(`Forced liquidation recorded to database: ${symbol}, P&L=${pnl.toFixed(2)} USDT, reason=${closeReason}`);
          } catch (dbError: any) {
            logger.error(`Failed to record forced liquidation transaction: ${dbError.message}`);
            // Record to log even if database write fails for later recovery
            logger.error(`Missing trade record: ${JSON.stringify({
              order_id: order.id,
              symbol,
              side,
              type: "close",
              price: actualExitPrice,
              quantity: actualQuantity,
              pnl,
              reason: closeReason,
            })}`);
          }

          // 4. Delete position record from database
          await dbClient.execute({
            sql: "DELETE FROM positions WHERE symbol = ?",
            args: [symbol],
          });

          logger.info(`Forced liquidation completed for ${symbol}, reason: ${closeReason}`);

        } catch (closeError: any) {
          logger.error(`Failed to close position ${symbol}: ${closeError.message}`);
          // Record to log even if failed
          logger.error(`Failed forced liquidation details: symbol=${symbol}, side=${side}, quantity=${pos.quantity}, reason=${closeReason}`);
        }
      }
    }

    // Refresh positions (may have been force liquidated)
    positions = await getPositions();

    // 4. No longer save account history (equity curve module removed)
    // try {
    //   await saveAccountHistory(accountInfo);
    // } catch (error) {
    //   logger.error("Failed to save account history:", error as any);
    //   // Does not affect main flow
    // }

    // 5. Data integrity final check
    const dataValid =
      marketData && Object.keys(marketData).length > 0 &&
      accountInfo && accountInfo.totalBalance > 0 &&
      Array.isArray(positions);

    if (!dataValid) {
      logger.error("Data integrity check failed, skipping this cycle");
      logger.error(`Market data: ${Object.keys(marketData).length}, Account: ${accountInfo?.totalBalance}, Positions: ${positions.length}`);
      return;
    }

    // 6. Fix historical P&L records
    try {
      await fixHistoricalPnlRecords();
    } catch (error) {
      logger.warn("Failed to fix historical P&L records:", error as any);
      // Does not affect main flow, continue execution
    }

    // 7. Get trade history (last 10 records)
    let tradeHistory: any[] = [];
    try {
      tradeHistory = await getTradeHistory(10);
    } catch (error) {
      logger.warn("Failed to get trade history:", error as any);
      // Does not affect main flow, continue execution
    }

    // 8. Get previous AI decision
    let recentDecisions: any[] = [];
    try {
      recentDecisions = await getRecentDecisions(1);
    } catch (error) {
      logger.warn("Failed to get recent decision records:", error as any);
      // Does not affect main flow, continue execution
    }

    // 9. Generate prompt and call Agent
    const prompt = generateTradingPrompt({
      minutesElapsed,
      iteration: iterationCount,
      intervalMinutes,
      marketData,
      accountInfo,
      positions,
      tradeHistory,
      recentDecisions,
    });

    // Output complete prompt to log
    logger.info("Input Parameters - AI Prompt");
    logger.info("=".repeat(80));
    logger.info(prompt);
    logger.info("=".repeat(80) + "\n");
    
    const agent = createTradingAgent(intervalMinutes);

    try {
      const response = await agent.generateText(prompt);

      // Extract AI's complete response from response, no splitting
      let decisionText = "";

      if (typeof response === 'string') {
        decisionText = response;
      } else if (response && typeof response === 'object') {
        const steps = (response as any).steps || [];

        // Collect all AI text responses (preserve completely, no splitting)
        const allTexts: string[] = [];

        for (const step of steps) {
          if (step.content) {
            for (const item of step.content) {
              if (item.type === 'text' && item.text && item.text.trim()) {
                allTexts.push(item.text.trim());
              }
            }
          }
        }

        // Merge all text completely, separated by double newlines
        if (allTexts.length > 0) {
          decisionText = allTexts.join('\n\n');
        }

        // If no text message found, try other fields
        if (!decisionText) {
          decisionText = (response as any).text || (response as any).message || "";
        }

        // If still no text response, AI only called tools without producing decision
        if (!decisionText && steps.length > 0) {
          decisionText = "AI called tools but did not produce decision result";
        }
      }

      logger.info("Output - AI Decision");
      logger.info("=".repeat(80));
      logger.info(decisionText || "No decision output");
      logger.info("=".repeat(80) + "\n");

      // Save decision record
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions
              (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          new Date().toISOString(),
          iterationCount,
          JSON.stringify(marketData),
          decisionText,
          "[]",
          accountInfo.totalBalance,
          positions.length,
        ],
      });

      // Re-sync position data after Agent execution (Optimization: call API only once)
      const updatedRawPositions = await exchangeClient.getPositions();
      await syncPositionsFromGate(updatedRawPositions);
      const updatedPositions = await getPositions(updatedRawPositions);

      // Re-fetch updated account info with latest unrealized P&L
      const updatedAccountInfo = await getAccountInfo();
      const finalUnrealizedPnL = updatedPositions.reduce((sum: number, pos: any) => sum + (pos.unrealized_pnl || 0), 0);

      logger.info("Final - Position Status");
      logger.info("=".repeat(80));
      logger.info(`Account: ${updatedAccountInfo.totalBalance.toFixed(2)} USDT (Available: ${updatedAccountInfo.availableBalance.toFixed(2)}, Return: ${updatedAccountInfo.returnPercent.toFixed(2)}%)`);

      if (updatedPositions.length === 0) {
        logger.info("Positions: None");
      } else {
        logger.info(`Positions: ${updatedPositions.length} total`);
        updatedPositions.forEach((pos: any) => {
          // Calculate P&L percentage: consider leverage multiple
          // For leveraged trading: P&L% = (price change%) x leverage multiple
          const priceChangePercent = pos.entry_price > 0
            ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
            : 0;
          const pnlPercent = priceChangePercent * pos.leverage;
          logger.info(`  ${pos.symbol} ${pos.side === 'long' ? 'long' : 'short'} ${pos.quantity} units (entry: ${pos.entry_price.toFixed(2)}, current: ${pos.current_price.toFixed(2)}, P&L: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT / ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
        });
      }

      logger.info(`Unrealized P&L: ${finalUnrealizedPnL >= 0 ? '+' : ''}${finalUnrealizedPnL.toFixed(2)} USDT`);
      logger.info("=".repeat(80) + "\n");

    } catch (agentError) {
      logger.error("Agent execution failed:", agentError as any);
      try {
        await syncPositionsFromGate();
      } catch (syncError) {
        logger.error("Sync failed:", syncError as any);
      }
    }

    // Automatically fix historical P&L records at the end of each cycle
    try {
      logger.info("Checking and fixing historical P&L records...");
      await fixHistoricalPnlRecords();
    } catch (fixError) {
      logger.error("Failed to fix historical P&L:", fixError as any);
      // Does not affect main flow, continue execution
    }

  } catch (error) {
    logger.error("Trading loop execution failed:", error as any);
    try {
      await syncPositionsFromGate();
    } catch (recoveryError) {
      logger.error("Recovery failed:", recoveryError as any);
    }
  }
}

/**
 * Initialize trading system configuration
 */
export async function initTradingSystem() {
  logger.info("Initializing trading system configuration...");

  // 1. Load configuration
  accountRiskConfig = getAccountRiskConfig();
  logger.info(`Environment variable configuration: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);

  // 2. If startup sync is enabled, sync config to database
  if (accountRiskConfig.syncOnStartup) {
    await syncConfigToDatabase();
  } else {
    // Otherwise load config from database
    await loadConfigFromDatabase();
  }

  logger.info(`Final configuration: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);
}

/**
 * Start trading loop
 */
export function startTradingLoop() {
  const intervalMinutes = Number.parseInt(
    process.env.TRADING_INTERVAL_MINUTES || "5"
  );

  logger.info(`Starting trading loop, interval: ${intervalMinutes} minutes`);
  logger.info(`Supported symbols: ${SYMBOLS.join(", ")}`);

  // Execute once immediately
  executeTradingDecision();

  // Set scheduled task
  const cronExpression = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    executeTradingDecision();
  });

  logger.info(`Scheduled task set: ${cronExpression}`);
}

/**
 * Reset trading start time (for recovering previous trades)
 */
export function setTradingStartTime(time: Date) {
  tradingStartTime = time;
}

/**
 * Reset iteration count (for recovering previous trades)
 */
export function setIterationCount(count: number) {
  iterationCount = count;
}

