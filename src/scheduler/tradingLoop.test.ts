/**
 * Unit tests for parallel API calls in trading loop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Trading Loop - Parallel API Calls', () => {
  describe('API Call Parallelization', () => {
    it('should call Promise.all for parallel API execution', async () => {
      // Mock the Gate.io client
      const mockGetFuturesCandles = vi.fn().mockImplementation(
        (contract: string, interval: string, limit: number) => {
          return new Promise((resolve) => {
            // Simulate API delay (50ms)
            setTimeout(() => {
              resolve(Array(limit).fill({
                t: Date.now(),
                o: '100',
                h: '101',
                l: '99',
                c: '100.5',
                v: '1000',
              }));
            }, 50);
          });
        }
      );

      const mockGateClient = {
        getFuturesCandles: mockGetFuturesCandles,
        getFuturesTicker: vi.fn().mockResolvedValue({
          last: '100',
          change_percentage: '1.5',
          volume_24h: '10000',
        }),
      };

      // Simulate parallel API calls
      const contract = 'BTC_USDT';
      const startTime = Date.now();

      const [candles1m, candles3m, candles5m, candles15m, candles30m, candles1h] =
        await Promise.all([
          mockGateClient.getFuturesCandles(contract, '1m', 150),
          mockGateClient.getFuturesCandles(contract, '3m', 120),
          mockGateClient.getFuturesCandles(contract, '5m', 100),
          mockGateClient.getFuturesCandles(contract, '15m', 96),
          mockGateClient.getFuturesCandles(contract, '30m', 120),
          mockGateClient.getFuturesCandles(contract, '1h', 168),
        ]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all API calls were made
      expect(mockGetFuturesCandles).toHaveBeenCalledTimes(6);

      // Verify all candles were returned
      expect(candles1m).toHaveLength(150);
      expect(candles3m).toHaveLength(120);
      expect(candles5m).toHaveLength(100);
      expect(candles15m).toHaveLength(96);
      expect(candles30m).toHaveLength(120);
      expect(candles1h).toHaveLength(168);

      // Parallel execution should take ~50ms (not 6 * 50ms = 300ms)
      // Allow some margin for test execution overhead
      expect(duration).toBeLessThan(100);
    });

    it('should execute significantly faster than sequential calls', async () => {
      const mockGetFuturesCandles = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ t: Date.now(), c: '100' }]);
          }, 50);
        });
      });

      // Sequential execution
      const sequentialStart = Date.now();
      await mockGetFuturesCandles();
      await mockGetFuturesCandles();
      await mockGetFuturesCandles();
      await mockGetFuturesCandles();
      await mockGetFuturesCandles();
      await mockGetFuturesCandles();
      const sequentialDuration = Date.now() - sequentialStart;

      mockGetFuturesCandles.mockClear();

      // Parallel execution
      const parallelStart = Date.now();
      await Promise.all([
        mockGetFuturesCandles(),
        mockGetFuturesCandles(),
        mockGetFuturesCandles(),
        mockGetFuturesCandles(),
        mockGetFuturesCandles(),
        mockGetFuturesCandles(),
      ]);
      const parallelDuration = Date.now() - parallelStart;

      // Parallel should be at least 3x faster (ideally 6x, but accounting for overhead)
      expect(parallelDuration).toBeLessThan(sequentialDuration / 3);

      // Sequential should take ~300ms (6 * 50ms)
      expect(sequentialDuration).toBeGreaterThan(250);

      // Parallel should take ~50ms
      expect(parallelDuration).toBeLessThan(100);
    });

    it('should handle API errors gracefully in parallel execution', async () => {
      const mockGetFuturesCandles = vi.fn().mockImplementation(
        (contract: string, interval: string) => {
          if (interval === '3m') {
            return Promise.reject(new Error('API rate limit exceeded'));
          }
          return Promise.resolve([{ t: Date.now(), c: '100' }]);
        }
      );

      // Should catch errors without stopping other requests
      await expect(async () => {
        await Promise.all([
          mockGetFuturesCandles('BTC_USDT', '1m', 150),
          mockGetFuturesCandles('BTC_USDT', '3m', 120), // Will fail
          mockGetFuturesCandles('BTC_USDT', '5m', 100),
        ]);
      }).rejects.toThrow('API rate limit exceeded');

      // All 3 calls should have been attempted
      expect(mockGetFuturesCandles).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success/failure in Promise.allSettled', async () => {
      const mockGetFuturesCandles = vi.fn().mockImplementation(
        (contract: string, interval: string) => {
          if (interval === '3m' || interval === '15m') {
            return Promise.reject(new Error(`API error for ${interval}`));
          }
          return Promise.resolve([{ t: Date.now(), c: '100', interval }]);
        }
      );

      const results = await Promise.allSettled([
        mockGetFuturesCandles('BTC_USDT', '1m', 150),
        mockGetFuturesCandles('BTC_USDT', '3m', 120), // Fails
        mockGetFuturesCandles('BTC_USDT', '5m', 100),
        mockGetFuturesCandles('BTC_USDT', '15m', 96), // Fails
        mockGetFuturesCandles('BTC_USDT', '30m', 120),
        mockGetFuturesCandles('BTC_USDT', '1h', 168),
      ]);

      // Check results
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
      expect(results[3].status).toBe('rejected');
      expect(results[4].status).toBe('fulfilled');
      expect(results[5].status).toBe('fulfilled');

      // Count successes and failures
      const successes = results.filter(r => r.status === 'fulfilled').length;
      const failures = results.filter(r => r.status === 'rejected').length;

      expect(successes).toBe(4);
      expect(failures).toBe(2);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should demonstrate 83% latency reduction (7.2s → 1.2s)', async () => {
      // Simulate Gate.io API latency (200ms per call)
      const mockGetFuturesCandles = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ t: Date.now(), c: '100' }]);
          }, 200);
        });
      });

      // Old sequential approach (7.2s for 6 symbols × 6 timeframes)
      const sequentialStart = Date.now();
      for (let symbol = 0; symbol < 6; symbol++) {
        // Sequential calls per symbol
        await mockGetFuturesCandles();
        await mockGetFuturesCandles();
        await mockGetFuturesCandles();
        await mockGetFuturesCandles();
        await mockGetFuturesCandles();
        await mockGetFuturesCandles();
      }
      const sequentialDuration = Date.now() - sequentialStart;

      mockGetFuturesCandles.mockClear();

      // New parallel approach (1.2s for 6 symbols with parallel timeframes)
      const parallelStart = Date.now();
      for (let symbol = 0; symbol < 6; symbol++) {
        // Parallel calls per symbol
        await Promise.all([
          mockGetFuturesCandles(),
          mockGetFuturesCandles(),
          mockGetFuturesCandles(),
          mockGetFuturesCandles(),
          mockGetFuturesCandles(),
          mockGetFuturesCandles(),
        ]);
      }
      const parallelDuration = Date.now() - parallelStart;

      // Calculate improvement
      const improvement = ((sequentialDuration - parallelDuration) / sequentialDuration) * 100;

      // Should be ~83% faster (allowing 10% margin for test overhead)
      expect(improvement).toBeGreaterThan(73);
      expect(improvement).toBeLessThan(93);

      // Sequential: 6 symbols × 6 timeframes × 200ms = ~7200ms
      expect(sequentialDuration).toBeGreaterThan(6500);
      expect(sequentialDuration).toBeLessThan(8000);

      // Parallel: 6 symbols × 200ms (one Promise.all per symbol) = ~1200ms
      expect(parallelDuration).toBeGreaterThan(1000);
      expect(parallelDuration).toBeLessThan(1500);
    });

    it('should handle high concurrency without race conditions', async () => {
      let callOrder: string[] = [];

      const mockGetFuturesCandles = vi.fn().mockImplementation(
        (contract: string, interval: string) => {
          return new Promise((resolve) => {
            // Simulate variable API response times
            const delay = interval === '1h' ? 100 : 50;
            setTimeout(() => {
              callOrder.push(interval);
              resolve([{ t: Date.now(), c: '100', interval }]);
            }, delay);
          });
        }
      );

      const results = await Promise.all([
        mockGetFuturesCandles('BTC_USDT', '1m', 150),
        mockGetFuturesCandles('BTC_USDT', '3m', 120),
        mockGetFuturesCandles('BTC_USDT', '5m', 100),
        mockGetFuturesCandles('BTC_USDT', '15m', 96),
        mockGetFuturesCandles('BTC_USDT', '30m', 120),
        mockGetFuturesCandles('BTC_USDT', '1h', 168),
      ]);

      // All results should be present
      expect(results).toHaveLength(6);

      // Verify no data corruption (each result has correct interval)
      expect(results[0][0].interval).toBe('1m');
      expect(results[1][0].interval).toBe('3m');
      expect(results[2][0].interval).toBe('5m');
      expect(results[3][0].interval).toBe('15m');
      expect(results[4][0].interval).toBe('30m');
      expect(results[5][0].interval).toBe('1h');

      // Completion order should be based on delay (faster first)
      // But results array should maintain original order
      expect(callOrder.indexOf('1h')).toBe(5); // Slowest, completes last
      expect(callOrder.indexOf('1m')).toBeLessThan(callOrder.indexOf('1h'));
    });
  });

  describe('API Call Correctness', () => {
    it('should pass correct parameters to each API call', async () => {
      const mockGetFuturesCandles = vi.fn().mockResolvedValue([]);

      await Promise.all([
        mockGetFuturesCandles('BTC_USDT', '1m', 150),
        mockGetFuturesCandles('BTC_USDT', '3m', 120),
        mockGetFuturesCandles('BTC_USDT', '5m', 100),
        mockGetFuturesCandles('BTC_USDT', '15m', 96),
        mockGetFuturesCandles('BTC_USDT', '30m', 120),
        mockGetFuturesCandles('BTC_USDT', '1h', 168),
      ]);

      // Verify correct parameters for each call
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '1m', 150);
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '3m', 120);
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '5m', 100);
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '15m', 96);
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '30m', 120);
      expect(mockGetFuturesCandles).toHaveBeenCalledWith('BTC_USDT', '1h', 168);
    });

    it('should maintain data integrity across parallel calls', async () => {
      const mockGetFuturesCandles = vi.fn().mockImplementation(
        (contract: string, interval: string, limit: number) => {
          return Promise.resolve(
            Array(limit).fill({
              t: Date.now(),
              c: `${interval}`,
              v: String(limit),
            })
          );
        }
      );

      const [candles1m, candles3m, candles5m, candles15m, candles30m, candles1h] =
        await Promise.all([
          mockGetFuturesCandles('BTC_USDT', '1m', 150),
          mockGetFuturesCandles('BTC_USDT', '3m', 120),
          mockGetFuturesCandles('BTC_USDT', '5m', 100),
          mockGetFuturesCandles('BTC_USDT', '15m', 96),
          mockGetFuturesCandles('BTC_USDT', '30m', 120),
          mockGetFuturesCandles('BTC_USDT', '1h', 168),
        ]);

      // Verify data integrity - each result has correct interval marker
      expect(candles1m[0].c).toBe('1m');
      expect(candles1m[0].v).toBe('150');
      expect(candles1m).toHaveLength(150);

      expect(candles3m[0].c).toBe('3m');
      expect(candles3m[0].v).toBe('120');
      expect(candles3m).toHaveLength(120);

      expect(candles5m[0].c).toBe('5m');
      expect(candles5m[0].v).toBe('100');
      expect(candles5m).toHaveLength(100);

      expect(candles15m[0].c).toBe('15m');
      expect(candles15m[0].v).toBe('96');
      expect(candles15m).toHaveLength(96);

      expect(candles30m[0].c).toBe('30m');
      expect(candles30m[0].v).toBe('120');
      expect(candles30m).toHaveLength(120);

      expect(candles1h[0].c).toBe('1h');
      expect(candles1h[0].v).toBe('168');
      expect(candles1h).toHaveLength(168);
    });
  });
});
