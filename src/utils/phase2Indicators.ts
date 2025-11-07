/**
 * open-nof1.ai - AI Cryptocurrency Trading System
 * Copyright (C) 2025 195440
 *
 * Phase 2: Advanced Technical Indicators
 * - Bollinger Bands
 * - VWAP (Volume Weighted Average Price)
 * - OBV (On Balance Volume)
 * - Divergence Detection
 * - Support/Resistance Levels
 */

/**
 * Bollinger Bands Result
 */
export interface BollingerBands {
  upper: number;
  middle: number;  // SMA20
  lower: number;
  percentB: number;  // %B indicator (0-1, can exceed)
  bandwidth: number;  // (upper - lower) / middle
}

/**
 * Calculate Bollinger Bands
 *
 * @param prices Array of closing prices
 * @param period SMA period (default: 20)
 * @param stdDevMultiplier Standard deviation multiplier (default: 2)
 * @returns Bollinger Bands values
 */
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBands {
  if (prices.length < period) {
    return {
      upper: 0,
      middle: 0,
      lower: 0,
      percentB: 0.5,
      bandwidth: 0,
    };
  }

  // Calculate SMA (middle band)
  const recentPrices = prices.slice(-period);
  const sma = recentPrices.reduce((sum, p) => sum + p, 0) / period;

  // Calculate standard deviation
  const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
  const stdDev = Math.sqrt(variance);

  // Calculate bands
  const upper = sma + (stdDevMultiplier * stdDev);
  const lower = sma - (stdDevMultiplier * stdDev);

  // Calculate %B
  const currentPrice = prices[prices.length - 1];
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  // Calculate bandwidth
  const bandwidth = sma !== 0 ? (upper - lower) / sma : 0;

  return {
    upper: Number.isFinite(upper) ? upper : 0,
    middle: Number.isFinite(sma) ? sma : 0,
    lower: Number.isFinite(lower) ? lower : 0,
    percentB: Number.isFinite(percentB) ? percentB : 0.5,
    bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
  };
}

/**
 * VWAP Result
 */
export interface VWAPResult {
  vwap: number;
  deviation: number;  // (currentPrice - vwap) / vwap * 100
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 *
 * @param candles Array of OHLCV candles
 * @returns VWAP and deviation
 */
export function calculateVWAP(candles: Array<{
  h: string | number;
  l: string | number;
  c: string | number;
  v: string | number;
}>): VWAPResult {
  if (!candles || candles.length === 0) {
    return { vwap: 0, deviation: 0 };
  }

  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const high = Number.parseFloat(candle.h.toString());
    const low = Number.parseFloat(candle.l.toString());
    const close = Number.parseFloat(candle.c.toString());
    const volume = Number.parseFloat(candle.v.toString());

    if (!Number.isFinite(high) || !Number.isFinite(low) ||
        !Number.isFinite(close) || !Number.isFinite(volume) || volume <= 0) {
      continue;
    }

    // Typical price = (H + L + C) / 3
    const typicalPrice = (high + low + close) / 3;

    cumulativePV += typicalPrice * volume;
    cumulativeVolume += volume;
  }

  const vwap = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : 0;
  const currentPrice = Number.parseFloat(candles[candles.length - 1].c.toString());
  const deviation = vwap !== 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;

  return {
    vwap: Number.isFinite(vwap) ? vwap : 0,
    deviation: Number.isFinite(deviation) ? deviation : 0,
  };
}

/**
 * OBV Result
 */
export interface OBVResult {
  obv: number;
  obvEma20: number;
}

/**
 * Calculate OBV (On Balance Volume)
 *
 * @param candles Array of OHLCV candles
 * @returns OBV and its EMA20
 */
export function calculateOBV(candles: Array<{
  c: string | number;
  v: string | number;
}>): OBVResult {
  if (!candles || candles.length < 2) {
    return { obv: 0, obvEma20: 0 };
  }

  const obvValues: number[] = [];
  let obv = 0;

  for (let i = 1; i < candles.length; i++) {
    const prevClose = Number.parseFloat(candles[i - 1].c.toString());
    const currentClose = Number.parseFloat(candles[i].c.toString());
    const volume = Number.parseFloat(candles[i].v.toString());

    if (!Number.isFinite(prevClose) || !Number.isFinite(currentClose) || !Number.isFinite(volume)) {
      obvValues.push(obv);
      continue;
    }

    if (currentClose > prevClose) {
      obv += volume;
    } else if (currentClose < prevClose) {
      obv -= volume;
    }
    // If currentClose === prevClose, OBV unchanged

    obvValues.push(obv);
  }

  // Calculate EMA20 of OBV
  const currentOBV = obvValues[obvValues.length - 1];
  const obvEma20 = calculateEMA(obvValues, 20);

  return {
    obv: Number.isFinite(currentOBV) ? currentOBV : 0,
    obvEma20: Number.isFinite(obvEma20) ? obvEma20 : 0,
  };
}

/**
 * Helper: Calculate EMA
 */
function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values[values.length - 1];

  const k = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Swing Point (for divergence and S/R detection)
 */
export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

/**
 * Find swing points in price series
 *
 * @param prices Array of prices
 * @param window Window size for swing detection (default: 5)
 * @returns Array of swing points
 */
export function findSwingPoints(prices: number[], window: number = 5): SwingPoint[] {
  if (prices.length < window * 2 + 1) {
    return [];
  }

  const swings: SwingPoint[] = [];

  for (let i = window; i < prices.length - window; i++) {
    const slice = prices.slice(i - window, i + window + 1);
    const isHigh = slice.every(p => prices[i] >= p);
    const isLow = slice.every(p => prices[i] <= p);

    if (isHigh && prices[i] > 0) {
      swings.push({ index: i, price: prices[i], type: 'high' });
    } else if (isLow && prices[i] > 0) {
      swings.push({ index: i, price: prices[i], type: 'low' });
    }
  }

  return swings;
}

/**
 * Divergence Signal
 */
export interface DivergenceSignal {
  type: 'bullish' | 'bearish' | null;
  strength: number;  // 0-10
  pricePoints: [number, number] | null;  // [first swing price, second swing price]
  indicatorPoints: [number, number] | null;  // [first indicator value, second indicator value]
}

/**
 * Detect divergence between price and indicator
 *
 * @param prices Array of prices
 * @param indicator Array of indicator values (same length as prices)
 * @param swingWindow Window for swing detection (default: 5)
 * @param minSwingDistance Minimum candles between swings (default: 10)
 * @returns Divergence signal or null
 */
export function detectDivergence(
  prices: number[],
  indicator: number[],
  swingWindow: number = 5,
  minSwingDistance: number = 10
): DivergenceSignal {
  if (prices.length !== indicator.length || prices.length < 50) {
    return { type: null, strength: 0, pricePoints: null, indicatorPoints: null };
  }

  const swings = findSwingPoints(prices, swingWindow);

  // Separate highs and lows
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');

  // Check for bearish divergence (Price HH, Indicator LH)
  if (highs.length >= 2) {
    const lastTwoHighs = highs.slice(-2);
    const [first, second] = lastTwoHighs;

    // Ensure minimum distance
    if (second.index - first.index >= minSwingDistance) {
      const priceHH = second.price > first.price;
      const indicatorLH = indicator[second.index] < indicator[first.index];

      if (priceHH && indicatorLH) {
        const priceChange = (second.price - first.price) / first.price;
        const indicatorChange = (indicator[second.index] - indicator[first.index]) / Math.abs(indicator[first.index]);
        const strength = Math.min(Math.abs(priceChange - indicatorChange) * 50, 10);

        return {
          type: 'bearish',
          strength: Number.isFinite(strength) ? strength : 5,
          pricePoints: [first.price, second.price],
          indicatorPoints: [indicator[first.index], indicator[second.index]],
        };
      }
    }
  }

  // Check for bullish divergence (Price LL, Indicator HL)
  if (lows.length >= 2) {
    const lastTwoLows = lows.slice(-2);
    const [first, second] = lastTwoLows;

    // Ensure minimum distance
    if (second.index - first.index >= minSwingDistance) {
      const priceLL = second.price < first.price;
      const indicatorHL = indicator[second.index] > indicator[first.index];

      if (priceLL && indicatorHL) {
        const priceChange = (second.price - first.price) / first.price;
        const indicatorChange = (indicator[second.index] - indicator[first.index]) / Math.abs(indicator[first.index]);
        const strength = Math.min(Math.abs(priceChange - indicatorChange) * 50, 10);

        return {
          type: 'bullish',
          strength: Number.isFinite(strength) ? strength : 5,
          pricePoints: [first.price, second.price],
          indicatorPoints: [indicator[first.index], indicator[second.index]],
        };
      }
    }
  }

  return { type: null, strength: 0, pricePoints: null, indicatorPoints: null };
}

/**
 * Support/Resistance Level
 */
export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: number;  // Weighted by touches and recency
  firstSeen: number;  // Candle index
  lastTested: number;  // Candle index
}

/**
 * Detect support and resistance levels
 *
 * @param candles Array of OHLC candles
 * @param window Number of candles to analyze (default: 100)
 * @param clusterThreshold Price clustering threshold as percentage (default: 0.005 = 0.5%)
 * @returns Top 5 strongest levels
 */
export function detectSupportResistance(
  candles: Array<{ h: string | number; l: string | number; c: string | number }>,
  window: number = 100,
  clusterThreshold: number = 0.005
): SupportResistanceLevel[] {
  if (!candles || candles.length < 50) {
    return [];
  }

  // Use only recent candles
  const recentCandles = candles.slice(-Math.min(window, candles.length));
  const closes = recentCandles.map(c => Number.parseFloat(c.c.toString()));

  const swings = findSwingPoints(closes, 5);
  const levels: SupportResistanceLevel[] = [];

  // Cluster nearby swings
  for (const swing of swings) {
    let foundCluster = false;

    for (const level of levels) {
      const distance = Math.abs(swing.price - level.price) / level.price;

      if (distance < clusterThreshold) {
        // Add to existing cluster (update average price)
        level.touches++;
        level.price = (level.price * (level.touches - 1) + swing.price) / level.touches;
        level.lastTested = Math.max(level.lastTested, swing.index);
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      // Create new level
      levels.push({
        price: swing.price,
        type: swing.type === 'high' ? 'resistance' : 'support',
        touches: 1,
        firstSeen: swing.index,
        lastTested: swing.index,
        strength: 1,
      });
    }
  }

  // Calculate strength (touches × recency factor)
  const currentIndex = closes.length - 1;
  for (const level of levels) {
    const age = currentIndex - level.lastTested;
    const recencyFactor = Math.exp(-age / 50);  // Decay over 50 candles
    level.strength = level.touches * recencyFactor;
  }

  // Return top 5 strongest levels
  return levels
    .filter(l => l.touches >= 2)  // At least 2 touches to be significant
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);
}

/**
 * Find nearest support and resistance to current price
 */
export function findNearestLevels(
  currentPrice: number,
  levels: SupportResistanceLevel[]
): {
  nearestSupport: SupportResistanceLevel | null;
  nearestResistance: SupportResistanceLevel | null;
  distanceToSupport: number;
  distanceToResistance: number;
} {
  const supports = levels.filter(l => l.type === 'support' && l.price < currentPrice);
  const resistances = levels.filter(l => l.type === 'resistance' && l.price > currentPrice);

  const nearestSupport = supports.length > 0
    ? supports.reduce((closest, level) =>
        (currentPrice - level.price) < (currentPrice - closest.price) ? level : closest
      )
    : null;

  const nearestResistance = resistances.length > 0
    ? resistances.reduce((closest, level) =>
        (level.price - currentPrice) < (closest.price - currentPrice) ? level : closest
      )
    : null;

  const distanceToSupport = nearestSupport
    ? ((currentPrice - nearestSupport.price) / currentPrice) * 100
    : 999;

  const distanceToResistance = nearestResistance
    ? ((nearestResistance.price - currentPrice) / currentPrice) * 100
    : 999;

  return {
    nearestSupport,
    nearestResistance,
    distanceToSupport,
    distanceToResistance,
  };
}
