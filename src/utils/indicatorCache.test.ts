/**
 * Unit tests for indicator caching system
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  IndicatorCache,
  getIndicatorCache,
  resetIndicatorCache,
  type CachedIndicators,
} from './indicatorCache';

describe('Indicator Cache System', () => {
  let cache: IndicatorCache;

  // Helper: Default Phase 2 indicator values for tests
  const defaultPhase2Values = {
    bbUpper: 0,
    bbMiddle: 0,
    bbLower: 0,
    bbPercent: 0.5,
    bbBandwidth: 0,
    vwap: 0,
    vwapDeviation: 0,
    obv: 0,
    obvEma20: 0,
  };

  beforeEach(() => {
    cache = new IndicatorCache(60000, 100); // 60s TTL, 100 max size
  });

  afterEach(() => {
    cache.clear();
    cache.resetStats();
  });

  describe('Basic Cache Operations', () => {
    it('should store and retrieve indicators', () => {
      const indicators: CachedIndicators = {
        ema20: 100.5,
        ema50: 99.2,
        macd: 1.5,
        rsi7: 65,
        rsi14: 60,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1234567890, indicators);
      const retrieved = cache.get('BTC', '1h', 1234567890);

      expect(retrieved).toEqual(indicators);
    });

    it('should return null for non-existent cache entry', () => {
      const result = cache.get('BTC', '1h', 1234567890);
      expect(result).toBeNull();
    });

    it('should return null for different candle timestamp', () => {
      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);

      // Try to get with different timestamp
      const result = cache.get('BTC', '1h', 2000);
      expect(result).toBeNull();
    });

    it('should handle multiple symbols and timeframes', () => {
      const btcIndicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      const ethIndicators: CachedIndicators = {
        ema20: 200,
        ema50: 199,
        macd: 2,
        rsi7: 70,
        rsi14: 65,
        volume: 2000,
        avgVolume: 1800,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, btcIndicators);
      cache.set('ETH', '1h', 1000, ethIndicators);
      cache.set('BTC', '5m', 1000, btcIndicators);

      expect(cache.get('BTC', '1h', 1000)).toEqual(btcIndicators);
      expect(cache.get('ETH', '1h', 1000)).toEqual(ethIndicators);
      expect(cache.get('BTC', '5m', 1000)).toEqual(btcIndicators);
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should expire cache after TTL', async () => {
      const cache = new IndicatorCache(100, 100); // 100ms TTL

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);

      // Should be available immediately
      expect(cache.get('BTC', '1h', 1000)).toEqual(indicators);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be null after expiration
      expect(cache.get('BTC', '1h', 1000)).toBeNull();
    });

    it('should not expire cache before TTL', async () => {
      const cache = new IndicatorCache(500, 100); // 500ms TTL

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);

      // Wait 200ms (less than TTL)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should still be available
      expect(cache.get('BTC', '1h', 1000)).toEqual(indicators);
    });
  });

  describe('LRU (Least Recently Used) Eviction', () => {
    it('should evict oldest entry when cache is full', () => {
      const cache = new IndicatorCache(60000, 3); // Max 3 entries

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      cache.set('ETH', '1h', 1000, indicators);
      cache.set('SOL', '1h', 1000, indicators);

      // Cache is full (3/3)
      expect(cache.getStats().size).toBe(3);

      // Add 4th entry, should evict BTC (oldest)
      cache.set('XRP', '1h', 1000, indicators);

      expect(cache.getStats().size).toBe(3);
      expect(cache.get('BTC', '1h', 1000)).toBeNull(); // Evicted
      expect(cache.get('ETH', '1h', 1000)).toEqual(indicators);
      expect(cache.get('SOL', '1h', 1000)).toEqual(indicators);
      expect(cache.get('XRP', '1h', 1000)).toEqual(indicators);
    });
  });

  describe('Hit Rate Statistics', () => {
    it('should track cache hits and misses', () => {
      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);

      // Hit
      cache.get('BTC', '1h', 1000);
      cache.recordHit();

      // Miss
      cache.get('ETH', '1h', 1000);
      cache.recordMiss();

      // Hit
      cache.get('BTC', '1h', 1000);
      cache.recordHit();

      const stats = cache.getHitRate();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.total).toBe(3);
      expect(stats.hitRate).toBeCloseTo(66.67, 1); // 2/3 = 66.67%
    });

    it('should calculate 0% hit rate with no accesses', () => {
      const stats = cache.getHitRate();
      expect(stats.hitRate).toBe(0);
      expect(stats.total).toBe(0);
    });

    it('should reset statistics', () => {
      cache.recordHit();
      cache.recordHit();
      cache.recordMiss();

      cache.resetStats();

      const stats = cache.getHitRate();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  describe('Clean Expired Entries', () => {
    it('should clean expired entries', async () => {
      const cache = new IndicatorCache(100, 100); // 100ms TTL

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      cache.set('ETH', '1h', 1000, indicators);
      cache.set('SOL', '1h', 1000, indicators);

      expect(cache.getStats().size).toBe(3);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Clean expired
      const cleaned = cache.cleanExpired();

      expect(cleaned).toBe(3);
      expect(cache.getStats().size).toBe(0);
    });

    it('should not clean valid entries', async () => {
      const cache = new IndicatorCache(500, 100); // 500ms TTL

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      cache.set('ETH', '1h', 1000, indicators);

      // Wait 200ms (less than TTL)
      await new Promise(resolve => setTimeout(resolve, 200));

      const cleaned = cache.cleanExpired();

      expect(cleaned).toBe(0);
      expect(cache.getStats().size).toBe(2);
    });
  });

  describe('Clear Cache', () => {
    it('should clear all entries', () => {
      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      cache.set('ETH', '1h', 1000, indicators);
      cache.set('SOL', '1h', 1000, indicators);

      expect(cache.getStats().size).toBe(3);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get('BTC', '1h', 1000)).toBeNull();
      expect(cache.get('ETH', '1h', 1000)).toBeNull();
      expect(cache.get('SOL', '1h', 1000)).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    it('should return correct cache stats', () => {
      const cache = new IndicatorCache(60000, 100);

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      cache.set('ETH', '1h', 1000, indicators);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(100);
      expect(stats.ttl).toBe(60000);
    });
  });

  describe('Global Cache Singleton', () => {
    afterEach(() => {
      resetIndicatorCache();
    });

    it('should return same instance on multiple calls', () => {
      const cache1 = getIndicatorCache();
      const cache2 = getIndicatorCache();

      expect(cache1).toBe(cache2);
    });

    it('should share data across getInstance calls', () => {
      const cache1 = getIndicatorCache();
      const cache2 = getIndicatorCache();

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache1.set('BTC', '1h', 1000, indicators);

      const retrieved = cache2.get('BTC', '1h', 1000);
      expect(retrieved).toEqual(indicators);
    });

    it('should reset global instance', () => {
      const cache1 = getIndicatorCache();

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache1.set('BTC', '1h', 1000, indicators);

      resetIndicatorCache();

      const cache2 = getIndicatorCache();

      // Should be new instance with empty cache
      expect(cache2.get('BTC', '1h', 1000)).toBeNull();
      expect(cache2.getStats().size).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers', () => {
      const indicators: CachedIndicators = {
        ema20: 1e10,
        ema50: 9e9,
        macd: 1e8,
        rsi7: 99.999,
        rsi14: 99.888,
        volume: 1e12,
        avgVolume: 9e11,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1234567890000, indicators);
      const retrieved = cache.get('BTC', '1h', 1234567890000);

      expect(retrieved).toEqual(indicators);
    });

    it('should handle negative numbers', () => {
      const indicators: CachedIndicators = {
        ema20: -100,
        ema50: -99,
        macd: -1.5,
        rsi7: 0,
        rsi14: 0,
        volume: 0,
        avgVolume: 0,
        ...defaultPhase2Values,
      };

      cache.set('BTC', '1h', 1000, indicators);
      const retrieved = cache.get('BTC', '1h', 1000);

      expect(retrieved).toEqual(indicators);
    });

    it('should handle optional fields', () => {
      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
        atr3: 2.5,
        atr14: 3.2,
        priceChange20: 5.5,
      };

      cache.set('BTC', '1h', 1000, indicators);
      const retrieved = cache.get('BTC', '1h', 1000);

      expect(retrieved).toEqual(indicators);
      expect(retrieved?.atr3).toBe(2.5);
      expect(retrieved?.atr14).toBe(3.2);
      expect(retrieved?.priceChange20).toBe(5.5);
    });

    it('should handle symbols with special characters', () => {
      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      cache.set('BTC-USD', '1h', 1000, indicators);
      cache.set('BTC_USDT', '5m', 1000, indicators);
      cache.set('BTC/USDT', '15m', 1000, indicators);

      expect(cache.get('BTC-USD', '1h', 1000)).toEqual(indicators);
      expect(cache.get('BTC_USDT', '5m', 1000)).toEqual(indicators);
      expect(cache.get('BTC/USDT', '15m', 1000)).toEqual(indicators);
    });
  });

  describe('Performance', () => {
    it('should handle large number of cache operations efficiently', () => {
      const startTime = Date.now();

      const indicators: CachedIndicators = {
        ema20: 100,
        ema50: 99,
        macd: 1,
        rsi7: 60,
        rsi14: 55,
        volume: 1000,
        avgVolume: 900,
        ...defaultPhase2Values,
      };

      // Perform 1000 set operations
      for (let i = 0; i < 1000; i++) {
        cache.set(`SYMBOL${i}`, '1h', 1000 + i, indicators);
      }

      // Perform 1000 get operations
      for (let i = 0; i < 1000; i++) {
        cache.get(`SYMBOL${i}`, '1h', 1000 + i);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in less than 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
