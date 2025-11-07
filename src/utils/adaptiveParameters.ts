/**
 * open-nof1.ai - AI 加密货币自动交易系统
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
 * Phase 3A: Adaptive Parameters System
 *
 * This module implements market regime detection and adaptive parameter adjustment
 * to optimize indicator performance based on current market conditions.
 */

/**
 * Market regime types
 */
export type MarketRegime =
  | 'TRENDING_BULL'      // Strong uptrend
  | 'TRENDING_BEAR'      // Strong downtrend
  | 'RANGING_VOLATILE'   // Choppy, high volatility
  | 'RANGING_CALM'       // Sideways, low volatility
  | 'BREAKOUT';          // Volume surge, potential trend start

/**
 * Regime detection inputs
 */
export interface RegimeDetectionInputs {
  // Trend indicators
  currentPrice: number;
  ema20: number;
  ema50: number;
  adx: number;              // Average Directional Index

  // Volatility indicators
  atr: number;              // Current ATR
  atr20Avg: number;         // 20-period ATR average
  bbBandwidth: number;      // Bollinger Band bandwidth (from Phase 2)

  // Volume indicators
  volume: number;
  avgVolume: number;

  // Price action
  priceChange20: number;    // 20-period price change %
}

/**
 * Regime classification result
 */
export interface RegimeClassification {
  regime: MarketRegime;
  confidence: number;       // 0-1, how certain we are
  volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  trendStrength: number;    // 0-100
  atrRatio: number;         // Current ATR / 20-period average
  volumeSurge: number;      // Volume / average volume
}

/**
 * Adaptive indicator parameters
 */
export interface AdaptiveIndicatorParams {
  regime: MarketRegime;
  confidence: number;

  // EMA parameters
  emaFast: number;
  emaSlow: number;

  // MACD parameters
  macdFast: number;
  macdSlow: number;
  macdSignal: number;

  // RSI parameters
  rsiPeriod: number;

  // Bollinger Bands parameters
  bbPeriod: number;
  bbStdDev: number;

  // ATR parameters
  atrPeriod: number;
}

/**
 * ATR-based risk parameters
 */
export interface AdaptiveRiskParams {
  stopLossATRMultiple: number;      // Stop-loss as multiple of ATR
  takeProfitATRMultiple: number;    // Take-profit as multiple of ATR
  trailingStopATRMultiple: number;  // Trailing stop as multiple of ATR
}

/**
 * Calculate ADX (Average Directional Index)
 *
 * ADX measures trend strength (0-100):
 * - 0-20: Weak trend (ranging)
 * - 20-40: Moderate trend
 * - 40+: Strong trend
 *
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of close prices
 * @param period - ADX period (default 14)
 * @returns ADX value (0-100)
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 0;
  }

  // Step 1: Calculate True Range (TR) and Directional Movement (DM)
  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];
    const prevClose = closes[i - 1];

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);

    // Directional Movement
    const highDiff = high - prevHigh;
    const lowDiff = prevLow - low;

    if (highDiff > lowDiff && highDiff > 0) {
      plusDM.push(highDiff);
      minusDM.push(0);
    } else if (lowDiff > highDiff && lowDiff > 0) {
      plusDM.push(0);
      minusDM.push(lowDiff);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }
  }

  if (trueRanges.length < period) {
    return 0;
  }

  // Step 2: Smooth True Range and DM using Wilder's smoothing
  const smoothTR = smoothWilder(trueRanges, period);
  const smoothPlusDM = smoothWilder(plusDM, period);
  const smoothMinusDM = smoothWilder(minusDM, period);

  // Step 3: Calculate Directional Indicators (+DI and -DI)
  const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

  // Step 4: Calculate DX (Directional Index)
  const diSum = plusDI + minusDI;
  const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

  // Step 5: ADX is the smoothed average of DX
  // For simplicity, we return DX as approximation (proper ADX needs historical DX values)
  // In production, maintain DX history and smooth it
  return Math.min(Math.max(dx, 0), 100);
}

/**
 * Wilder's smoothing method (similar to EMA but with different smoothing factor)
 */
function smoothWilder(values: number[], period: number): number {
  if (values.length < period) {
    return 0;
  }

  // First smoothed value is simple average
  let smoothed = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

  // Subsequent values use Wilder's smoothing formula
  for (let i = period; i < values.length; i++) {
    smoothed = (smoothed * (period - 1) + values[i]) / period;
  }

  return smoothed;
}

/**
 * Detect market regime based on multiple indicators
 *
 * @param inputs - Regime detection inputs
 * @returns Regime classification with confidence
 */
export function detectMarketRegime(inputs: RegimeDetectionInputs): RegimeClassification {
  // Calculate derived metrics
  const atrRatio = inputs.atr20Avg > 0 ? inputs.atr / inputs.atr20Avg : 1.0;
  const volumeSurge = inputs.avgVolume > 0 ? inputs.volume / inputs.avgVolume : 1.0;

  // Determine volatility level
  let volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  if (atrRatio > 1.5 || inputs.bbBandwidth > 0.08) {
    volatilityLevel = 'HIGH';
  } else if (atrRatio < 0.8 && inputs.bbBandwidth < 0.03) {
    volatilityLevel = 'LOW';
  } else {
    volatilityLevel = 'MEDIUM';
  }

  // Determine trend direction
  const priceAboveEMA20 = inputs.currentPrice > inputs.ema20;
  const priceAboveEMA50 = inputs.currentPrice > inputs.ema50;
  const ema20AboveEMA50 = inputs.ema20 > inputs.ema50;

  // Check for breakout conditions
  const isBreakout = volumeSurge > 2.5 && (
    inputs.bbBandwidth > 0.08 || // BB expansion
    Math.abs(inputs.priceChange20) > 5 // Strong price move
  );

  if (isBreakout) {
    return {
      regime: 'BREAKOUT',
      confidence: Math.min(volumeSurge / 3.0, 1.0), // Higher volume = higher confidence
      volatilityLevel,
      trendStrength: inputs.adx,
      atrRatio,
      volumeSurge,
    };
  }

  // Check for trending conditions
  const isTrending = inputs.adx > 25;
  const isStrongTrend = inputs.adx > 40;

  if (isTrending) {
    // Bullish trend
    if (priceAboveEMA20 && priceAboveEMA50 && ema20AboveEMA50 && inputs.priceChange20 > 3) {
      const confidence = Math.min(
        (inputs.adx / 50) * 0.5 + // ADX contributes 50%
        (inputs.priceChange20 / 10) * 0.3 + // Price change contributes 30%
        (volumeSurge > 1.5 ? 0.2 : 0), // Volume confirmation contributes 20%
        1.0
      );

      return {
        regime: 'TRENDING_BULL',
        confidence,
        volatilityLevel,
        trendStrength: inputs.adx,
        atrRatio,
        volumeSurge,
      };
    }

    // Bearish trend
    if (!priceAboveEMA20 && !priceAboveEMA50 && !ema20AboveEMA50 && inputs.priceChange20 < -3) {
      const confidence = Math.min(
        (inputs.adx / 50) * 0.5 +
        (Math.abs(inputs.priceChange20) / 10) * 0.3 +
        (volumeSurge > 1.5 ? 0.2 : 0),
        1.0
      );

      return {
        regime: 'TRENDING_BEAR',
        confidence,
        volatilityLevel,
        trendStrength: inputs.adx,
        atrRatio,
        volumeSurge,
      };
    }
  }

  // If not trending or breakout, it's ranging
  // Determine if volatile or calm ranging
  if (volatilityLevel === 'HIGH' || atrRatio > 1.2) {
    return {
      regime: 'RANGING_VOLATILE',
      confidence: Math.min(
        (1.0 - inputs.adx / 50) * 0.6 + // Lower ADX = higher ranging confidence
        (atrRatio / 2.0) * 0.4, // Higher ATR ratio = more volatile
        1.0
      ),
      volatilityLevel,
      trendStrength: inputs.adx,
      atrRatio,
      volumeSurge,
    };
  } else {
    return {
      regime: 'RANGING_CALM',
      confidence: Math.min(
        (1.0 - inputs.adx / 50) * 0.6 +
        (1.0 - atrRatio) * 0.4, // Lower ATR ratio = calmer
        1.0
      ),
      volatilityLevel,
      trendStrength: inputs.adx,
      atrRatio,
      volumeSurge,
    };
  }
}

/**
 * Base parameters (Phase 1 & 2 standard)
 */
const BASE_PARAMETERS: AdaptiveIndicatorParams = {
  regime: 'RANGING_CALM',
  confidence: 1.0,
  emaFast: 20,
  emaSlow: 50,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2.0,
  atrPeriod: 14,
};

/**
 * Adaptive parameter sets for each regime
 */
const ADAPTIVE_PARAMETERS: Record<MarketRegime, Partial<AdaptiveIndicatorParams>> = {
  TRENDING_BULL: {
    emaFast: 15,
    emaSlow: 40,
    macdFast: 10,
    macdSlow: 22,
    macdSignal: 7,
    rsiPeriod: 11,
    bbPeriod: 15,
    bbStdDev: 2.5,
    atrPeriod: 10,
  },
  TRENDING_BEAR: {
    emaFast: 15,
    emaSlow: 40,
    macdFast: 10,
    macdSlow: 22,
    macdSignal: 7,
    rsiPeriod: 11,
    bbPeriod: 15,
    bbStdDev: 2.5,
    atrPeriod: 10,
  },
  RANGING_VOLATILE: {
    emaFast: 25,
    emaSlow: 60,
    macdFast: 14,
    macdSlow: 30,
    macdSignal: 11,
    rsiPeriod: 17,
    bbPeriod: 25,
    bbStdDev: 2.0,
    atrPeriod: 20,
  },
  RANGING_CALM: {
    emaFast: 20,
    emaSlow: 50,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    rsiPeriod: 14,
    bbPeriod: 20,
    bbStdDev: 1.8,
    atrPeriod: 14,
  },
  BREAKOUT: {
    emaFast: 10,
    emaSlow: 30,
    macdFast: 8,
    macdSlow: 18,
    macdSignal: 6,
    rsiPeriod: 9,
    bbPeriod: 10,
    bbStdDev: 3.0,
    atrPeriod: 7,
  },
};

/**
 * Get adaptive parameters for a given regime
 *
 * @param classification - Regime classification result
 * @returns Adaptive indicator parameters
 */
export function getAdaptiveParameters(classification: RegimeClassification): AdaptiveIndicatorParams {
  // If confidence is low (<0.5), use base parameters
  if (classification.confidence < 0.5) {
    return BASE_PARAMETERS;
  }

  // Blend between base and regime-specific parameters based on confidence
  const regimeParams = ADAPTIVE_PARAMETERS[classification.regime];
  const blendedParams: AdaptiveIndicatorParams = {
    regime: classification.regime,
    confidence: classification.confidence,
    emaFast: blendParameter(BASE_PARAMETERS.emaFast, regimeParams.emaFast || BASE_PARAMETERS.emaFast, classification.confidence),
    emaSlow: blendParameter(BASE_PARAMETERS.emaSlow, regimeParams.emaSlow || BASE_PARAMETERS.emaSlow, classification.confidence),
    macdFast: blendParameter(BASE_PARAMETERS.macdFast, regimeParams.macdFast || BASE_PARAMETERS.macdFast, classification.confidence),
    macdSlow: blendParameter(BASE_PARAMETERS.macdSlow, regimeParams.macdSlow || BASE_PARAMETERS.macdSlow, classification.confidence),
    macdSignal: blendParameter(BASE_PARAMETERS.macdSignal, regimeParams.macdSignal || BASE_PARAMETERS.macdSignal, classification.confidence),
    rsiPeriod: blendParameter(BASE_PARAMETERS.rsiPeriod, regimeParams.rsiPeriod || BASE_PARAMETERS.rsiPeriod, classification.confidence),
    bbPeriod: blendParameter(BASE_PARAMETERS.bbPeriod, regimeParams.bbPeriod || BASE_PARAMETERS.bbPeriod, classification.confidence),
    bbStdDev: blendParameter(BASE_PARAMETERS.bbStdDev, regimeParams.bbStdDev || BASE_PARAMETERS.bbStdDev, classification.confidence),
    atrPeriod: blendParameter(BASE_PARAMETERS.atrPeriod, regimeParams.atrPeriod || BASE_PARAMETERS.atrPeriod, classification.confidence),
  };

  return blendedParams;
}

/**
 * Blend between base and target parameter based on confidence
 */
function blendParameter(base: number, target: number, confidence: number): number {
  return Math.round(base + (target - base) * confidence);
}

/**
 * ATR-based risk parameters for each regime
 */
const ADAPTIVE_RISK: Record<MarketRegime, AdaptiveRiskParams> = {
  TRENDING_BULL: {
    stopLossATRMultiple: 1.5,       // Tighter stops in trends
    takeProfitATRMultiple: 4.0,     // Wider targets
    trailingStopATRMultiple: 1.0,   // Tight trailing
  },
  TRENDING_BEAR: {
    stopLossATRMultiple: 1.5,
    takeProfitATRMultiple: 4.0,
    trailingStopATRMultiple: 1.0,
  },
  RANGING_VOLATILE: {
    stopLossATRMultiple: 2.5,       // Wider stops for noise
    takeProfitATRMultiple: 2.0,     // Tighter targets
    trailingStopATRMultiple: 2.0,   // Wide trailing
  },
  RANGING_CALM: {
    stopLossATRMultiple: 2.0,
    takeProfitATRMultiple: 2.5,
    trailingStopATRMultiple: 1.5,
  },
  BREAKOUT: {
    stopLossATRMultiple: 1.0,       // Very tight stops
    takeProfitATRMultiple: 5.0,     // Very wide targets
    trailingStopATRMultiple: 0.8,   // Very tight trailing
  },
};

/**
 * Calculate ATR-based risk parameters
 *
 * @param regime - Market regime
 * @param atr - Current ATR value
 * @param entryPrice - Entry price
 * @param side - Position side (long/short)
 * @returns Stop-loss, take-profit, and trailing stop prices
 */
export function calculateAdaptiveRiskParams(
  regime: MarketRegime,
  atr: number,
  entryPrice: number,
  side: 'long' | 'short'
): {
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
} {
  const params = ADAPTIVE_RISK[regime];

  const stopDistance = atr * params.stopLossATRMultiple;
  const profitDistance = atr * params.takeProfitATRMultiple;
  const trailingDistance = atr * params.trailingStopATRMultiple;

  if (side === 'long') {
    return {
      stopLoss: entryPrice - stopDistance,
      takeProfit: entryPrice + profitDistance,
      trailingStop: entryPrice - trailingDistance,
    };
  } else {
    return {
      stopLoss: entryPrice + stopDistance,
      takeProfit: entryPrice - profitDistance,
      trailingStop: entryPrice + trailingDistance,
    };
  }
}

/**
 * Get ATR-based risk parameters configuration
 */
export function getAdaptiveRiskConfig(regime: MarketRegime): AdaptiveRiskParams {
  return ADAPTIVE_RISK[regime];
}
