/**
 * Unit tests for weighted confluence scoring system
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTimeframeSignalScore,
  calculateWeightedConfluence,
  formatConfluenceResult,
  type TimeframeIndicators,
} from './confluenceScoring';

describe('Confluence Scoring System', () => {
  describe('calculateTimeframeSignalScore', () => {
    it('should calculate strong bullish score for clear uptrend', () => {
      const indicators: TimeframeIndicators = {
        interval: '1h',
        currentPrice: 105,
        ema20: 100,
        ema50: 98,
        macd: 50,
        rsi7: 70,
        rsi14: 65,
        volume: 1500,
        avgVolume: 1000,
      };

      const score = calculateTimeframeSignalScore(indicators);

      expect(score.direction).toBe('BULLISH');
      expect(score.priceVsEma20).toBeGreaterThan(5); // 5% above EMA20
      expect(score.macdStrength).toBeGreaterThan(0);
      expect(score.rsiPosition).toBeGreaterThan(0); // RSI 65 is 15 points from neutral
      expect(score.volumeConfirmation).toBeGreaterThan(5); // 1.5x avg volume
      expect(score.totalScore).toBeGreaterThan(20); // Strong signal
    });

    it('should calculate strong bearish score for clear downtrend', () => {
      const indicators: TimeframeIndicators = {
        interval: '1h',
        currentPrice: 95,
        ema20: 100,
        ema50: 102,
        macd: -50,
        rsi7: 30,
        rsi14: 35,
        volume: 1500,
        avgVolume: 1000,
      };

      const score = calculateTimeframeSignalScore(indicators);

      expect(score.direction).toBe('BEARISH');
      expect(score.priceVsEma20).toBeGreaterThan(5); // 5% below EMA20
      expect(score.macdStrength).toBeGreaterThan(0); // MACD negative but strength counted
      expect(score.totalScore).toBeGreaterThan(20); // Strong signal
    });

    it('should return neutral for weak/mixed signals', () => {
      const indicators: TimeframeIndicators = {
        interval: '5m',
        currentPrice: 100,
        ema20: 100.1, // Price slightly below EMA (bearish)
        ema50: 99.9,  // But price above EMA50 (bullish)
        macd: 0.1,    // Very weak positive (bullish)
        rsi7: 51,     // Slightly bullish
        rsi14: 49,    // Slightly bearish
        volume: 1000,
        avgVolume: 1000,
      };

      const score = calculateTimeframeSignalScore(indicators);

      // With 2 bearish and 2 bullish indicators, should be NEUTRAL
      expect(score.direction).toBe('NEUTRAL');
      expect(score.priceVsEma20).toBeLessThan(1); // Very close to EMA
      expect(score.totalScore).toBeLessThan(10); // Weak signal
    });

    it('should handle edge case: price exactly at EMA', () => {
      const indicators: TimeframeIndicators = {
        interval: '15m',
        currentPrice: 100,
        ema20: 100,
        ema50: 100,
        macd: 0,
        rsi7: 50,
        rsi14: 50,
        volume: 1000,
        avgVolume: 1000,
      };

      const score = calculateTimeframeSignalScore(indicators);

      expect(score.direction).toBe('NEUTRAL');
      expect(score.priceVsEma20).toBe(0);
      expect(score.priceVsEma50).toBe(0);
      expect(score.macdStrength).toBe(0);
      expect(score.rsiPosition).toBe(0);
      expect(score.volumeConfirmation).toBe(5); // Normal volume
      expect(score.totalScore).toBe(5);
    });

    it('should cap scores at 10 for extreme values', () => {
      const indicators: TimeframeIndicators = {
        interval: '1h',
        currentPrice: 200, // 100% above EMA
        ema20: 100,
        ema50: 100,
        macd: 500, // Extremely high MACD
        rsi7: 100, // RSI at ceiling
        rsi14: 100,
        volume: 10000, // 10x volume
        avgVolume: 1000,
      };

      const score = calculateTimeframeSignalScore(indicators);

      // All scores should be capped at 10
      expect(score.priceVsEma20).toBeLessThanOrEqual(10);
      expect(score.priceVsEma50).toBeLessThanOrEqual(10);
      expect(score.macdStrength).toBeLessThanOrEqual(10);
      expect(score.rsiPosition).toBeLessThanOrEqual(10);
      expect(score.volumeConfirmation).toBeLessThanOrEqual(10);
      expect(score.totalScore).toBeLessThanOrEqual(50); // Max possible
    });

    it('should handle invalid data gracefully', () => {
      const indicators: TimeframeIndicators = {
        interval: '1m',
        currentPrice: 0, // Invalid
        ema20: 0,
        ema50: 0,
        macd: NaN,
        rsi7: 150, // Out of range
        rsi14: -10, // Out of range
        volume: -100, // Negative
        avgVolume: 0,
      };

      const score = calculateTimeframeSignalScore(indicators);

      // Should not throw errors
      expect(score).toBeDefined();
      expect(score.totalScore).toBeGreaterThanOrEqual(0);
      expect(score.totalScore).toBeLessThanOrEqual(50);
    });
  });

  describe('calculateWeightedConfluence', () => {
    it('should calculate strong confluence when all timeframes align bullish', () => {
      const timeframes: TimeframeIndicators[] = [
        {
          interval: '1m',
          currentPrice: 110,  // Stronger signal: 10% above EMA
          ema20: 100,
          ema50: 95,
          macd: 50,           // Stronger MACD
          rsi7: 75,           // Stronger RSI
          rsi14: 70,
          volume: 2000,       // 2x volume
          avgVolume: 1000,
        },
        {
          interval: '5m',
          currentPrice: 110,
          ema20: 100,
          ema50: 95,
          macd: 55,
          rsi7: 77,
          rsi14: 72,
          volume: 2100,
          avgVolume: 1000,
        },
        {
          interval: '1h',
          currentPrice: 110,
          ema20: 100,
          ema50: 94,
          macd: 60,
          rsi7: 80,
          rsi14: 75,
          volume: 2500,
          avgVolume: 1000,
        },
      ];

      const result = calculateWeightedConfluence(timeframes);

      expect(result.overallDirection).toBe('BULLISH');
      expect(result.alignedTimeframes).toBe(3);
      expect(result.totalTimeframes).toBe(3);
      expect(result.alignmentPercent).toBe(100);
      expect(result.signalQuality).toBe('STRONG');
      expect(result.totalScore).toBeGreaterThan(70); // Adjusted expectation
    });

    it('should apply higher weights to longer timeframes', () => {
      const timeframeShort: TimeframeIndicators[] = [
        {
          interval: '1m',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 50,
          rsi7: 70,
          rsi14: 65,
          volume: 1500,
          avgVolume: 1000,
        },
      ];

      const timeframeLong: TimeframeIndicators[] = [
        {
          interval: '1h',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 50,
          rsi7: 70,
          rsi14: 65,
          volume: 1500,
          avgVolume: 1000,
        },
      ];

      const resultShort = calculateWeightedConfluence(timeframeShort);
      const resultLong = calculateWeightedConfluence(timeframeLong);

      // 1h timeframe (weight 3.5) should have higher weighted score than 1m (weight 1.0)
      // Check the weighted score of the individual timeframe
      const shortWeightedScore = resultShort.scores[0].weightedScore;
      const longWeightedScore = resultLong.scores[0].weightedScore;

      expect(longWeightedScore).toBeGreaterThan(shortWeightedScore);
      expect(longWeightedScore / shortWeightedScore).toBeCloseTo(3.5, 0); // Weight ratio
    });

    it('should identify mixed signals correctly', () => {
      const timeframes: TimeframeIndicators[] = [
        {
          interval: '1m',
          currentPrice: 105, // Bullish
          ema20: 100,
          ema50: 98,
          macd: 20,
          rsi7: 65,
          rsi14: 60,
          volume: 1200,
          avgVolume: 1000,
        },
        {
          interval: '5m',
          currentPrice: 95, // Bearish
          ema20: 100,
          ema50: 102,
          macd: -20,
          rsi7: 35,
          rsi14: 40,
          volume: 1200,
          avgVolume: 1000,
        },
        {
          interval: '1h',
          currentPrice: 100, // Neutral
          ema20: 100,
          ema50: 100,
          macd: 0,
          rsi7: 50,
          rsi14: 50,
          volume: 1000,
          avgVolume: 1000,
        },
      ];

      const result = calculateWeightedConfluence(timeframes);

      expect(result.overallDirection).toBe('NEUTRAL');
      expect(result.alignmentPercent).toBeLessThan(50);
      expect(result.signalQuality).toBe('WEAK');
    });

    it('should require 50%+ alignment for directional bias', () => {
      const timeframes: TimeframeIndicators[] = [
        {
          interval: '1m',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 20,
          rsi7: 65,
          rsi14: 60,
          volume: 1200,
        },
        {
          interval: '5m',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 25,
          rsi7: 67,
          rsi14: 62,
          volume: 1300,
        },
        {
          interval: '15m',
          currentPrice: 95, // Bearish - minority
          ema20: 100,
          ema50: 102,
          macd: -20,
          rsi7: 35,
          rsi14: 40,
          volume: 1200,
        },
        {
          interval: '1h',
          currentPrice: 100, // Neutral
          ema20: 100,
          ema50: 100,
          macd: 0,
          rsi7: 50,
          rsi14: 50,
          volume: 1000,
        },
      ];

      const result = calculateWeightedConfluence(timeframes);

      // 2 bullish out of 4 = 50%, should be BULLISH
      expect(result.overallDirection).toBe('BULLISH');
      expect(result.alignmentPercent).toBe(50);
    });

    it('should handle empty timeframe array', () => {
      const result = calculateWeightedConfluence([]);

      expect(result.totalScore).toBe(0);
      expect(result.averageScore).toBe(0);
      expect(result.alignedTimeframes).toBe(0);
      expect(result.totalTimeframes).toBe(0);
      expect(result.alignmentPercent).toBe(0);
      expect(result.overallDirection).toBe('NEUTRAL');
      expect(result.signalQuality).toBe('WEAK');
    });

    it('should calculate signal quality thresholds correctly', () => {
      // Strong: >= 70 score AND >= 75% alignment
      const strongTimeframes: TimeframeIndicators[] = Array(4).fill(null).map((_, i) => ({
        interval: ['1m', '5m', '15m', '1h'][i],
        currentPrice: 110,
        ema20: 100,
        ema50: 95,
        macd: 50,
        rsi7: 75,
        rsi14: 70,
        volume: 2000,
        avgVolume: 1000,
      }));

      const strongResult = calculateWeightedConfluence(strongTimeframes);
      expect(strongResult.signalQuality).toBe('STRONG');

      // Moderate: >= 50 score AND >= 60% alignment
      const moderateTimeframes: TimeframeIndicators[] = [
        {
          interval: '1m',
          currentPrice: 103,
          ema20: 100,
          ema50: 98,
          macd: 15,
          rsi7: 60,
          rsi14: 58,
          volume: 1200,
          avgVolume: 1000,
        },
        {
          interval: '5m',
          currentPrice: 103,
          ema20: 100,
          ema50: 98,
          macd: 18,
          rsi7: 62,
          rsi14: 60,
          volume: 1300,
          avgVolume: 1000,
        },
        {
          interval: '1h',
          currentPrice: 103,
          ema20: 100,
          ema50: 98,
          macd: 20,
          rsi7: 64,
          rsi14: 62,
          volume: 1400,
          avgVolume: 1000,
        },
      ];

      const moderateResult = calculateWeightedConfluence(moderateTimeframes);
      expect(moderateResult.signalQuality).toBe('MODERATE');
    });
  });

  describe('formatConfluenceResult', () => {
    it('should format result as readable text', () => {
      const result = calculateWeightedConfluence([
        {
          interval: '1h',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 30,
          rsi7: 70,
          rsi14: 65,
          volume: 1500,
          avgVolume: 1000,
        },
      ]);

      const formatted = formatConfluenceResult(result);

      expect(formatted).toContain('【加权共振分析】');
      expect(formatted).toContain('总分:');
      expect(formatted).toContain('对齐度:');
      expect(formatted).toContain('整体方向:');
      expect(formatted).toContain('信号质量:');
      expect(formatted).toContain('【各时间框架详情】');
      expect(formatted).toContain('1h');
    });

    it('should include all timeframe details', () => {
      const result = calculateWeightedConfluence([
        {
          interval: '1m',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 20,
          rsi7: 65,
          rsi14: 60,
          volume: 1200,
          avgVolume: 1000,
        },
        {
          interval: '1h',
          currentPrice: 105,
          ema20: 100,
          ema50: 98,
          macd: 30,
          rsi7: 70,
          rsi14: 65,
          volume: 1500,
          avgVolume: 1000,
        },
      ]);

      const formatted = formatConfluenceResult(result);

      expect(formatted).toContain('1m');
      expect(formatted).toContain('1h');
      expect(formatted).toContain('价格-EMA20:');
      expect(formatted).toContain('MACD强度:');
      expect(formatted).toContain('RSI位置:');
    });
  });
});
