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
 * Multi-timeframe analysis module (minimal version - provides raw data only)
 */

import { createPinoLogger } from "@voltagent/logger";
import { createExchangeClient } from "./exchange/ExchangeFactory";

const logger = createPinoLogger({
  name: "multi-timeframe",
  level: "info",
});

/**
 * Timeframe definition
 */
export interface TimeframeConfig {
  interval: "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "8h" | "1d";
  candleCount: number;
  description: string;
}

// Standard timeframe configuration - short-term trading configuration
export const TIMEFRAMES: Record<string, TimeframeConfig> = {
  VERY_SHORT: {
    interval: "1m",
    candleCount: 60,
    description: "1 minute",
  },
  SHORT_1: {
    interval: "3m",
    candleCount: 100,
    description: "3 minutes",
  },
  SHORT: {
    interval: "5m",
    candleCount: 100,
    description: "5 minutes",
  },
  SHORT_CONFIRM: {
    interval: "15m",
    candleCount: 96,
    description: "15 minutes",
  },
  MEDIUM_SHORT: {
    interval: "30m",
    candleCount: 90,
    description: "30 minutes",
  },
  MEDIUM: {
    interval: "1h",
    candleCount: 120,
    description: "1 hour",
  },
};

/**
 * Ensure value is a valid finite number, otherwise return default value
 */
function ensureFinite(value: number, defaultValue: number = 0): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return value;
}

/**
 * Ensure value is within specified range
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
 * Calculate EMA
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ensureFinite(ema);
}

/**
 * Calculate RSI
 */
function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) {
      gains += changes[i];
    } else {
      losses -= changes[i];
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    if (changes[i] >= 0) {
      avgGain = (avgGain * (period - 1) + changes[i]) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - changes[i]) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  // Ensure RSI is within 0-100 range
  return ensureRange(rsi, 0, 100, 50);
}

/**
 * Calculate MACD
 */
function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  
  const macdLine = [];
  for (let i = 26; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const e12 = calculateEMA(slice, 12);
    const e26 = calculateEMA(slice, 26);
    macdLine.push(e12 - e26);
  }
  
  const signal = calculateEMA(macdLine, 9);
  const histogram = macd - signal;
  
  return { 
    macd: ensureFinite(macd), 
    signal: ensureFinite(signal), 
    histogram: ensureFinite(histogram) 
  };
}

/**
 * Raw data for a single timeframe
 */
export interface TimeframeIndicators {
  interval: string;
  currentPrice: number;

  // Moving averages
  ema20: number;
  ema50: number;

  // MACD
  macd: number;

  // RSI
  rsi14: number;

  // Volume
  volume: number;
  avgVolume: number;

  // Price change
  priceChange20: number; // Change % in last 20 candles
}

/**
 * Analyze a single timeframe (calculate raw indicators only)
 */
export async function analyzeTimeframe(
  symbol: string,
  config: TimeframeConfig
): Promise<TimeframeIndicators> {
  const exchangeClient = createExchangeClient();
  const contract = `${symbol}_USDT`;

  // Get candlestick data
  const candles = await exchangeClient.getFuturesCandles(
    contract,
    config.interval,
    config.candleCount
  );

  if (!candles || candles.length === 0) {
    throw new Error(`Unable to fetch ${config.interval} candle data for ${symbol}`);
  }

  // Extract price and volume data
  const closes = candles.map((c: any) => Number.parseFloat(c.c)).filter((n: number) => Number.isFinite(n));
  const volumes = candles.map((c: any) => {
    const vol = Number.parseFloat(c.v);
    return Number.isFinite(vol) && vol >= 0 ? vol : 0;
  }).filter((n: number) => n >= 0);

  const currentPrice = closes[closes.length - 1] || 0;

  // Calculate technical indicators (raw values)
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);

  const { macd } = calculateMACD(closes);

  const rsi14 = calculateRSI(closes, 14);

  const avgVolume = volumes.length > 0
    ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length
    : 0;
  const currentVolume = volumes[volumes.length - 1] || 0;

  // Price change
  const priceChange20 = closes.length >= 21 && closes[closes.length - 21] !== 0
    ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
    : 0;
  
  return {
    interval: config.interval,
    currentPrice: ensureFinite(currentPrice),
    ema20: ensureFinite(ema20),
    ema50: ensureFinite(ema50),
    macd: ensureFinite(macd),
    rsi14: ensureRange(rsi14, 0, 100, 50),
    volume: ensureFinite(currentVolume),
    avgVolume: ensureFinite(avgVolume),
    priceChange20: ensureFinite(priceChange20),
  };
}

/**
 * Multi-timeframe raw data
 */
export interface MultiTimeframeAnalysis {
  symbol: string;
  timestamp: string;

  // Raw data for each timeframe
  timeframes: {
    veryshort?: TimeframeIndicators;
    short1?: TimeframeIndicators;
    short?: TimeframeIndicators;
    shortconfirm?: TimeframeIndicators;
    mediumshort?: TimeframeIndicators;
    medium?: TimeframeIndicators;
  };

  // Key levels (support/resistance)
  keyLevels: {
    resistance: number[];
    support: number[];
  };
}

/**
 * Perform multi-timeframe analysis (minimal version - provides raw data only)
 */
export async function performMultiTimeframeAnalysis(
  symbol: string,
  timeframesToUse: string[] = ["VERY_SHORT", "SHORT_1", "SHORT", "SHORT_CONFIRM", "MEDIUM_SHORT", "MEDIUM"]
): Promise<MultiTimeframeAnalysis> {
  logger.info(`Fetching multi-timeframe data for ${symbol}...`);

  const timeframes: MultiTimeframeAnalysis["timeframes"] = {};

  // Fetch all timeframe data in parallel
  const promises: Promise<any>[] = [];

  for (const tfName of timeframesToUse) {
    const config = TIMEFRAMES[tfName];
    if (!config) continue;

    promises.push(
      analyzeTimeframe(symbol, config)
        .then(data => {
          const key = tfName.toLowerCase().replace(/_/g, "");
          timeframes[key as keyof typeof timeframes] = data;
        })
        .catch(error => {
          logger.error(`Failed to fetch ${config.interval} data for ${symbol}:`, error);
        })
    );
  }

  await Promise.all(promises);

  // Calculate support/resistance levels (based on price data)
  const keyLevels = calculateKeyLevels(timeframes);

  const analysis: MultiTimeframeAnalysis = {
    symbol,
    timestamp: new Date().toISOString(),
    timeframes,
    keyLevels,
  };

  logger.info(`Multi-timeframe data fetch complete for ${symbol}`);

  return analysis;
}

/**
 * Calculate key price levels (support/resistance)
 */
function calculateKeyLevels(
  timeframes: MultiTimeframeAnalysis["timeframes"]
): MultiTimeframeAnalysis["keyLevels"] {
  const prices: number[] = [];

  // Collect key prices from all timeframes
  for (const [_, data] of Object.entries(timeframes)) {
    if (!data) continue;
    prices.push(data.currentPrice);
    prices.push(data.ema20);
    prices.push(data.ema50);
  }

  if (prices.length === 0) {
    return { resistance: [], support: [] };
  }

  // Simple support/resistance calculation (based on price clustering)
  const currentPrice = timeframes.short?.currentPrice || timeframes.short1?.currentPrice || timeframes.medium?.currentPrice || 0;

  const resistance = prices
    .filter(p => p > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 3);

  const support = prices
    .filter(p => p < currentPrice)
    .sort((a, b) => b - a)
    .slice(0, 3);

  return {
    resistance,
    support,
  };
}
