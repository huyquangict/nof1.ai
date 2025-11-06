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
 * Market Data Tools
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createExchangeClient } from "../../services/exchange";
import { RISK_PARAMS } from "../../config/riskParams";

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

// Calculate EMA
function calculateEMA(prices: number[], period: number) {
  if (!prices || prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : 0;
}

// calculate RSI
function calculateRSI(prices: number[], period: number) {
  if (!prices || prices.length < period + 1) return 50; // insufficient data, return neutral value
  
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    if (i === 0) continue; // skip first element, avoid accessing prices[-1]
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

// calculate MACD
function calculateMACD(prices: number[]) {
  if (!prices || prices.length < 26) return 0; // insufficient data
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  return Number.isFinite(macd) ? macd : 0;
}

// calculate ATR
function calculateATR(candles: any[], period: number) {
  if (!candles || candles.length < 2) return 0;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    let high: number, low: number, prevClose: number;

    // handle standardized format (Candle interface)
    if (candles[i] && typeof candles[i] === 'object' && 'high' in candles[i]) {
      high = candles[i].high;
      low = candles[i].low;
      prevClose = candles[i - 1].close;
    }
    // handle old exchange format (FuturesCandlestick)
    else if (candles[i] && typeof candles[i] === 'object' && 'h' in candles[i]) {
      high = Number.parseFloat(candles[i].h);
      low = Number.parseFloat(candles[i].l);
      prevClose = Number.parseFloat(candles[i - 1].c);
    }
    // handle array format (compatible with old code)
    else if (Array.isArray(candles[i])) {
      high = Number.parseFloat(candles[i][3]);
      low = Number.parseFloat(candles[i][4]);
      prevClose = Number.parseFloat(candles[i - 1][2]);
    } else {
      continue;
    }

    if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(prevClose)) {
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
  }

  if (trs.length === 0) return 0;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

/**
 * calculate technical indicators
 * 
 * Candlestick data format: FuturesCandlestick object
 * {
 *   t: number,    // timestamp
 *   v: number,    // Volume
 *   c: string,    // close price
 *   h: string,    // high price
 *   l: string,    // low price
 *   o: string,    // open price
 *   sum: string   // total filled amount
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
      atr3: 0,
      atr14: 0,
    };
  }

  // process candlestick data (support standardized format and old format)
  const closes = candles
    .map((c) => {
      // standardized format (Candle interface)
      if (c && typeof c === 'object' && 'close' in c) {
        return c.close;
      }
      // old exchange format (FuturesCandlestick)
      if (c && typeof c === 'object' && 'c' in c) {
        return Number.parseFloat(c.c);
      }
      // array format (compatible with old code)
      if (Array.isArray(c)) {
        return Number.parseFloat(c[2]);
      }
      return NaN;
    })
    .filter(n => Number.isFinite(n));

  const volumes = candles
    .map((c) => {
      // standardized format (Candle interface)
      if (c && typeof c === 'object' && 'volume' in c) {
        const vol = c.volume;
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      // old exchange format (FuturesCandlestick)
      if (c && typeof c === 'object' && 'v' in c) {
        const vol = Number.parseFloat(c.v);
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      // array format (compatible with old code)
      if (Array.isArray(c)) {
        const vol = Number.parseFloat(c[1]);
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      return 0;
    })
    .filter(n => n >= 0); // filter out negative volume

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
      atr3: 0,
      atr14: 0,
    };
  }

  return {
    currentPrice: ensureFinite(closes.at(-1) || 0),
    ema20: ensureFinite(calculateEMA(closes, 20)),
    ema50: ensureFinite(calculateEMA(closes, 50)),
    macd: ensureFinite(calculateMACD(closes)),
    rsi7: ensureRange(calculateRSI(closes, 7), 0, 100, 50),
    rsi14: ensureRange(calculateRSI(closes, 14), 0, 100, 50),
    volume: ensureFinite(volumes.at(-1) || 0),
    avgVolume: ensureFinite(volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0),
    atr3: ensureFinite(calculateATR(candles, 3)),
    atr14: ensureFinite(calculateATR(candles, 14)),
  };
}

/**
 * get market price tool
 */
export const getMarketPriceTool = createTool({
  name: "getMarketPrice",
  description: "get specified symbol real-time market price",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);

    const ticker = await client.getFuturesTicker(symbol);

    return {
      symbol,
      contract,
      lastPrice: ticker.lastPrice,
      markPrice: ticker.markPrice,
      indexPrice: ticker.indexPrice,
      highPrice24h: 0, // Not in standardized interface yet
      lowPrice24h: 0,  // Not in standardized interface yet
      volume24h: ticker.volume24h,
      change24h: ticker.change24h,
    };
  },
});

/**
 * get technical indicators tool
 */
export const getTechnicalIndicatorsTool = createTool({
  name: "getTechnicalIndicators",
  description: "get specified symbol technical indicators (EMA, MACD, RSI, etc)",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    interval: z.enum(["1m", "5m", "15m", "1h", "4h"]).default("5m").describe("candlestick period"),
    limit: z.number().default(100).describe("candlestick quantity"),
  }),
  execute: async ({ symbol, interval, limit }) => {
    const client = createExchangeClient();

    const candles = await client.getFuturesCandles(symbol, interval, limit);
    const indicators = calculateIndicators(candles);

    return {
      symbol,
      interval,
      ...indicators,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * get funding rate tool
 */
export const getFundingRateTool = createTool({
  name: "getFundingRate",
  description: "get specified symbol funding rate",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();

    const fundingRate = await client.getFundingRate(symbol);

    return {
      symbol,
      fundingRate: fundingRate.rate,
      fundingTime: fundingRate.timestamp,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * get order book depth tool
 */
export const getOrderBookTool = createTool({
  name: "getOrderBook",
  description: "get specified symbol order book depth data",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    limit: z.number().default(10).describe("depth level quantity"),
  }),
  execute: async ({ symbol, limit }) => {
    const client = createExchangeClient();

    const orderBook = await client.getOrderBook(symbol, limit);

    const bids = orderBook.bids.slice(0, limit).map(([price, size]) => ({
      price,
      size,
    }));

    const asks = orderBook.asks.slice(0, limit).map(([price, size]) => ({
      price,
      size,
    }));

    return {
      symbol,
      bids,
      asks,
      spread: asks[0]?.price - bids[0]?.price || 0,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * get contract position quantity tool
 */
export const getOpenInterestTool = createTool({
  name: "getOpenInterest",
  description: "get specified symbol contract position quantity",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
  }),
  execute: async ({ symbol }) => {
    // exchange API need to fetch position quantity data through other means
    // temporarily return 0,can fetch through other endpoints later
    return {
      symbol,
      openInterest: 0,
      timestamp: new Date().toISOString(),
    };
  },
});

