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
 * 交易循环 - 定时执行交易决策
 */
import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createTradingAgent, generateTradingPrompt, getAccountRiskConfig, getTradingStrategy, getStrategyParams } from "../agents/tradingAgent";
import { createGateClient } from "../services/gateClient";
import { getChinaTimeISO } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";
import { getQuantoMultiplier } from "../utils/contractUtils";
import {
  calculateWeightedConfluence,
  formatConfluenceResult,
  type TimeframeIndicators,
} from "../utils/confluenceScoring";
import { getIndicatorCache, type CachedIndicators } from "../utils/indicatorCache";
import {
  calculateBollingerBands,
  calculateVWAP,
  calculateOBV,
  detectDivergence,
  detectSupportResistance,
  findNearestLevels,
} from "../utils/phase2Indicators";
import {
  calculateADX,
  detectMarketRegime,
  getAdaptiveParameters,
  getAdaptiveRiskConfig,
  type RegimeClassification,
  type AdaptiveIndicatorParams,
} from "../utils/adaptiveParameters";

const logger = createPinoLogger({
  name: "trading-loop",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// 支持的币种 - 从配置中读取
const SYMBOLS = [...RISK_PARAMS.TRADING_SYMBOLS] as string[];

// 交易开始时间
let tradingStartTime = new Date();
let iterationCount = 0;

// 账户风险配置
let accountRiskConfig = getAccountRiskConfig();

/**
 * 确保数值是有效的有限数字，否则返回默认值
 */
function ensureFinite(value: number, defaultValue: number = 0): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return value;
}

/**
 * 确保数值在指定范围内
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
 * 收集所有市场数据（包含多时间框架分析和时序数据）
 * 优化：增加数据验证和错误处理，返回时序数据用于提示词
 */
async function collectMarketData() {
  const gateClient = createGateClient();
  const marketData: Record<string, any> = {};

  for (const symbol of SYMBOLS) {
    try {
      const contract = `${symbol}_USDT`;
      
      // 获取价格（带重试）
      let ticker: any = null;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        try {
          ticker = await gateClient.getFuturesTicker(contract);
          
          // Validate price data validity
          const price = Number.parseFloat(ticker.last || "0");
          if (price === 0 || !Number.isFinite(price)) {
            throw new Error(`Invalid price: ${ticker.last}`);
          }

          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            logger.error(`${symbol} price fetch failed (${maxRetries} retries):`, error as any);
            throw error;
          }
          logger.warn(`${symbol} price fetch failed, retry ${retryCount}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      // 获取所有时间框架的K线数据（并行优化：Promise.all减少83%延迟）
      const [candles1m, candles3m, candles5m, candles15m, candles30m, candles1h] = await Promise.all([
        gateClient.getFuturesCandles(contract, "1m", 150),   // 2.5小时，EMA50有充足验证数据
        gateClient.getFuturesCandles(contract, "3m", 120),   // 6小时，覆盖半个交易日
        gateClient.getFuturesCandles(contract, "5m", 100),   // 8.3小时，日内趋势分析
        gateClient.getFuturesCandles(contract, "15m", 96),   // 24小时，完整一天
        gateClient.getFuturesCandles(contract, "30m", 120),  // 2.5天，中期趋势
        gateClient.getFuturesCandles(contract, "1h", 168),   // 7天完整一周，周级别分析
      ]);
      
      // 计算每个时间框架的指标（使用缓存优化）
      const cache = getIndicatorCache();
      const indicators1m = calculateIndicatorsWithCache(symbol, "1m", candles1m, cache);
      const indicators3m = calculateIndicatorsWithCache(symbol, "3m", candles3m, cache);
      const indicators5m = calculateIndicatorsWithCache(symbol, "5m", candles5m, cache);
      const indicators15m = calculateIndicatorsWithCache(symbol, "15m", candles15m, cache);
      const indicators30m = calculateIndicatorsWithCache(symbol, "30m", candles30m, cache);
      const indicators1h = calculateIndicatorsWithCache(symbol, "1h", candles1h, cache);
      
      // 计算3分钟时序指标（使用全部60个数据计算，但只显示最近10个数据点）
      const intradaySeries = calculateIntradaySeries(candles3m);
      
      // 计算1小时指标作为更长期上下文
      const longerTermContext = calculateLongerTermContext(candles1h);
      
      // 使用5分钟K线数据作为主要指标（兼容性）
      const indicators = indicators5m;
      
      // 验证技术指标有效性和数据完整性
      const dataTimestamp = getChinaTimeISO();
      const dataQuality = {
        price: Number.isFinite(Number.parseFloat(ticker.last || "0")),
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
      if (!dataQuality.rsi14) issues.push("Invalid RSI14 or out of range");
      if (!dataQuality.volume) issues.push("Invalid volume");
      if (indicators.volume === 0) issues.push("Current volume is 0");

      if (issues.length > 0) {
        logger.warn(`${symbol} data quality issues [${dataTimestamp}]: ${issues.join(", ")}`);
        logger.debug(`${symbol} candle count:`, dataQuality.candleCount);
      } else {
        logger.debug(`${symbol} data quality check passed [${dataTimestamp}]`);
      }
      
      // 获取资金费率
      let fundingRate = 0;
      try {
        const fr = await gateClient.getFundingRate(contract);
        fundingRate = Number.parseFloat(fr.r || "0");
        if (!Number.isFinite(fundingRate)) {
          fundingRate = 0;
        }
      } catch (error) {
        logger.warn(`Failed to get ${symbol} funding rate:`, error as any);
      }

      // Get Open Interest - Gate.io ticker doesn't have openInterest field, skipping for now
      let openInterest = { latest: 0, average: 0 };
      // Note: Gate.io ticker data doesn't have open interest field, can use other APIs or external data sources if needed

      // Calculate weighted confluence score (Phase 1 optimization: quantify signal strength)
      const currentPrice = Number.parseFloat(ticker.last || "0");
      const timeframeData: TimeframeIndicators[] = [
        { interval: "1m", currentPrice, ...indicators1m },
        { interval: "3m", currentPrice, ...indicators3m },
        { interval: "5m", currentPrice, ...indicators5m },
        { interval: "15m", currentPrice, ...indicators15m },
        { interval: "30m", currentPrice, ...indicators30m },
        { interval: "1h", currentPrice, ...indicators1h },
      ];

      const confluenceResult = calculateWeightedConfluence(timeframeData);

      // Log confluence analysis results
      logger.info(`\n${symbol} Confluence Analysis:\n${formatConfluenceResult(confluenceResult)}`);

      // Phase 2: Divergence Detection (using 5m timeframe for reliability)
      const closes5m = candles5m.map((c: any) => Number.parseFloat(c.c || "0")).filter((n: number) => Number.isFinite(n));

      // Calculate MACD series for divergence detection
      const macdSeries: number[] = [];
      for (let i = 0; i < closes5m.length; i++) {
        const historicalPrices = closes5m.slice(0, i + 1);
        macdSeries.push(historicalPrices.length >= 26 ? calcMACD(historicalPrices) : 0);
      }

      // Calculate RSI14 series for divergence detection
      const rsiSeries: number[] = [];
      for (let i = 0; i < closes5m.length; i++) {
        const historicalPrices = closes5m.slice(0, i + 1);
        rsiSeries.push(historicalPrices.length >= 15 ? calcRSI(historicalPrices, 14) : 50);
      }

      // Detect MACD divergence
      const macdDivergence = detectDivergence(closes5m, macdSeries, 5, 10);

      // Detect RSI divergence
      const rsiDivergence = detectDivergence(closes5m, rsiSeries, 5, 10);

      // Phase 2: Support/Resistance Detection (using 1h timeframe for reliability)
      const srLevels = detectSupportResistance(candles1h, 100, 0.005);
      const nearestLevels = findNearestLevels(currentPrice, srLevels);

      // Log Phase 2 indicators
      if (macdDivergence.type || rsiDivergence.type) {
        logger.info(`${symbol} Divergence Signals:`);
        if (macdDivergence.type) {
          logger.info(`  MACD: ${macdDivergence.type} divergence (strength: ${macdDivergence.strength.toFixed(1)}/10)`);
        }
        if (rsiDivergence.type) {
          logger.info(`  RSI: ${rsiDivergence.type} divergence (strength: ${rsiDivergence.strength.toFixed(1)}/10)`);
        }
      }

      if (srLevels.length > 0) {
        logger.info(`${symbol} Support/Resistance Levels:`);
        const supports = srLevels.filter(l => l.type === 'support').slice(0, 3);
        const resistances = srLevels.filter(l => l.type === 'resistance').slice(0, 3);

        if (supports.length > 0) {
          logger.info(`  Support: ${supports.map(s => `${s.price.toFixed(2)} (${s.touches} touches)`).join(', ')}`);
        }
        if (resistances.length > 0) {
          logger.info(`  Resistance: ${resistances.map(r => `${r.price.toFixed(2)} (${r.touches} touches)`).join(', ')}`);
        }

        if (nearestLevels.nearestSupport || nearestLevels.nearestResistance) {
          logger.info(`  Nearest: ${nearestLevels.nearestSupport ? `Support at ${nearestLevels.nearestSupport.price.toFixed(2)} (-${nearestLevels.distanceToSupport.toFixed(2)}%)` : ''} ${nearestLevels.nearestResistance ? `Resistance at ${nearestLevels.nearestResistance.price.toFixed(2)} (+${nearestLevels.distanceToResistance.toFixed(2)}%)` : ''}`);
        }
      }

      // Phase 3A: Market Regime Detection and Adaptive Parameters
      // Extract data for regime detection
      const highs1h = candles1h.map((c: any) => Number.parseFloat(c.h || "0")).filter((n: number) => Number.isFinite(n));
      const lows1h = candles1h.map((c: any) => Number.parseFloat(c.l || "0")).filter((n: number) => Number.isFinite(n));
      const closes1h = candles1h.map((c: any) => Number.parseFloat(c.c || "0")).filter((n: number) => Number.isFinite(n));

      // Calculate ADX (using 1h timeframe for more stable regime detection)
      const adx = calculateADX(highs1h, lows1h, closes1h, 14);

      // Calculate 20-period ATR average for regime detection
      const atr20Avg = longerTermContext.atr14; // Use existing ATR14 as approximation

      // Calculate 20-period price change
      const priceChange20 = closes1h.length >= 20
        ? ((closes1h[closes1h.length - 1] - closes1h[closes1h.length - 20]) / closes1h[closes1h.length - 20]) * 100
        : 0;

      // Detect market regime
      const regimeClassification = detectMarketRegime({
        currentPrice,
        ema20: indicators.ema20,
        ema50: indicators.ema50,
        adx,
        atr: longerTermContext.atr14,
        atr20Avg,
        bbBandwidth: indicators.bbBandwidth,
        volume: indicators.volume,
        avgVolume: indicators.avgVolume,
        priceChange20,
      });

      // Get adaptive parameters for this regime
      const adaptiveParams = getAdaptiveParameters(regimeClassification);

      // Get adaptive risk configuration
      const adaptiveRisk = getAdaptiveRiskConfig(regimeClassification.regime);

      // Log regime detection results
      logger.info(`\n${symbol} Market Regime Analysis:`);
      logger.info(`  Regime: ${regimeClassification.regime} (confidence: ${(regimeClassification.confidence * 100).toFixed(1)}%)`);
      logger.info(`  Trend Strength (ADX): ${regimeClassification.trendStrength.toFixed(1)}`);
      logger.info(`  Volatility Level: ${regimeClassification.volatilityLevel} (ATR ratio: ${regimeClassification.atrRatio.toFixed(2)}x)`);
      logger.info(`  Volume Surge: ${regimeClassification.volumeSurge.toFixed(2)}x`);
      logger.info(`  Adaptive Parameters: EMA(${adaptiveParams.emaFast}/${adaptiveParams.emaSlow}), RSI(${adaptiveParams.rsiPeriod}), BB(${adaptiveParams.bbPeriod}, ${adaptiveParams.bbStdDev})`);
      logger.info(`  Risk Management: SL=${adaptiveRisk.stopLossATRMultiple}×ATR, TP=${adaptiveRisk.takeProfitATRMultiple}×ATR, Trail=${adaptiveRisk.trailingStopATRMultiple}×ATR`);

      // 将各时间框架指标添加到市场数据
      marketData[symbol] = {
        price: currentPrice,
        change24h: Number.parseFloat(ticker.change_percentage || "0"),
        volume24h: Number.parseFloat(ticker.volume_24h || "0"),
        fundingRate,
        openInterest,
        ...indicators,
        // 添加时序数据（参照 1.md 格式）
        intradaySeries,
        longerTermContext,
        // 直接添加各时间框架指标
        timeframes: {
          "1m": indicators1m,
          "3m": indicators3m,
          "5m": indicators5m,
          "15m": indicators15m,
          "30m": indicators30m,
          "1h": indicators1h,
        },
        // Phase 1优化：添加加权共振评分
        confluence: confluenceResult,
        // Phase 2: Divergence Signals
        divergence: {
          macd: {
            type: macdDivergence.type,
            strength: macdDivergence.strength,
            pricePoints: macdDivergence.pricePoints,
            indicatorPoints: macdDivergence.indicatorPoints,
          },
          rsi: {
            type: rsiDivergence.type,
            strength: rsiDivergence.strength,
            pricePoints: rsiDivergence.pricePoints,
            indicatorPoints: rsiDivergence.indicatorPoints,
          },
        },
        // Phase 2: Support/Resistance Levels
        supportResistance: {
          levels: srLevels,
          support: srLevels.filter(l => l.type === 'support'),
          resistance: srLevels.filter(l => l.type === 'resistance'),
          nearestSupport: nearestLevels.nearestSupport,
          nearestResistance: nearestLevels.nearestResistance,
          distanceToSupport: nearestLevels.distanceToSupport,
          distanceToResistance: nearestLevels.distanceToResistance,
        },
        // Phase 3A: Market Regime and Adaptive Parameters
        regime: {
          classification: regimeClassification.regime,
          confidence: regimeClassification.confidence,
          volatilityLevel: regimeClassification.volatilityLevel,
          trendStrength: regimeClassification.trendStrength,
          atrRatio: regimeClassification.atrRatio,
          volumeSurge: regimeClassification.volumeSurge,
          adx,
        },
        adaptiveParams: {
          emaFast: adaptiveParams.emaFast,
          emaSlow: adaptiveParams.emaSlow,
          macdFast: adaptiveParams.macdFast,
          macdSlow: adaptiveParams.macdSlow,
          macdSignal: adaptiveParams.macdSignal,
          rsiPeriod: adaptiveParams.rsiPeriod,
          bbPeriod: adaptiveParams.bbPeriod,
          bbStdDev: adaptiveParams.bbStdDev,
          atrPeriod: adaptiveParams.atrPeriod,
        },
        adaptiveRisk: {
          stopLossATRMultiple: adaptiveRisk.stopLossATRMultiple,
          takeProfitATRMultiple: adaptiveRisk.takeProfitATRMultiple,
          trailingStopATRMultiple: adaptiveRisk.trailingStopATRMultiple,
        },
      };
      
      // 保存技术指标到数据库（确保所有数值都是有效的）
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
          ensureFinite(indicators.rsi7, 50), // RSI 默认 50
          ensureFinite(indicators.rsi14, 50),
          ensureFinite(indicators.volume),
          ensureFinite(fundingRate),
        ],
      });
    } catch (error) {
      logger.error(`Failed to collect ${symbol} market data:`, error as any);
    }
  }

  return marketData;
}

/**
 * 计算日内时序数据（3分钟级别）
 * 参照 1.md 格式
 * @param candles 全部历史数据（至少60个数据点）
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

  // 提取收盘价
  const closes = candles.map((c) => Number.parseFloat(c.c || "0")).filter(n => Number.isFinite(n));
  
  if (closes.length === 0) {
    return {
      midPrices: [],
      ema20Series: [],
      macdSeries: [],
      rsi7Series: [],
      rsi14Series: [],
    };
  }

  // 计算每个时间点的指标
  const midPrices = closes;
  const ema20Series: number[] = [];
  const macdSeries: number[] = [];
  const rsi7Series: number[] = [];
  const rsi14Series: number[] = [];

  // 为每个数据点计算指标（使用截至该点的所有历史数据）
  for (let i = 0; i < closes.length; i++) {
    const historicalPrices = closes.slice(0, i + 1);
    
    // EMA20 - 需要至少20个数据点
    ema20Series.push(historicalPrices.length >= 20 ? calcEMA(historicalPrices, 20) : historicalPrices[historicalPrices.length - 1]);
    
    // MACD - 需要至少26个数据点
    macdSeries.push(historicalPrices.length >= 26 ? calcMACD(historicalPrices) : 0);
    
    // RSI7 - 需要至少8个数据点
    rsi7Series.push(historicalPrices.length >= 8 ? calcRSI(historicalPrices, 7) : 50);
    
    // RSI14 - 需要至少15个数据点
    rsi14Series.push(historicalPrices.length >= 15 ? calcRSI(historicalPrices, 14) : 50);
  }

  // 只返回最近10个数据点
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
 * 计算更长期的上下文数据（1小时级别 - 用于短线交易）
 * 参照 1.md 格式
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

  const closes = candles.map((c) => Number.parseFloat(c.c || "0")).filter(n => Number.isFinite(n));
  const highs = candles.map((c) => Number.parseFloat(c.h || "0")).filter(n => Number.isFinite(n));
  const lows = candles.map((c) => Number.parseFloat(c.l || "0")).filter(n => Number.isFinite(n));
  const volumes = candles.map((c) => Number.parseFloat(c.v || "0")).filter(n => Number.isFinite(n));

  // 计算 EMA
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);

  // 计算 ATR
  const atr3 = calcATR(highs, lows, closes, 3);
  const atr14 = calcATR(highs, lows, closes, 14);

  // 计算成交量
  const currentVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

  // 计算最近10个数据点的 MACD 和 RSI14
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
 * 计算 ATR (Average True Range)
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

  // 计算平均
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
  
  return Number.isFinite(atr) ? atr : 0;
}

// 计算 EMA
function calcEMA(prices: number[], period: number) {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : 0;
}

// 计算 RSI
function calcRSI(prices: number[], period: number) {
  if (prices.length < period + 1) return 50; // 数据不足，返回中性值
  
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
  
  // 确保RSI在0-100范围内
  return ensureRange(rsi, 0, 100, 50);
}

// 计算 MACD
function calcMACD(prices: number[]) {
  if (prices.length < 26) return 0; // 数据不足
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  return Number.isFinite(macd) ? macd : 0;
}

/**
 * 计算技术指标
 * 
 * K线数据格式：FuturesCandlestick 对象
 * {
 *   t: number,    // 时间戳
 *   v: number,    // 成交量
 *   c: string,    // 收盘价
 *   h: string,    // 最高价
 *   l: string,    // 最低价
 *   o: string,    // 开盘价
 *   sum: string   // 总成交额
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
      // Phase 2 indicators
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
  }

  // 处理对象格式的K线数据（Gate.io API返回的是对象，不是数组）
  const closes = candles
    .map((c) => {
      // 如果是对象格式（FuturesCandlestick）
      if (c && typeof c === 'object' && 'c' in c) {
        return Number.parseFloat(c.c);
      }
      // 如果是数组格式（兼容旧代码）
      if (Array.isArray(c)) {
        return Number.parseFloat(c[2]);
      }
      return NaN;
    })
    .filter(n => Number.isFinite(n));

  const volumes = candles
    .map((c) => {
      // 如果是对象格式（FuturesCandlestick）
      if (c && typeof c === 'object' && 'v' in c) {
        const vol = Number.parseFloat(c.v);
        // 验证成交量：必须是有限数字且非负
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      // 如果是数组格式（兼容旧代码）
      if (Array.isArray(c)) {
        const vol = Number.parseFloat(c[1]);
        return Number.isFinite(vol) && vol >= 0 ? vol : 0;
      }
      return 0;
    })
    .filter(n => n >= 0); // 过滤掉负数成交量

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
      // Phase 2 indicators
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
  }

  // Phase 1 indicators
  const currentPrice = ensureFinite(closes.at(-1) || 0);
  const ema20 = ensureFinite(calcEMA(closes, 20));
  const ema50 = ensureFinite(calcEMA(closes, 50));
  const macd = ensureFinite(calcMACD(closes));
  const rsi7 = ensureRange(calcRSI(closes, 7), 0, 100, 50);
  const rsi14 = ensureRange(calcRSI(closes, 14), 0, 100, 50);
  const volume = ensureFinite(volumes.at(-1) || 0);
  const avgVolume = ensureFinite(volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0);

  // Phase 2: Bollinger Bands
  const bb = calculateBollingerBands(closes, 20, 2);

  // Phase 2: VWAP
  const vwapResult = calculateVWAP(candles);

  // Phase 2: OBV
  const obvResult = calculateOBV(candles);

  return {
    // Phase 1
    currentPrice,
    ema20,
    ema50,
    macd,
    rsi7,
    rsi14,
    volume,
    avgVolume,
    // Phase 2
    bbUpper: ensureFinite(bb.upper),
    bbMiddle: ensureFinite(bb.middle),
    bbLower: ensureFinite(bb.lower),
    bbPercent: ensureFinite(bb.percentB),
    bbBandwidth: ensureFinite(bb.bandwidth),
    vwap: ensureFinite(vwapResult.vwap),
    vwapDeviation: ensureFinite(vwapResult.deviation),
    obv: ensureFinite(obvResult.obv),
    obvEma20: ensureFinite(obvResult.obvEma20),
  };
}

/**
 * 使用缓存计算指标（Phase 1优化：减少40%冗余计算）
 *
 * @param symbol 币种符号
 * @param timeframe 时间框架
 * @param candles K线数据
 * @param cache 缓存实例
 * @returns 技术指标
 */
function calculateIndicatorsWithCache(
  symbol: string,
  timeframe: string,
  candles: any[],
  cache: ReturnType<typeof getIndicatorCache>
) {
  // 获取最后一根K线的时间戳作为缓存键
  if (!candles || candles.length === 0) {
    return calculateIndicators(candles);
  }

  const lastCandle = candles[candles.length - 1];
  const candleTimestamp = lastCandle?.t || Date.now();

  // 尝试从缓存获取
  const cached = cache.get(symbol, timeframe, candleTimestamp);
  if (cached) {
    cache.recordHit();
    return cached;
  }

  // 缓存未命中，计算指标
  cache.recordMiss();
  const indicators = calculateIndicators(candles);

  // 保存到缓存
  cache.set(symbol, timeframe, candleTimestamp, indicators);

  return indicators;
}

/**
 * 计算 Sharpe Ratio
 * 使用最近30天的账户历史数据
 */
async function calculateSharpeRatio(): Promise<number> {
  try {
    // 尝试获取所有账户历史数据（不限制30天）
    const result = await dbClient.execute({
      sql: `SELECT total_value, timestamp FROM account_history 
            ORDER BY timestamp ASC`,
      args: [],
    });
    
    if (!result.rows || result.rows.length < 2) {
      return 0; // 数据不足，返回0
    }
    
    // 计算每次交易的收益率（而不是每日）
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
    
    // 计算平均收益率
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    // 计算收益率的标准差
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) {
      return avgReturn > 0 ? 10 : 0; // 无波动但有收益，返回高值
    }
    
    // Sharpe Ratio = (平均收益率 - 无风险利率) / 标准差
    // 假设无风险利率为0
    const sharpeRatio = avgReturn / stdDev;
    
    return Number.isFinite(sharpeRatio) ? sharpeRatio : 0;
  } catch (error) {
    logger.error("Failed to calculate Sharpe Ratio:", error as any);
    return 0;
  }
}

/**
 * 获取账户信息
 * 
 * Gate.io 的 account.total 不包含未实现盈亏
 * 总资产（不含未实现盈亏）= account.total = available + positionMargin
 * 
 * 因此：
 * - totalBalance 不包含未实现盈亏
 * - returnPercent 反映已实现盈亏
 * - 前端显示时需加上 unrealisedPnl
 */
async function getAccountInfo() {
  const gateClient = createGateClient();
  
  try {
    const account = await gateClient.getFuturesAccount();
    
    // 从数据库获取初始资金
    const initialResult = await dbClient.execute(
      "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
    );
    const initialBalance = initialResult.rows[0]
      ? Number.parseFloat(initialResult.rows[0].total_value as string)
      : 100;
    
    // 从数据库获取峰值净值
    const peakResult = await dbClient.execute(
      "SELECT MAX(total_value) as peak FROM account_history"
    );
    const peakBalance = peakResult.rows[0]?.peak 
      ? Number.parseFloat(peakResult.rows[0].peak as string)
      : initialBalance;
    
    // 从 Gate.io API 返回的数据中提取字段
    const accountTotal = Number.parseFloat(account.total || "0");
    const availableBalance = Number.parseFloat(account.available || "0");
    const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    
    // Gate.io 的 account.total 不包含未实现盈亏
    // totalBalance 直接使用 account.total（不包含未实现盈亏）
    const totalBalance = accountTotal;
    
    // 实时收益率 = (总资产 - 初始资金) / 初始资金 * 100
    // 总资产不包含未实现盈亏，收益率反映已实现盈亏
    const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
    
    // 计算 Sharpe Ratio
    const sharpeRatio = await calculateSharpeRatio();
    
    return {
      totalBalance,      // 总资产（不包含未实现盈亏）
      availableBalance,  // 可用余额
      unrealisedPnl,     // 未实现盈亏
      returnPercent,     // 收益率（不包含未实现盈亏）
      sharpeRatio,       // 夏普比率
      initialBalance,    // 初始净值（用于计算回撤）
      peakBalance,       // 峰值净值（用于计算回撤）
    };
  } catch (error) {
    logger.error("Failed to get account info:", error as any);
    return {
      totalBalance: 0,
      availableBalance: 0,
      unrealisedPnl: 0,
      returnPercent: 0,
      sharpeRatio: 0,
      initialBalance: 0,
      peakBalance: 0,
    };
  }
}

/**
 * 从 Gate.io 同步持仓到数据库
 * 优化：确保持仓数据的准确性和完整性
 * 数据库中的持仓记录主要用于：
 * 1. 保存止损止盈订单ID等元数据
 * 2. 提供历史查询和监控页面展示
 * 实时持仓数据应该直接从 Gate.io 获取
 */
async function syncPositionsFromGate(cachedPositions?: any[]) {
  const gateClient = createGateClient();
  
  try {
    // 如果提供了缓存数据，使用缓存；否则重新获取
    const gatePositions = cachedPositions || await gateClient.getPositions();
    const dbResult = await dbClient.execute("SELECT symbol, sl_order_id, tp_order_id, stop_loss, profit_target, entry_order_id, opened_at, peak_pnl_percent, partial_close_percentage FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );
    
    // 检查 Gate.io 是否有持仓（可能 API 有延迟）
    const activeGatePositions = gatePositions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
    
    // If Gate.io returns 0 positions but database has positions, might be API delay, don't clear database
    if (activeGatePositions.length === 0 && dbResult.rows.length > 0) {
      logger.warn(`Gate.io returned 0 positions, but database has ${dbResult.rows.length} positions, might be API delay, skip sync`);
      return;
    }
    
    await dbClient.execute("DELETE FROM positions");
    
    let syncedCount = 0;
    
    for (const pos of gatePositions) {
      const size = Number.parseInt(pos.size || "0");
      if (size === 0) continue;
      
      const symbol = pos.contract.replace("_USDT", "");
      let entryPrice = Number.parseFloat(pos.entryPrice || "0");
      let currentPrice = Number.parseFloat(pos.markPrice || "0");
      const leverage = Number.parseInt(pos.leverage || "1");
      const side = size > 0 ? "long" : "short";
      const quantity = Math.abs(size);
      const unrealizedPnl = Number.parseFloat(pos.unrealisedPnl || "0");
      let liquidationPrice = Number.parseFloat(pos.liqPrice || "0");
      
      if (entryPrice === 0 || currentPrice === 0) {
        try {
          const ticker = await gateClient.getFuturesTicker(pos.contract);
          if (currentPrice === 0) {
            currentPrice = Number.parseFloat(ticker.markPrice || ticker.last || "0");
          }
          if (entryPrice === 0) {
            entryPrice = currentPrice;
          }
        } catch (error) {
          logger.error(`Failed to get ${symbol} ticker:`, error as any);
        }
      }

      if (liquidationPrice === 0 && entryPrice > 0) {
        liquidationPrice = side === "long"
          ? entryPrice * (1 - 0.9 / leverage)
          : entryPrice * (1 + 0.9 / leverage);
      }

      const dbPos = dbPositionsMap.get(symbol);

      // Keep original entry_order_id, don't overwrite
      const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;
      
      await dbClient.execute({
        sql: `INSERT INTO positions 
              (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
               leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, entry_order_id, opened_at, peak_pnl_percent, partial_close_percentage)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          entryOrderId, // 保留原有的订单ID
          dbPos?.opened_at || getChinaTimeISO(), // 保留原有的开仓时间
          dbPos?.peak_pnl_percent || 0, // 保留峰值盈利
          dbPos?.partial_close_percentage || 0, // 保留已平仓百分比（关键修复）
        ],
      });
      
      syncedCount++;
    }
    
    const activeGatePositionsCount = gatePositions.filter((p: any) => Number.parseInt(p.size || "0") !== 0).length;
    if (activeGatePositionsCount > 0 && syncedCount === 0) {
      logger.error(`Gate.io has ${activeGatePositionsCount} positions, but database sync failed!`);
    }

  } catch (error) {
    logger.error("Failed to sync positions:", error as any);
  }
}

/**
 * 获取持仓信息 - 直接从 Gate.io 获取最新数据
 * @param cachedGatePositions 可选，已获取的原始Gate持仓数据，避免重复调用API
 * @returns 格式化后的持仓数据
 */
async function getPositions(cachedGatePositions?: any[]) {
  const gateClient = createGateClient();
  
  try {
    // 如果提供了缓存数据，使用缓存；否则重新获取
    const gatePositions = cachedGatePositions || await gateClient.getPositions();
    
    // 从数据库获取持仓的开仓时间（数据库中保存了正确的开仓时间）
    const dbResult = await dbClient.execute("SELECT symbol, opened_at FROM positions");
      const dbOpenedAtMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row.opened_at])
    );
    
    // 过滤并格式化持仓
    const positions = gatePositions
      .filter((p: any) => Number.parseInt(p.size || "0") !== 0)
      .map((p: any) => {
        const size = Number.parseInt(p.size || "0");
        const symbol = p.contract.replace("_USDT", "");
        
        // 优先从数据库读取开仓时间，确保时间准确
        let openedAt = dbOpenedAtMap.get(symbol);
        
        // 如果数据库中没有，尝试从Gate.io的create_time获取
        if (!openedAt && p.create_time) {
          // Gate.io的create_time是UNIX时间戳（秒），需要转换为ISO字符串
          if (typeof p.create_time === 'number') {
            openedAt = new Date(p.create_time * 1000).toISOString();
          } else {
            openedAt = p.create_time;
          }
        }
        
        // If still no time, use current time (this should not happen)
        if (!openedAt) {
          openedAt = getChinaTimeISO();
          logger.warn(`${symbol} position opened time missing, using current time`);
        }
        
        return {
          symbol,
          contract: p.contract,
          quantity: Math.abs(size),
          side: size > 0 ? "long" : "short",
          entry_price: Number.parseFloat(p.entryPrice || "0"),
          current_price: Number.parseFloat(p.markPrice || "0"),
          liquidation_price: Number.parseFloat(p.liqPrice || "0"),
          unrealized_pnl: Number.parseFloat(p.unrealisedPnl || "0"),
          leverage: Number.parseInt(p.leverage || "1"),
          margin: Number.parseFloat(p.margin || "0"),
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
 * 获取历史成交记录（最近10条）
 * 从数据库获取历史交易记录（监控页的交易历史）
 */
async function getTradeHistory(limit: number = 10) {
  try {
    // 从数据库获取历史交易记录
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`,
      args: [limit],
    });
    
    if (!result.rows || result.rows.length === 0) {
      return [];
    }
    
    // 转换数据库格式到提示词需要的格式
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
    
    // 按时间正序排列（最旧 → 最新）
    trades.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    return trades;
  } catch (error) {
    logger.error("Failed to get trade history:", error as any);
    return [];
  }
}

/**
 * 获取最近N次的AI决策记录
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
    
    // 返回格式化的决策记录（从旧到新）
    return result.rows.reverse().map((row: any) => ({
      timestamp: row.timestamp,
      iteration: row.iteration,
      decision: row.decision,
      account_value: Number.parseFloat(row.account_value || "0"),
      positions_count: Number.parseInt(row.positions_count || "0"),
    }));
  } catch (error) {
    logger.error("Failed to get recent decisions:", error as any);
    return [];
  }
}

/**
 * 同步风险配置到数据库
 */
async function syncConfigToDatabase() {
  try {
    const config = getAccountRiskConfig();
    const timestamp = getChinaTimeISO();
    
    // 更新或插入配置
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_stop_loss_usdt', config.stopLossUsdt.toString(), timestamp],
    });
    
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_take_profit_usdt', config.takeProfitUsdt.toString(), timestamp],
    });
    
    logger.info(`Config synced to database: stop-loss=${config.stopLossUsdt} USDT, take-profit=${config.takeProfitUsdt} USDT`);
  } catch (error) {
    logger.error("Failed to sync config to database:", error as any);
  }
}

/**
 * 从数据库加载风险配置
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
      
      logger.info(`Config loaded from database: stop-loss=${accountRiskConfig.stopLossUsdt} USDT, take-profit=${accountRiskConfig.takeProfitUsdt} USDT`);
    }
  } catch (error) {
    logger.warn("Failed to load config from database, using environment variables:", error as any);
  }
}

/**
 * 修复历史盈亏记录
 * 每个周期结束时自动调用，确保所有交易记录的盈亏计算正确
 */
async function fixHistoricalPnlRecords() {
  try {
    // 查询所有平仓记录
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

      // 查找对应的开仓记录
      const openResult = await dbClient.execute({
        sql: `SELECT * FROM trades WHERE symbol = ? AND type = 'open' AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
        args: [symbol, timestamp],
      });

      if (!openResult.rows || openResult.rows.length === 0) {
        continue;
      }

      const openTrade = openResult.rows[0];
      const openPrice = Number.parseFloat(openTrade.price as string);

      // 获取合约乘数
      const contract = `${symbol}_USDT`;
      const quantoMultiplier = await getQuantoMultiplier(contract);

      // 重新计算正确的盈亏
      const priceChange = side === "long" 
        ? (closePrice - openPrice) 
        : (openPrice - closePrice);
      
      const grossPnl = priceChange * quantity * quantoMultiplier;
      const openFee = openPrice * quantity * quantoMultiplier * 0.0005;
      const closeFee = closePrice * quantity * quantoMultiplier * 0.0005;
      const totalFee = openFee + closeFee;
      const correctPnl = grossPnl - totalFee;

      // 计算差异
      const pnlDiff = Math.abs(recordedPnl - correctPnl);
      const feeDiff = Math.abs(recordedFee - totalFee);

      // If difference exceeds 0.5 USDT, needs fixing
      if (pnlDiff > 0.5 || feeDiff > 0.1) {
        logger.warn(`Fix trade record ID=${id} (${symbol} ${side})`);
        logger.warn(`  P&L: ${recordedPnl.toFixed(2)} → ${correctPnl.toFixed(2)} USDT (diff: ${pnlDiff.toFixed(2)})`);

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
 * 清仓所有持仓
 */
async function closeAllPositions(reason: string): Promise<void> {
  const gateClient = createGateClient();

  try {
    logger.warn(`Closing all positions, reason: ${reason}`);

    const positions = await gateClient.getPositions();
    const activePositions = positions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);

    if (activePositions.length === 0) {
      return;
    }

    for (const pos of activePositions) {
      const size = Number.parseInt(pos.size || "0");
      const contract = pos.contract;
      const symbol = contract.replace("_USDT", "");

      try {
        await gateClient.placeOrder({
          contract,
          size: -size,
          price: 0, // Market order must pass price: 0
          reduceOnly: true, // Only reduce position, don't open new
        });

        logger.info(`Closed: ${symbol} ${Math.abs(size)} contracts`);
      } catch (error) {
        logger.error(`Failed to close: ${symbol}`, error as any);
      }
    }

    logger.warn(`Close all completed`);
  } catch (error) {
    logger.error("Failed to close all positions:", error as any);
    throw error;
  }
}

/**
 * 检查账户余额是否触发止损或止盈
 * @returns true: 触发退出条件, false: 继续运行
 */
async function checkAccountThresholds(accountInfo: any): Promise<boolean> {
  const totalBalance = accountInfo.totalBalance;

  // Check stop-loss line
  if (totalBalance <= accountRiskConfig.stopLossUsdt) {
    logger.error(`Stop-loss triggered! Balance: ${totalBalance.toFixed(2)} USDT <= ${accountRiskConfig.stopLossUsdt} USDT`);
    await closeAllPositions(`Account balance triggered stop-loss (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  // Check take-profit line
  if (totalBalance >= accountRiskConfig.takeProfitUsdt) {
    logger.warn(`Take-profit triggered! Balance: ${totalBalance.toFixed(2)} USDT >= ${accountRiskConfig.takeProfitUsdt} USDT`);
    await closeAllPositions(`Account balance triggered take-profit (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  return false;
}

/**
 * 执行交易决策
 * 优化：增强错误处理和数据验证，确保数据实时准确
 */
async function executeTradingDecision() {
  iterationCount++;
  const minutesElapsed = Math.floor((Date.now() - tradingStartTime.getTime()) / 60000);
  const intervalMinutes = Number.parseInt(process.env.TRADING_INTERVAL_MINUTES || "5");
  
  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`Trading Cycle #${iterationCount} (running for ${minutesElapsed} minutes)`);
  logger.info(`${"=".repeat(80)}\n`);

  let marketData: any = {};
  let accountInfo: any = null;
  let positions: any[] = [];

  try {
    // 1. 收集市场数据
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
        logger.error("Failed to get market data, skip this cycle");
        return;
      }
    } catch (error) {
      logger.error("Failed to collect market data:", error as any);
      return;
    }

    // 1.5. Phase 3B: Get ML predictions for each symbol
    try {
      const { getMlPrediction } = await import("../ml/mlClient");
      const { extractFeatures } = await import("../ml/featureExtraction");
      const { collectTrainingSample } = await import("../ml/dataCollector");
      type MarketDataForML = import("../ml/featureExtraction").MarketDataForML;

      for (const symbol of SYMBOLS) {
        const data = marketData[symbol];
        if (!data || !data.price) continue;

        try {
          // Prepare market data for feature extraction
          const mlMarketData: MarketDataForML = {
            currentPrice: data.price,
            price1m: data.timeframes?.["1m"]?.closes || [],
            price3m: data.timeframes?.["3m"]?.closes || [],
            price5m: data.timeframes?.["5m"]?.closes || [],
            price15m: data.timeframes?.["15m"]?.closes || [],
            price30m: data.timeframes?.["30m"]?.closes || [],
            ema20: data.ema20,
            ema50: data.ema50,
            macd: data.macd,
            macdSignal: data.macdSignal,
            macdHistogram: data.macdHistogram,
            rsi7: data.rsi7,
            rsi14: data.rsi14,
            volume: data.volume,
            volumeSma20: data.volumeSma20 || data.volume,
            volumeRatio: data.volumeRatio || 1.0,
            atr14: data.longerTermContext?.atr14 || 0,
            bbUpper: data.bbUpper || 0,
            bbMiddle: data.bbMiddle || 0,
            bbLower: data.bbLower || 0,
            bbBandwidth: data.bbBandwidth || 0,
            vwap: data.vwap || data.price,
            obv: data.obv || 0,
            obvEma20: data.obvEma20 || 0,
            srsiK: data.srsiK || 50,
            srsiD: data.srsiD || 50,
            kcUpper: data.kcUpper || 0,
            kcLower: data.kcLower || 0,
            support: data.supportResistance?.nearestSupport?.price || 0,
            resistance: data.supportResistance?.nearestResistance?.price || 0,
            regime: data.regime,
          };

          // Extract features
          const features = extractFeatures(mlMarketData);

          // Get ML prediction
          const mlPrediction = await getMlPrediction(features, symbol);

          if (mlPrediction) {
            // Add ML prediction to market data
            marketData[symbol].mlPrediction = {
              signal: mlPrediction.prediction === 0 ? "HOLD" : mlPrediction.prediction === 1 ? "BUY" : "SELL",
              confidence: mlPrediction.confidence,
              probabilities: mlPrediction.probabilities,
              modelVersion: mlPrediction.modelVersion,
            };

            logger.info(`[ML] ${symbol}: ${marketData[symbol].mlPrediction.signal} (confidence: ${(mlPrediction.confidence * 100).toFixed(1)}%)`);
          } else {
            // ML service not available - continue without ML
            marketData[symbol].mlPrediction = null;
          }

          // Collect training sample (will be labeled later based on outcome)
          if (process.env.ML_COLLECT_TRAINING_DATA === "true") {
            await collectTrainingSample(symbol, mlMarketData);
          }

        } catch (error) {
          logger.debug(`ML prediction failed for ${symbol}:`, error as any);
          marketData[symbol].mlPrediction = null;
        }
      }
    } catch (error) {
      logger.debug("ML predictions unavailable:", error as any);
      // Continue without ML predictions
    }

    // 2. Get account information
    try {
      accountInfo = await getAccountInfo();

      if (!accountInfo || accountInfo.totalBalance === 0) {
        logger.error("Abnormal account data, skip this cycle");
        return;
      }

      // Check if account balance triggers stop-loss or take-profit
      const shouldExit = await checkAccountThresholds(accountInfo);
      if (shouldExit) {
        logger.error("Account balance triggered exit condition, system will stop!");
        setTimeout(() => {
          process.exit(0);
        }, 5000);
        return;
      }

    } catch (error) {
      logger.error("Failed to get account info:", error as any);
      return;
    }
    
    // 3. 同步持仓信息（优化：只调用一次API，避免重复）
    try {
      const gateClient = createGateClient();
      const rawGatePositions = await gateClient.getPositions();
      
      // 使用同一份数据进行处理和同步，避免重复调用API
      positions = await getPositions(rawGatePositions);
      await syncPositionsFromGate(rawGatePositions);
      
      const dbPositions = await dbClient.execute("SELECT COUNT(*) as count FROM positions");
      const dbCount = (dbPositions.rows[0] as any).count;
      
      if (positions.length !== dbCount) {
        logger.warn(`Position sync inconsistent: Gate=${positions.length}, DB=${dbCount}`);
        // Sync again using the same data
        await syncPositionsFromGate(rawGatePositions);
      }
    } catch (error) {
      logger.error("Failed to sync positions:", error as any);
    }
    
    // 4. ====== 强制风控检查（在AI执行前） ======
    const gateClient = createGateClient();
    
    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side;
      const leverage = pos.leverage;
      const entryPrice = pos.entry_price;
      const currentPrice = pos.current_price;
      
      // 计算盈亏百分比（考虑杠杆）
      const priceChangePercent = entryPrice > 0 
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;
      
      // 获取并更新峰值盈利
      let peakPnlPercent = 0;
      try {
        const dbPosResult = await dbClient.execute({
          sql: "SELECT peak_pnl_percent FROM positions WHERE symbol = ?",
          args: [symbol],
        });
        
        if (dbPosResult.rows.length > 0) {
          peakPnlPercent = Number.parseFloat(dbPosResult.rows[0].peak_pnl_percent as string || "0");
          
          // 如果当前盈亏超过历史峰值，更新峰值
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

      // a) Maximum holding time forced closure check (from environment variables)
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingHours = (now.getTime() - openedTime.getTime()) / (1000 * 60 * 60);
      const MAX_HOLDING_HOURS = RISK_PARAMS.MAX_HOLDING_HOURS;

      if (holdingHours >= MAX_HOLDING_HOURS) {
        shouldClose = true;
        closeReason = `Holding time reached ${holdingHours.toFixed(1)} hours, exceeds ${MAX_HOLDING_HOURS} hour limit`;
      }

      // b) Extreme stop-loss protection (prevent liquidation, last safety net)
      // Only force close in extreme situations to avoid account liquidation
      // Regular stop-loss is decided by AI, this is just the last safety net
      const EXTREME_STOP_LOSS = RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT; // From environment variables

      logger.info(`${symbol} extreme stop-loss check: current P&L=${pnlPercent.toFixed(2)}%, extreme stop-loss line=${EXTREME_STOP_LOSS}%`);

      if (pnlPercent <= EXTREME_STOP_LOSS) {
        shouldClose = true;
        closeReason = `Extreme stop-loss protection triggered (${pnlPercent.toFixed(2)}% ≤ ${EXTREME_STOP_LOSS}%, prevent liquidation)`;
        logger.error(`${closeReason}`);
      }
      
      // c) 超短线策略专属风控规则
      const strategy = getTradingStrategy();
      if (strategy === 'ultra-short' && !shouldClose) {
        const holdingMinutes = holdingHours * 60;
        
        // 计算手续费成本（开仓 + 平仓，总共约 0.1%）
        // 考虑杠杆后，需要的盈利百分比 = 0.1% * 杠杆
        const feeThreshold = 0.1 * leverage;
        
        // 移动止盈的第一档触发阈值
        const params = getStrategyParams(strategy);
        const trailingStopTrigger = params.trailingStop.level1.trigger; // 4%
        
        // Rule 1: Per-cycle 2% profit lock rule (highest priority)
        // Within each trading cycle, if profit >2% but hasn't triggered trailing stop (<4%), immediately close to lock profit
        if (pnlPercent > 2 && pnlPercent < trailingStopTrigger) {
          shouldClose = true;
          closeReason = `Ultra-short strategy cycle profit lock rule: profit ${pnlPercent.toFixed(2)}% >2%, hasn't reached trailing stop trigger line ${trailingStopTrigger}%, immediately close to lock profit`;
          logger.info(`[Ultra-Short Cycle Lock]${symbol} ${closeReason}`);
        }

        // Rule 2: 30-minute profit close rule (fallback rule)
        // If holding exceeds 30 minutes, in profit state, but hasn't triggered trailing stop, and covered trading fees, close position
        if (!shouldClose && holdingMinutes >= 30 && pnlPercent > feeThreshold && pnlPercent < trailingStopTrigger) {
          shouldClose = true;
          closeReason = `Ultra-short strategy 30-minute profit close rule: holding ${holdingMinutes.toFixed(1)} minutes, profit ${pnlPercent.toFixed(2)}% (covered fees ${feeThreshold.toFixed(2)}%), but hasn't reached trailing stop trigger line ${trailingStopTrigger}%, execute conservative close`;
          logger.info(`[Ultra-Short 30-Min Rule]${symbol} ${closeReason}`);
        }
      }

      // d) Other risk control checks removed, delegated to AI for full decision-making
      // AI responsible for: stop-loss, trailing stop, partial take-profit, time-based profit taking, peak drawdown and other strategic decisions
      // System only retains bottom line safety protection (extreme stop-loss, maximum holding time forced close, account drawdown protection)

      logger.info(`${symbol} position monitor: P&L=${pnlPercent.toFixed(2)}%, holding time=${holdingHours.toFixed(1)}h, peak profit=${peakPnlPercent.toFixed(2)}%, leverage=${leverage}x`);

      // Execute forced close
      if (shouldClose) {
        logger.warn(`[FORCED CLOSE]${symbol} ${side} - ${closeReason}`);
        try {
          const contract = `${symbol}_USDT`;
          const size = side === 'long' ? -pos.quantity : pos.quantity;
          
          // 1. 执行平仓订单
          const order = await gateClient.placeOrder({
            contract,
            size,
            price: 0,
            reduceOnly: true,
          });
          
          logger.info(`Forced close order placed for ${symbol}, order ID: ${order.id}`);

          // 2. Wait for order completion and get fill info (max 5 retries)
          let actualExitPrice = 0;
          let actualQuantity = Math.abs(pos.quantity);
          let pnl = 0;
          let totalFee = 0;
          let orderFilled = false;

          for (let retry = 0; retry < 5; retry++) {
            await new Promise(resolve => setTimeout(resolve, 500));

            try {
              const orderStatus = await gateClient.getOrder(order.id?.toString() || "");

              if (orderStatus.status === 'finished') {
                actualExitPrice = Number.parseFloat(orderStatus.fill_price || orderStatus.price || "0");
                actualQuantity = Math.abs(Number.parseFloat(orderStatus.size || "0"));
                orderFilled = true;

                // Get contract multiplier
                const quantoMultiplier = await getQuantoMultiplier(contract);

                // Calculate P&L
                const entryPrice = pos.entry_price;
                const priceChange = side === "long"
                  ? (actualExitPrice - entryPrice)
                  : (entryPrice - actualExitPrice);

                const grossPnl = priceChange * actualQuantity * quantoMultiplier;

                // Calculate fees (open + close)
                const openFee = entryPrice * actualQuantity * quantoMultiplier * 0.0005;
                const closeFee = actualExitPrice * actualQuantity * quantoMultiplier * 0.0005;
                totalFee = openFee + closeFee;

                // Net P&L
                pnl = grossPnl - totalFee;

                logger.info(`Close filled: price=${actualExitPrice}, quantity=${actualQuantity}, P&L=${pnl.toFixed(2)} USDT`);
                break;
              }
            } catch (statusError: any) {
              logger.warn(`Failed to query order status (retry ${retry + 1}/5): ${statusError.message}`);
            }
          }
          
          // 3. 记录到trades表（无论是否成功获取详细信息都要记录）
          try {
            // 关键验证：检查盈亏计算是否正确
            const finalPrice = actualExitPrice || pos.current_price;
            const quantoMultiplier = await getQuantoMultiplier(contract);
            const notionalValue = finalPrice * actualQuantity * quantoMultiplier;
            const priceChangeCheck = side === "long" 
              ? (finalPrice - pos.entry_price) 
              : (pos.entry_price - finalPrice);
            const expectedPnl = priceChangeCheck * actualQuantity * quantoMultiplier - totalFee;
            
            // Detect if P&L was incorrectly set to notional value
            if (Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
              logger.error(`[FORCED CLOSE] Detected P&L calculation anomaly!`);
              logger.error(`  Current pnl: ${pnl.toFixed(2)} USDT close to notional value ${notionalValue.toFixed(2)} USDT`);
              logger.error(`  Expected pnl: ${expectedPnl.toFixed(2)} USDT`);
              logger.error(`  Entry price: ${pos.entry_price}, Close price: ${finalPrice}, Quantity: ${actualQuantity}, Contract multiplier: ${quantoMultiplier}`);

              // Force correct to right value
              pnl = expectedPnl;
              logger.warn(`  Auto-corrected pnl to: ${pnl.toFixed(2)} USDT`);
            }

            // Detailed logs
            logger.info(`[FORCED CLOSE P&L DETAILS]${symbol} ${side}`);
            logger.info(`  Reason: ${closeReason}`);
            logger.info(`  Entry price: ${pos.entry_price.toFixed(4)}, Close price: ${finalPrice.toFixed(4)}, Quantity: ${actualQuantity} contracts`);
            logger.info(`  Net P&L: ${pnl.toFixed(2)} USDT, Fees: ${totalFee.toFixed(4)} USDT`);
            
            await dbClient.execute({
              sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                order.id?.toString() || "",
                symbol,
                side,
                "close",
                finalPrice, // 使用验证后的价格
                actualQuantity,
                pos.leverage || 1,
                pnl, // 已验证和修正的盈亏
                totalFee,
                getChinaTimeISO(),
                orderFilled ? "filled" : "pending",
              ],
            });
            logger.info(`Recorded forced close trade to database: ${symbol}, P&L=${pnl.toFixed(2)} USDT, reason=${closeReason}`);
          } catch (dbError: any) {
            logger.error(`Failed to record forced close trade: ${dbError.message}`);
            // Even if database write fails, log it for later remediation
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

          logger.info(`Forced close completed ${symbol}, reason: ${closeReason}`);

        } catch (closeError: any) {
          logger.error(`Forced close failed ${symbol}: ${closeError.message}`);
          // Log even if failed
          logger.error(`Forced close failure details: symbol=${symbol}, side=${side}, quantity=${pos.quantity}, reason=${closeReason}`);
        }
      }
    }

    // Re-fetch positions (might have been force closed)
    positions = await getPositions();
    
    // 4. 不再保存账户历史（已移除资金曲线模块）
    // try {
    //   await saveAccountHistory(accountInfo);
    // } catch (error) {
    //   logger.error("保存账户历史失败:", error as any);
    //   // 不影响主流程
    // }
    
    // 5. Final data integrity check
    const dataValid =
      marketData && Object.keys(marketData).length > 0 &&
      accountInfo && accountInfo.totalBalance > 0 &&
      Array.isArray(positions);

    if (!dataValid) {
      logger.error("Data integrity check failed, skip this cycle");
      logger.error(`Market data: ${Object.keys(marketData).length}, Account: ${accountInfo?.totalBalance}, Positions: ${positions.length}`);
      return;
    }

    // 6. Fix historical P&L records
    try {
      await fixHistoricalPnlRecords();
    } catch (error) {
      logger.warn("Failed to fix historical P&L records:", error as any);
      // Don't affect main flow, continue execution
    }

    // 7. Get trade history (last 10)
    let tradeHistory: any[] = [];
    try {
      tradeHistory = await getTradeHistory(10);
    } catch (error) {
      logger.warn("Failed to get trade history:", error as any);
      // Don't affect main flow, continue execution
    }

    // 8. Get previous AI decision
    let recentDecisions: any[] = [];
    try {
      recentDecisions = await getRecentDecisions(1);
    } catch (error) {
      logger.warn("Failed to get recent decisions:", error as any);
      // Don't affect main flow, continue execution
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

    // Output complete prompt to logs
    logger.info("[INPUT - AI Prompt]");
    logger.info("=".repeat(80));
    logger.info(prompt);
    logger.info("=".repeat(80) + "\n");
    
    const agent = createTradingAgent(intervalMinutes);
    
    try {
      // 设置足够大的 maxOutputTokens 以避免输出被截断
      // DeepSeek API 限制: max_tokens 范围为 [1, 8192]
      const response = await agent.generateText(prompt, {
        maxOutputTokens: 8192,
        maxSteps: 20,
        temperature: 0.4,
      });
      
      // 从响应中提取AI的完整回复，不进行任何切分
      let decisionText = "";
      
      // 添加调试日志，查看响应的原始结构
      logger.debug(`响应类型: ${typeof response}`);
      if (response && typeof response === 'object') {
        logger.debug(`响应结构: ${JSON.stringify(Object.keys(response))}`);
        const steps = (response as any).steps || [];
        logger.debug(`步骤数量: ${steps.length}`);
      }
      
      if (typeof response === 'string') {
        decisionText = response;
        logger.debug(`字符串响应长度: ${decisionText.length}`);
      } else if (response && typeof response === 'object') {
        const steps = (response as any).steps || [];
        
        // 收集所有AI的文本回复（完整保存，不切分）
        const allTexts: string[] = [];
        
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          logger.debug(`处理步骤 ${i + 1}/${steps.length}`);
          
          let stepText = "";
          
          // 优先从 step.content 中提取文本
          if (step.content && Array.isArray(step.content)) {
            logger.debug(`  内容项数量: ${step.content.length}`);
            const textItems: string[] = [];
            for (const item of step.content) {
              if (item.type === 'text' && item.text) {
                const textLength = item.text.length;
                logger.debug(`  提取文本内容，长度: ${textLength}`);
                textItems.push(item.text.trim());
              }
            }
            if (textItems.length > 0) {
              stepText = textItems.join('\n\n');
            }
          }
          
          // 如果 step.content 中没有内容，才检查 step.text
          if (!stepText && step.text && typeof step.text === 'string') {
            logger.debug(`  从 step.text 提取内容，长度: ${step.text.length}`);
            stepText = step.text.trim();
          }
          
          // 只添加非空文本，避免重复
          if (stepText) {
            allTexts.push(stepText);
          }
        }
        
        // 完整合并所有文本，用双换行分隔
        if (allTexts.length > 0) {
          decisionText = allTexts.join('\n\n');
          logger.debug(`合并后文本总长度: ${decisionText.length}`);
        }
        
        // If no text message found, try other fields
        if (!decisionText) {
          decisionText = (response as any).text || (response as any).message || (response as any).content || "";
          logger.debug(`Extract from fallback field, length: ${decisionText.length}`);
        }

        // If still no text response, means AI only called tools without making a decision
        if (!decisionText && steps.length > 0) {
          decisionText = "AI called tools but produced no decision result";
          logger.warn("No text content found in AI response");
        }
      }

      logger.info("[OUTPUT - AI Decision]");
      logger.info("=".repeat(80));
      logger.info(decisionText || "No decision output");
      logger.info("=".repeat(80) + "\n");
      
      // 保存决策记录
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions 
              (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          getChinaTimeISO(),
          iterationCount,
          JSON.stringify(marketData),
          decisionText,
          "[]",
          accountInfo.totalBalance,
          positions.length,
        ],
      });
      
      // Agent 执行后重新同步持仓数据（优化：只调用一次API）
      const updatedRawPositions = await gateClient.getPositions();
      await syncPositionsFromGate(updatedRawPositions);
      const updatedPositions = await getPositions(updatedRawPositions);
      
      // 重新获取更新后的账户信息，包含最新的未实现盈亏
      const updatedAccountInfo = await getAccountInfo();
      const finalUnrealizedPnL = updatedPositions.reduce((sum: number, pos: any) => sum + (pos.unrealized_pnl || 0), 0);
      
      logger.info("[FINAL - Position Status]");
      logger.info("=".repeat(80));
      logger.info(`Account: ${updatedAccountInfo.totalBalance.toFixed(2)} USDT (Available: ${updatedAccountInfo.availableBalance.toFixed(2)}, Return: ${updatedAccountInfo.returnPercent.toFixed(2)}%)`);

      if (updatedPositions.length === 0) {
        logger.info("Positions: None");
      } else {
        logger.info(`Positions: ${updatedPositions.length}`);
        updatedPositions.forEach((pos: any) => {
          // Calculate P&L percentage: considering leverage multiplier
          // For leveraged trading: P&L percentage = (price change percentage) × leverage multiplier
          const priceChangePercent = pos.entry_price > 0
            ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
            : 0;
          const pnlPercent = priceChangePercent * pos.leverage;
          logger.info(`  ${pos.symbol} ${pos.side === 'long' ? 'LONG' : 'SHORT'} ${pos.quantity} contracts (Entry: ${pos.entry_price.toFixed(2)}, Current: ${pos.current_price.toFixed(2)}, P&L: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT / ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
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

    // Auto-fix historical P&L records at end of each cycle
    try {
      logger.info("Checking and fixing historical P&L records...");
      await fixHistoricalPnlRecords();
    } catch (fixError) {
      logger.error("Failed to fix historical P&L:", fixError as any);
      // Don't affect main flow, continue execution
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
 * 初始化交易系统配置
 */
export async function initTradingSystem() {
  logger.info("Initializing trading system configuration...");

  // 1. Load configuration
  accountRiskConfig = getAccountRiskConfig();
  logger.info(`Environment variable config: stop-loss=${accountRiskConfig.stopLossUsdt} USDT, take-profit=${accountRiskConfig.takeProfitUsdt} USDT`);

  // 2. If sync on startup enabled, sync config to database
  if (accountRiskConfig.syncOnStartup) {
    await syncConfigToDatabase();
  } else {
    // Otherwise load config from database
    await loadConfigFromDatabase();
  }

  logger.info(`Final config: stop-loss=${accountRiskConfig.stopLossUsdt} USDT, take-profit=${accountRiskConfig.takeProfitUsdt} USDT`);
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

  // Execute immediately once
  executeTradingDecision();

  // Set scheduled task
  const cronExpression = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    executeTradingDecision();
  });

  logger.info(`Scheduled task set: ${cronExpression}`);
}

/**
 * 重置交易开始时间（用于恢复之前的交易）
 */
export function setTradingStartTime(time: Date) {
  tradingStartTime = time;
}

/**
 * 重置迭代计数（用于恢复之前的交易）
 */
export function setIterationCount(count: number) {
  iterationCount = count;
}

