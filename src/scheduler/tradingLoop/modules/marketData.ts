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
 * Market Data Collection Module
 *
 * This module handles collection of multi-timeframe market data for trading symbols.
 * It fetches price data, candlestick data, calculates indicators, and persists to database.
 *
 * Uses standardized exchange abstraction layer (IExchangeClient) for exchange-agnostic data collection.
 */

import { Client } from '@libsql/client';
import { IExchangeClient } from '../../../services/exchange/IExchangeClient';
import { createPinoLogger } from '@voltagent/logger';
import { getChinaTimeISO } from '../../../utils/timeUtils';
import { ensureFinite } from '../utils/validation';
import {
  calculateIndicators,
  calculateIntradaySeries,
  calculateLongerTermContext,
  Indicators,
  IntradaySeries,
  LongerTermContext,
} from './indicators';

const logger = createPinoLogger({
  name: 'market-data',
  level: 'info',
});

/**
 * Timeframe configuration for candlestick data collection
 */
export interface TimeframeConfig {
  interval: string;
  candleCount: number;
}

/**
 * Market data for a single symbol
 */
export interface SymbolMarketData {
  price: number;
  change24h: number;
  volume24h: number;
  fundingRate: number;
  openInterest: {
    latest: number;
    average: number;
  };
  // Main indicators (default from 5m timeframe)
  currentPrice: number;
  ema20: number;
  ema50: number;
  macd: number;
  rsi7: number;
  rsi14: number;
  volume: number;
  avgVolume: number;
  // Time series data
  intradaySeries: IntradaySeries;
  longerTermContext: LongerTermContext;
  // Multi-timeframe indicators
  timeframes: Record<string, Indicators>;
}

/**
 * Market data collector configuration
 */
export interface MarketDataConfig {
  symbols: string[];
  enabledTimeframes: string[];
  timeframeConfigs: Record<string, TimeframeConfig>;
}

/**
 * Market Data Collector
 *
 * Collects comprehensive market data for trading symbols across multiple timeframes.
 */
export class MarketDataCollector {
  constructor(
    private exchangeClient: IExchangeClient,
    private database: Client,
    private config: MarketDataConfig
  ) {}

  /**
   * Collect all market data for all configured symbols
   *
   * @returns Record of symbol to market data
   */
  async collectAll(): Promise<Record<string, SymbolMarketData>> {
    const marketData: Record<string, SymbolMarketData> = {};

    for (const symbol of this.config.symbols) {
      try {
        const symbolData = await this.collectSymbolData(symbol);
        if (symbolData) {
          marketData[symbol] = symbolData;
        }
      } catch (error) {
        logger.error(`Failed to collect market data for ${symbol}:`, error as any);
      }
    }

    return marketData;
  }

  /**
   * Collect market data for a single symbol
   *
   * @param symbol - Normalized symbol (e.g., "BTC")
   * @returns Symbol market data or null if failed
   */
  private async collectSymbolData(symbol: string): Promise<SymbolMarketData | null> {
    // 1. Fetch ticker with retry logic
    const ticker = await this.fetchTickerWithRetry(symbol);
    if (!ticker) {
      return null;
    }

    // 2. Fetch candlestick data for all enabled timeframes
    const { candlesData, indicatorsData } = await this.fetchMultiTimeframeData(symbol);

    // 3. Calculate intraday time series (prefer 3m, fallback to 5m)
    const intradaySeries = this.calculateIntradaySeries(candlesData);

    // 4. Calculate longer-term context (1h)
    const longerTermContext = this.calculateLongerTermContext(candlesData);

    // 5. Get main indicators (prefer 5m, fallback to first available)
    const indicators = this.getMainIndicators(indicatorsData);

    // 6. Validate data quality
    this.validateDataQuality(symbol, ticker, indicators, candlesData);

    // 7. Fetch funding rate
    const fundingRate = await this.fetchFundingRate(symbol);

    // 8. Build timeframes object
    const timeframes = this.buildTimeframesObject(indicatorsData);

    // 9. Build symbol market data
    const symbolData: SymbolMarketData = {
      price: ticker.lastPrice,
      change24h: ticker.change24h,
      volume24h: ticker.volume24h,
      fundingRate,
      openInterest: { latest: 0, average: 0 }, // Not all exchanges provide this
      ...indicators,
      intradaySeries,
      longerTermContext,
      timeframes,
    };

    // 10. Save to database
    await this.saveToDatabase(symbol, symbolData, indicators, fundingRate);

    return symbolData;
  }

  /**
   * Fetch ticker with retry logic
   */
  private async fetchTickerWithRetry(symbol: string, maxRetries: number = 2): Promise<any | null> {
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const ticker = await this.exchangeClient.getFuturesTicker(symbol);

        // Validate price
        if (ticker.lastPrice === 0 || !Number.isFinite(ticker.lastPrice)) {
          throw new Error(`Invalid price: ${ticker.lastPrice}`);
        }

        return ticker;
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          logger.error(`${symbol} price fetch failed (${maxRetries} retries):`, error as any);
          return null;
        }
        logger.warn(`${symbol} price fetch failed, retrying ${retryCount}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return null;
  }

  /**
   * Fetch candlestick data for all enabled timeframes
   */
  private async fetchMultiTimeframeData(symbol: string): Promise<{
    candlesData: Record<string, any[]>;
    indicatorsData: Record<string, Indicators>;
  }> {
    const candlesData: Record<string, any[]> = {};
    const indicatorsData: Record<string, Indicators> = {};

    for (const timeframe of this.config.enabledTimeframes) {
      const config = this.config.timeframeConfigs[timeframe];
      if (!config) continue;

      try {
        const candles = await this.exchangeClient.getFuturesCandles(
          symbol,
          config.interval as any,
          config.candleCount
        );
        candlesData[timeframe] = candles;
        indicatorsData[timeframe] = calculateIndicators(candles);
      } catch (error) {
        logger.warn(`Failed to fetch ${symbol} ${timeframe} candles:`, error as any);
        candlesData[timeframe] = [];
        indicatorsData[timeframe] = this.getEmptyIndicators();
      }
    }

    return { candlesData, indicatorsData };
  }

  /**
   * Calculate intraday series (prefer 3m, fallback to 5m)
   */
  private calculateIntradaySeries(candlesData: Record<string, any[]>): IntradaySeries {
    if (candlesData['3m']?.length > 0) {
      return calculateIntradaySeries(candlesData['3m']);
    }
    if (candlesData['5m']?.length > 0) {
      return calculateIntradaySeries(candlesData['5m']);
    }
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  /**
   * Calculate longer-term context (1h)
   */
  private calculateLongerTermContext(candlesData: Record<string, any[]>): LongerTermContext {
    if (candlesData['1h']?.length > 0) {
      return calculateLongerTermContext(candlesData['1h']);
    }
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

  /**
   * Get main indicators (prefer 5m, fallback to first available)
   */
  private getMainIndicators(indicatorsData: Record<string, Indicators>): Indicators {
    if (Object.keys(indicatorsData['5m'] || {}).length > 0) {
      return indicatorsData['5m'];
    }

    // Fallback to first available timeframe
    const firstTimeframe = this.config.enabledTimeframes[0];
    if (firstTimeframe && indicatorsData[firstTimeframe]) {
      return indicatorsData[firstTimeframe];
    }

    return this.getEmptyIndicators();
  }

  /**
   * Get empty indicators fallback
   */
  private getEmptyIndicators(): Indicators {
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

  /**
   * Validate data quality and log issues
   */
  private validateDataQuality(
    symbol: string,
    ticker: any,
    indicators: Indicators,
    candlesData: Record<string, any[]>
  ): void {
    const dataTimestamp = new Date().toISOString();

    // Build candle count object
    const candleCount: Record<string, number> = {};
    for (const timeframe of this.config.enabledTimeframes) {
      candleCount[timeframe] = candlesData[timeframe]?.length || 0;
    }

    const dataQuality = {
      price: Number.isFinite(ticker.lastPrice),
      ema20: Number.isFinite(indicators.ema20),
      macd: Number.isFinite(indicators.macd),
      rsi14: Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 0 && indicators.rsi14 <= 100,
      volume: Number.isFinite(indicators.volume) && indicators.volume >= 0,
      candleCount,
    };

    // Log data quality issues
    const issues: string[] = [];
    if (!dataQuality.price) issues.push('Invalid price');
    if (!dataQuality.ema20) issues.push('Invalid EMA20');
    if (!dataQuality.macd) issues.push('Invalid MACD');
    if (!dataQuality.rsi14) issues.push('Invalid or out-of-range RSI14');
    if (!dataQuality.volume) issues.push('Invalid volume');
    if (indicators.volume === 0) issues.push('Current volume is 0');

    if (issues.length > 0) {
      logger.warn(`${symbol} data quality issues [${dataTimestamp}]: ${issues.join(', ')}`);
      logger.debug(`${symbol} candlestick quantity:`, dataQuality.candleCount);
    } else {
      logger.debug(`${symbol} data quality check passed [${dataTimestamp}]`);
    }
  }

  /**
   * Fetch funding rate for symbol
   */
  private async fetchFundingRate(symbol: string): Promise<number> {
    try {
      const fr = await this.exchangeClient.getFundingRate(symbol);
      if (!Number.isFinite(fr.rate)) {
        return 0;
      }
      return fr.rate;
    } catch (error) {
      logger.warn(`Failed to fetch ${symbol} funding rate:`, error as any);
      return 0;
    }
  }

  /**
   * Build timeframes object with non-empty indicators
   */
  private buildTimeframesObject(indicatorsData: Record<string, Indicators>): Record<string, Indicators> {
    const timeframes: Record<string, Indicators> = {};
    for (const timeframe of this.config.enabledTimeframes) {
      if (indicatorsData[timeframe] && Object.keys(indicatorsData[timeframe]).length > 0) {
        timeframes[timeframe] = indicatorsData[timeframe];
      }
    }
    return timeframes;
  }

  /**
   * Save technical indicators to database
   */
  private async saveToDatabase(
    symbol: string,
    symbolData: SymbolMarketData,
    indicators: Indicators,
    fundingRate: number
  ): Promise<void> {
    try {
      await this.database.execute({
        sql: `INSERT INTO trading_signals
              (symbol, timestamp, price, ema_20, ema_50, macd, rsi_7, rsi_14, volume, funding_rate)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          symbol,
          getChinaTimeISO(),
          ensureFinite(symbolData.price),
          ensureFinite(indicators.ema20),
          ensureFinite(indicators.ema50),
          ensureFinite(indicators.macd),
          ensureFinite(indicators.rsi7, 50),
          ensureFinite(indicators.rsi14, 50),
          ensureFinite(indicators.volume),
          ensureFinite(fundingRate),
        ],
      });
    } catch (error) {
      logger.error(`Failed to save ${symbol} trading signals to database:`, error as any);
    }
  }
}

/**
 * Create a market data collector instance
 *
 * @param exchangeClient - Exchange client for data fetching
 * @param database - Database client for persistence
 * @param config - Market data configuration
 * @returns Market data collector instance
 */
export function createMarketDataCollector(
  exchangeClient: IExchangeClient,
  database: Client,
  config: MarketDataConfig
): MarketDataCollector {
  return new MarketDataCollector(exchangeClient, database, config);
}
