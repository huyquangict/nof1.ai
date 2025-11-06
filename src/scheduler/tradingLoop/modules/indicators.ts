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
 * Technical Indicators Calculator
 *
 * This module contains pure functions for calculating technical indicators from candlestick data.
 * All functions are stateless and side-effect-free, making them easy to test and reuse.
 *
 * Uses standardized Candle interface from the exchange abstraction layer.
 *
 * Supported indicators:
 * - EMA (Exponential Moving Average)
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - ATR (Average True Range)
 */

import { ensureFinite, ensureRange } from '../utils/validation';
import { Candle } from '../../../services/exchange/IExchangeClient';

/**
 * Calculated indicators result
 */
export interface Indicators {
  currentPrice: number;
  ema20: number;
  ema50: number;
  macd: number;
  rsi7: number;
  rsi14: number;
  volume: number;
  avgVolume: number;
}

/**
 * Intraday time series data (for 3-minute or 5-minute candles)
 */
export interface IntradaySeries {
  midPrices: number[];
  ema20Series: number[];
  macdSeries: number[];
  rsi7Series: number[];
  rsi14Series: number[];
}

/**
 * Longer-term context data (for 1-hour candles)
 */
export interface LongerTermContext {
  ema20: number;
  ema50: number;
  atr3: number;
  atr14: number;
  currentVolume: number;
  avgVolume: number;
  macdSeries: number[];
  rsi14Series: number[];
}

/**
 * Calculate EMA (Exponential Moving Average)
 *
 * @param prices - Array of prices
 * @param period - EMA period (e.g., 20, 50)
 * @returns EMA value
 *
 * @example
 * const prices = [100, 102, 101, 103, 105];
 * const ema20 = calcEMA(prices, 20);
 */
export function calcEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : 0;
}

/**
 * Calculate RSI (Relative Strength Index)
 *
 * @param prices - Array of prices
 * @param period - RSI period (typically 7 or 14)
 * @returns RSI value (0-100)
 *
 * @example
 * const prices = [100, 102, 101, 103, 105, 104, 106, 108];
 * const rsi14 = calcRSI(prices, 14); // Returns value between 0-100
 */
export function calcRSI(prices: number[], period: number): number {
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

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * @param prices - Array of prices
 * @returns MACD value (difference between EMA12 and EMA26)
 *
 * @example
 * const prices = [...]; // Array of at least 26 prices
 * const macd = calcMACD(prices);
 */
export function calcMACD(prices: number[]): number {
  if (prices.length < 26) return 0; // Insufficient data
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  return Number.isFinite(macd) ? macd : 0;
}

/**
 * Calculate ATR (Average True Range)
 *
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of close prices
 * @param period - ATR period (typically 3 or 14)
 * @returns ATR value
 *
 * @example
 * const highs = [102, 104, 103, 105];
 * const lows = [100, 101, 100, 102];
 * const closes = [101, 103, 102, 104];
 * const atr14 = calcATR(highs, lows, closes, 14);
 */
export function calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
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

/**
 * Calculate technical indicators from standardized Candle data
 *
 * This is the main function that calculates all indicators at once.
 *
 * @param candles - Array of standardized Candle objects from IExchangeClient
 * @returns Object containing all calculated indicators
 *
 * @example
 * const candles = await exchangeClient.getFuturesCandles('BTC', '5m', 100);
 * const indicators = calculateIndicators(candles);
 * console.log(indicators.ema20, indicators.rsi14, indicators.macd);
 */
export function calculateIndicators(candles: Candle[]): Indicators {
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

  // Extract data from standardized Candle interface
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

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
 * Calculate intraday time series data (3-minute or 5-minute level)
 *
 * This function calculates indicators for each time point, allowing you to see
 * how indicators evolved over time (useful for trend analysis).
 *
 * @param candles - Array of standardized Candle objects (at least 60 data points recommended)
 * @returns Object containing time series for multiple indicators
 *
 * @example
 * const candles3m = await exchangeClient.getFuturesCandles('BTC', '3m', 100);
 * const series = calculateIntradaySeries(candles3m);
 * console.log('Last 10 RSI14 values:', series.rsi14Series);
 */
export function calculateIntradaySeries(candles: Candle[]): IntradaySeries {
  if (!candles || candles.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // Extract closing prices from standardized Candle interface
  const closes = candles.map(c => c.close);

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
 *
 * This provides broader market context with additional indicators like ATR.
 *
 * @param candles - Array of standardized 1-hour Candle objects (at least 26 data points required)
 * @returns Object containing longer-term indicators and time series
 *
 * @example
 * const candles1h = await exchangeClient.getFuturesCandles('BTC', '1h', 120);
 * const context = calculateLongerTermContext(candles1h);
 * console.log('EMA50:', context.ema50, 'ATR14:', context.atr14);
 */
export function calculateLongerTermContext(candles: Candle[]): LongerTermContext {
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

  // Extract all price and volume data from standardized Candle interface
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

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
 * Create an indicator calculator interface
 *
 * This provides a clean interface for working with indicators in a modular way.
 */
export interface IndicatorCalculator {
  calculateIndicators(candles: Candle[]): Indicators;
  calculateIntradaySeries(candles: Candle[]): IntradaySeries;
  calculateLongerTermContext(candles: Candle[]): LongerTermContext;
  calcEMA(prices: number[], period: number): number;
  calcRSI(prices: number[], period: number): number;
  calcMACD(prices: number[]): number;
  calcATR(highs: number[], lows: number[], closes: number[], period: number): number;
}

/**
 * Create a new indicator calculator instance
 *
 * @returns IndicatorCalculator interface with all calculation methods
 *
 * @example
 * const calculator = createIndicatorCalculator();
 * const indicators = calculator.calculateIndicators(candles);
 */
export function createIndicatorCalculator(): IndicatorCalculator {
  return {
    calculateIndicators,
    calculateIntradaySeries,
    calculateLongerTermContext,
    calcEMA,
    calcRSI,
    calcMACD,
    calcATR,
  };
}
