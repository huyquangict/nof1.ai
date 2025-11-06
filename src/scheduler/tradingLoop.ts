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
 * Trading Loop - Execute trading decisions periodically
 */
import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createTradingAgent, generateTradingPrompt, getAccountRiskConfig } from "../agents/tradingAgent";
import { createExchangeClient } from "../services/exchange";
import { getChinaTimeISO } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";
import { getQuantoMultiplier } from "../utils/contractUtils";


// Import modular utilities and indicators
import { ensureFinite, ensureRange } from "./tradingLoop/utils/validation";
import {
  calculateIndicators,
  calculateIntradaySeries,
  calculateLongerTermContext,
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
} from "./tradingLoop/modules/indicators";
import { createMarketDataCollector } from "./tradingLoop/modules/marketData";
import { createAccountManager } from "./tradingLoop/modules/accountManager";
import { createPositionSynchronizer } from "./tradingLoop/modules/positionSync";
import { createRiskChecker } from "./tradingLoop/modules/riskChecker";
import { createConfigManager } from "./tradingLoop/modules/configManager";

const logger = createPinoLogger({
  name: "trading-loop",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// Supported trading symbols - read from config
const SYMBOLS = [...RISK_PARAMS.TRADING_SYMBOLS] as string[];

// Timeframe configuration - parse from environment variable
interface TimeframeConfig {
  interval: string;
  candleCount: number;
}

const TIMEFRAME_CONFIGS: Record<string, TimeframeConfig> = {
  "1m": { interval: "1m", candleCount: 60 },
  "3m": { interval: "3m", candleCount: 100 },
  "5m": { interval: "5m", candleCount: 100 },
  "15m": { interval: "15m", candleCount: 96 },
  "30m": { interval: "30m", candleCount: 90 },
  "1h": { interval: "1h", candleCount: 120 },
  "4h": { interval: "4h", candleCount: 60 },
  "8h": { interval: "8h", candleCount: 30 },
};

// Parse enabled timeframes from environment variable
const ENABLED_TIMEFRAMES = (process.env.ENABLED_TIMEFRAMES || "1m,3m,5m,15m,30m,1h,4h,8h")
  .split(",")
  .map(tf => tf.trim())
  .filter(tf => TIMEFRAME_CONFIGS[tf]); // Only include valid timeframes

// Trading start time
let tradingStartTime = new Date();
let iterationCount = 0;

// Account risk configuration
let accountRiskConfig = getAccountRiskConfig();





/**
 * Collect all market data (including multi-timeframe analysis and time series data)
 * Optimization: Add data validation and error handling, return time series data for prompts
 */
async function collectMarketData() {
  const exchangeClient = createExchangeClient();

  // Use the market data collector module
  const collector = createMarketDataCollector(exchangeClient, dbClient, {
    symbols: SYMBOLS,
    enabledTimeframes: ENABLED_TIMEFRAMES,
    timeframeConfigs: TIMEFRAME_CONFIGS,
  });

  const marketData = await collector.collectAll();
  return marketData;
}

// OLD IMPLEMENTATION (now replaced by module):
/*
async function collectMarketData() {
  const exchangeClient = createExchangeClient();
  const marketData: Record<string, any> = {};

  for (const symbol of SYMBOLS) {
    try {
      const contract = exchangeClient.normalizeSymbol(symbol);

      // Fetch price (with retry)
      let ticker: any = null;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          ticker = await exchangeClient.getFuturesTicker(symbol);

          // Validate price data validity
          const price = ticker.lastPrice;
          if (price === 0 || !Number.isFinite(price)) {
            throw new Error(`Invalid price: ${price}`);
          }

          break; // Success, break retry loop
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            logger.error(`${symbol} price fetch failed (${maxRetries} retries):`, error as any);
            throw error;
          }
          logger.warn(`${symbol} price fetch failed, retrying ${retryCount}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Fetch candlestick data for all enabled timeframes
      const candlesData: Record<string, any[]> = {};
      const indicatorsData: Record<string, any> = {};

      for (const timeframe of ENABLED_TIMEFRAMES) {
        const config = TIMEFRAME_CONFIGS[timeframe];
        try {
          candlesData[timeframe] = await exchangeClient.getFuturesCandles(
            symbol,
            config.interval as any,
            config.candleCount
          );
          indicatorsData[timeframe] = calculateIndicators(candlesData[timeframe]);
        } catch (error) {
          logger.warn(`Failed to fetch ${symbol} ${timeframe} candles:`, error as any);
          candlesData[timeframe] = [];
          indicatorsData[timeframe] = {};
        }
      }

      // Calculate 3-minute time series indicators (use smallest available timeframe, fallback to 5m)
      let intradaySeries: any;
      if (candlesData["3m"]?.length > 0) {
        intradaySeries = calculateIntradaySeries(candlesData["3m"]);
      } else if (candlesData["5m"]?.length > 0) {
        intradaySeries = calculateIntradaySeries(candlesData["5m"]);
      } else {
        intradaySeries = { midPrices: [], ema20Series: [], macdSeries: [], rsi7Series: [], rsi14Series: [] };
      }

      // Calculate 1-hour indicators as longer-term context
      const longerTermContext = candlesData["1h"]?.length > 0
        ? calculateLongerTermContext(candlesData["1h"])
        : { ema20Series: [], ema50Series: [], atr3Series: [], atr14Series: [], volumeSeries: [], macdSeries: [], rsi14Series: [] };

      // Use 5-minute candlestick data as main indicators (for compatibility), fallback to first available timeframe
      const indicators = indicatorsData["5m"] || indicatorsData[ENABLED_TIMEFRAMES[0]] || {};

      // Validate technical indicators validity and data completeness
      const dataTimestamp = new Date().toISOString();

      // Build candle quantity object dynamically
      const candleCount: Record<string, number> = {};
      for (const timeframe of ENABLED_TIMEFRAMES) {
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
      if (!dataQuality.price) issues.push("Invalid price");
      if (!dataQuality.ema20) issues.push("Invalid EMA20");
      if (!dataQuality.macd) issues.push("Invalid MACD");
      if (!dataQuality.rsi14) issues.push("Invalid or out-of-range RSI14");
      if (!dataQuality.volume) issues.push("Invalid volume");
      if (indicators.volume === 0) issues.push("Current volume is 0");

      if (issues.length > 0) {
        logger.warn(`${symbol} data quality issues [${dataTimestamp}]: ${issues.join(", ")}`);
        logger.debug(`${symbol} candlestick quantity:`, dataQuality.candleCount);
      } else {
        logger.debug(`${symbol} data quality check passed [${dataTimestamp}]`);
      }

      // Fetch funding rate
      let fundingRate = 0;
      try {
        const fr = await exchangeClient.getFundingRate(symbol);
        fundingRate = fr.rate;
        if (!Number.isFinite(fundingRate)) {
          fundingRate = 0;
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${symbol} funding rate:`, error as any);
      }

      // Fetch open interest - skip for now
      let openInterest = { latest: 0, average: 0 };
      // Note: Not all exchanges provide open interest data

      // Build timeframes object dynamically
      const timeframes: Record<string, any> = {};
      for (const timeframe of ENABLED_TIMEFRAMES) {
        if (indicatorsData[timeframe] && Object.keys(indicatorsData[timeframe]).length > 0) {
          timeframes[timeframe] = indicatorsData[timeframe];
        }
      }

      // Add multi-timeframe indicators to market data
      marketData[symbol] = {
        price: ticker.lastPrice,
        change24h: ticker.change24h,
        volume24h: ticker.volume24h,
        fundingRate,
        openInterest,
        ...indicators,
        // Add time series data (refer to 1.md format)
        intradaySeries,
        longerTermContext,
        // Add multi-timeframe indicators directly (dynamically populated)
        timeframes,
      };

      // Save technical indicators to database (ensure all values are valid)
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
          ensureFinite(indicators.rsi7, 50), // RSI default 50
          ensureFinite(indicators.rsi14, 50),
          ensureFinite(indicators.volume),
          ensureFinite(fundingRate),
        ],
      });
    } catch (error) {
      logger.error(`Failed to collect market data for ${symbol}:`, error as any);
    }
  }

  return marketData;
}
*/

// OLD IMPLEMENTATION (now replaced by accountManager module):
/*
async function calculateSharpeRatio(): Promise<number> {
  try {
    // Try to fetch all account history data (not limited to 30 days)
    const result = await dbClient.execute({
      sql: `SELECT total_value, timestamp FROM account_history
            ORDER BY timestamp ASC`,
      args: [],
    });

    if (!result.rows || result.rows.length < 2) {
      return 0; // Insufficient data, return 0
    }

    // Calculate return rate for each trade (not daily)
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

    // Calculate average return rate
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Calculate standard deviation of returns
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return avgReturn > 0 ? 10 : 0; // No volatility but has gains, return high value
    }

    // Sharpe Ratio = (average return - risk-free rate) / standard deviation
    // Assume risk-free rate is 0
    const sharpeRatio = avgReturn / stdDev;

    return Number.isFinite(sharpeRatio) ? sharpeRatio : 0;
  } catch (error) {
    logger.error("Failed to calculate Sharpe Ratio:", error as any);
    return 0;
  }
}

async function getAccountInfo() {
  const exchangeClient = createExchangeClient();

  try {
    const account = await exchangeClient.getFuturesAccount();

    // Get initial balance from database
    const initialResult = await dbClient.execute(
      "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
    );
    const initialBalance = initialResult.rows[0]
      ? Number.parseFloat(initialResult.rows[0].total_value as string)
      : 100;

    // Extract fields from exchange API response
    const accountTotal = account.totalBalance;
    const availableBalance = account.availableBalance;
    const unrealisedPnl = account.unrealisedPnl;

    // Exchange's totalBalance does not include unrealized P&L
    const totalBalance = accountTotal;

    // Real-time return rate = (total assets - initial balance) / initial balance * 100
    // Total assets do not include unrealized P&L, return rate reflects realized P&L
    const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;

    // Calculate Sharpe Ratio
    const sharpeRatio = await calculateSharpeRatio();

    return {
      totalBalance,      // Total assets (excluding unrealized P&L)
      availableBalance,  // Available balance
      unrealisedPnl,     // Unrealized P&L
      returnPercent,     // Return rate (excluding unrealized P&L)
      sharpeRatio,       // Sharpe ratio
    };
  } catch (error) {
    logger.error("Failed to get account information:", error as any);
    return {
      totalBalance: 0,
      availableBalance: 0,
      unrealisedPnl: 0,
      returnPercent: 0,
      sharpeRatio: 0,
    };
  }
}
*/

/**
 * Get account information using accountManager module
 */
async function getAccountInfo() {
  const exchangeClient = createExchangeClient();
  const accountManager = createAccountManager(exchangeClient, dbClient);
  return await accountManager.getAccountInfo();
}

/**
 * Sync positions from exchange to database
 * Optimization: Ensure position data accuracy and completeness
 * Position records in the database are mainly used for:
 * 1. Saving metadata such as stop-loss and take-profit order IDs
 * 2. Providing historical queries and monitoring page display
 * Real-time position data should be fetched directly from the exchange
 */
async function syncPositionsFromExchange(cachedPositions?: any[]) {
  const exchangeClient = createExchangeClient();
  const synchronizer = createPositionSynchronizer(exchangeClient, dbClient);
  await synchronizer.syncPositions(cachedPositions);
}

// OLD IMPLEMENTATION (replaced by positionSync module):
/*
async function syncPositionsFromExchange(cachedPositions?: any[]) {
  const exchangeClient = createExchangeClient();

  try {
    // If cached data is provided, use it; otherwise fetch new data
    const positions = cachedPositions || await exchangeClient.getPositions();
    const dbResult = await dbClient.execute("SELECT symbol, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const dbPositionsMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row])
    );

    // If exchange returns 0 positions but database has positions, it might be API delay, don't clear database
    if (positions.length === 0 && dbResult.rows.length > 0) {
      logger.warn(`Warning: Exchange returned 0 positions, but database has ${dbResult.rows.length} positions, possibly API delay, skipping sync`);
      return;
    }

    // Detect stop-loss and take-profit triggered positions before clearing database
    const exchangeSymbols = new Set(positions.map(p => p.symbol));
    for (const dbRow of dbResult.rows) {
      const dbSymbol = (dbRow as any).symbol;

      // Position exists in DB but not on exchange - it was closed
      if (!exchangeSymbols.has(dbSymbol)) {
        const slOrderId = (dbRow as any).sl_order_id;
        const tpOrderId = (dbRow as any).tp_order_id;
        const entryOrderId = (dbRow as any).entry_order_id;
        const openedAt = (dbRow as any).opened_at;

        // Try to get the entry trade to calculate PnL
        let entryPrice = 0;
        let quantity = 0;
        let leverage = 1;
        let side: 'long' | 'short' = 'long';

        if (entryOrderId) {
          try {
            const entryTradeResult = await dbClient.execute({
              sql: "SELECT price, quantity, leverage, side FROM trades WHERE order_id = ? AND type = 'open'",
              args: [entryOrderId]
            });
            if (entryTradeResult.rows.length > 0) {
              const entryTrade = entryTradeResult.rows[0] as any;
              entryPrice = parseFloat(entryTrade.price);
              quantity = parseFloat(entryTrade.quantity);
              leverage = parseInt(entryTrade.leverage);
              side = entryTrade.side;
            }
          } catch (err) {
            logger.warn(`Could not fetch entry trade for ${dbSymbol}: ${(err as any).message}`);
          }
        }

        // If there was a stop-loss order, check if it was triggered
        if (slOrderId) {
          try {
            const order = await exchangeClient.getOrder(slOrderId, dbSymbol);

            // Check if order was filled (status might be 'finished', 'closed', 'filled')
            if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
              // Check if this trade is already recorded (prevent duplicates)
              const existingTrade = await dbClient.execute({
                sql: 'SELECT order_id FROM trades WHERE order_id = ?',
                args: [slOrderId]
              });

              if (existingTrade.rows.length > 0) {
                logger.debug(`SL ${slOrderId} already recorded, skipping`);
                continue;
              }

              logger.info(`🛑 Stop-loss TRIGGERED for ${dbSymbol} (order ${slOrderId}) - Position closed automatically by exchange`);

              // Get quanto multiplier for correct PnL calculation
              const quantoMultiplier = await getQuantoMultiplier(dbSymbol);

              // Calculate fee (0.05% of notional value)
              const exitNotional = order.price * quantity * quantoMultiplier;
              const exitFee = exitNotional * 0.0005;

              // Calculate PnL with proper formula
              let pnl = 0;
              if (entryPrice > 0 && order.price > 0) {
                const priceChange = side === 'long'
                  ? (order.price - entryPrice)
                  : (entryPrice - order.price);
                pnl = priceChange * quantity * quantoMultiplier;

                // Subtract fees (entry + exit)
                const entryNotional = entryPrice * quantity * quantoMultiplier;
                const entryFee = entryNotional * 0.0005;
                pnl = pnl - entryFee - exitFee;
              }

              // Record close trade in trades table
              await dbClient.execute({
                sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                      VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
                args: [
                  slOrderId,
                  dbSymbol,
                  side,
                  order.price,
                  quantity,
                  leverage,
                  pnl,
                  exitFee,
                  new Date().toISOString(),
                  'stop_loss',
                  entryOrderId
                ]
              });

              // Record in agent decisions for tracking
              await dbClient.execute({
                sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                      VALUES (?, 0, 'Stop-loss triggered', 'Stop-loss executed', ?, 0, 0)`,
                args: [
                  new Date().toISOString(),
                  `Stop-loss TRIGGERED: ${dbSymbol} at ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${slOrderId})`
                ]
              });
            }
          } catch (orderError) {
            // Order might not exist anymore, that's ok
            logger.debug(`Could not fetch stop-loss order ${slOrderId} for ${dbSymbol}: ${(orderError as any).message}`);
          }
        }

        // Check for multiple take-profit orders (new JSON format)
        const tpOrdersStr = (dbRow as any).tp_orders;
        if (tpOrdersStr) {
          try {
            const tpOrders = JSON.parse(tpOrdersStr);
            for (const tp of tpOrders) {
              if (!tp.triggered) {
                try {
                  const order = await exchangeClient.getOrder(tp.orderId, dbSymbol);

                  // Check if order was filled
                  if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
                    // Check if this trade is already recorded (prevent duplicates)
                    const existingTrade = await dbClient.execute({
                      sql: 'SELECT order_id FROM trades WHERE order_id = ?',
                      args: [tp.orderId]
                    });

                    if (existingTrade.rows.length > 0) {
                      logger.debug(`TP ${tp.orderId} already recorded, marking as triggered`);
                      tp.triggered = true;
                      await dbClient.execute({
                        sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                        args: [JSON.stringify(tpOrders), dbSymbol]
                      });
                      continue;
                    }

                    logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol} (${tp.percentage}% @ ${tp.price}, order ${tp.orderId})`);

                    // Get quanto multiplier for correct PnL calculation
                    const quantoMultiplier = await getQuantoMultiplier(dbSymbol);

                    // Calculate partial quantity
                    const actualQuantity = quantity * (tp.percentage / 100);

                    // Calculate fee (0.05% of notional value)
                    const exitNotional = order.price * actualQuantity * quantoMultiplier;
                    const exitFee = exitNotional * 0.0005;

                    // Calculate PnL with proper formula
                    let pnl = 0;
                    if (entryPrice > 0 && order.price > 0) {
                      const priceChange = side === 'long'
                        ? (order.price - entryPrice)
                        : (entryPrice - order.price);
                      pnl = priceChange * actualQuantity * quantoMultiplier;

                      // Subtract fees (entry + exit, proportional to partial quantity)
                      const entryNotional = entryPrice * actualQuantity * quantoMultiplier;
                      const entryFee = entryNotional * 0.0005;
                      pnl = pnl - entryFee - exitFee;
                    }

                    // Record close trade in trades table (partial close)
                    await dbClient.execute({
                      sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                            VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
                      args: [
                        tp.orderId,
                        dbSymbol,
                        side,
                        order.price,
                        actualQuantity,
                        leverage,
                        pnl,
                        exitFee,
                        new Date().toISOString(),
                        'take_profit_partial',
                        entryOrderId
                      ]
                    });

                    // Record in agent decisions
                    await dbClient.execute({
                      sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                            VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
                      args: [
                        new Date().toISOString(),
                        `Take-profit TRIGGERED: ${dbSymbol} ${tp.percentage}% @ ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${tp.orderId})`
                      ]
                    });

                    // Mark this TP as triggered in the positions table
                    tp.triggered = true;
                    await dbClient.execute({
                      sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                      args: [JSON.stringify(tpOrders), dbSymbol]
                    });
                  }
                } catch (orderError) {
                  logger.debug(`Could not fetch TP order ${tp.orderId} for ${dbSymbol}: ${(orderError as any).message}`);
                }
              }
            }
          } catch (parseError) {
            logger.warn(`Failed to parse tp_orders for ${dbSymbol}, falling back to old format`);

            // Fallback: Check old format single TP
            if (tpOrderId) {
              try {
                const order = await exchangeClient.getOrder(tpOrderId, dbSymbol);
                if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
                  logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol} (order ${tpOrderId})`);

                  // Get quanto multiplier for correct PnL calculation
                  const quantoMultiplier = await getQuantoMultiplier(dbSymbol);

                  // Calculate fee (0.05% of notional value)
                  const exitNotional = order.price * quantity * quantoMultiplier;
                  const exitFee = exitNotional * 0.0005;

                  // Calculate PnL with proper formula
                  let pnl = 0;
                  if (entryPrice > 0 && order.price > 0) {
                    const priceChange = side === 'long'
                      ? (order.price - entryPrice)
                      : (entryPrice - order.price);
                    pnl = priceChange * quantity * quantoMultiplier;

                    // Subtract fees (entry + exit)
                    const entryNotional = entryPrice * quantity * quantoMultiplier;
                    const entryFee = entryNotional * 0.0005;
                    pnl = pnl - entryFee - exitFee;
                  }

                  // Record close trade
                  await dbClient.execute({
                    sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                          VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
                    args: [
                      tpOrderId,
                      dbSymbol,
                      side,
                      order.price,
                      quantity,
                      leverage,
                      pnl,
                      exitFee,
                      new Date().toISOString(),
                      'take_profit'
                    ]
                  });

                  await dbClient.execute({
                    sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                          VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
                    args: [
                      new Date().toISOString(),
                      `Take-profit TRIGGERED: ${dbSymbol} at ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${tpOrderId})`
                    ]
                  });
                }
              } catch (orderError) {
                logger.debug(`Could not fetch take-profit order ${tpOrderId} for ${dbSymbol}: ${(orderError as any).message}`);
              }
            }
          }
        } else if (tpOrderId) {
          // Legacy format: single TP in tp_order_id field
          try {
            const order = await exchangeClient.getOrder(tpOrderId, dbSymbol);
            if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
              logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol} (order ${tpOrderId})`);

              // Get quanto multiplier for correct PnL calculation
              const quantoMultiplier = await getQuantoMultiplier(dbSymbol);

              // Calculate fee (0.05% of notional value)
              const exitNotional = order.price * quantity * quantoMultiplier;
              const exitFee = exitNotional * 0.0005;

              // Calculate PnL with proper formula
              let pnl = 0;
              if (entryPrice > 0 && order.price > 0) {
                const priceChange = side === 'long'
                  ? (order.price - entryPrice)
                  : (entryPrice - order.price);
                pnl = priceChange * quantity * quantoMultiplier;

                // Subtract fees (entry + exit)
                const entryNotional = entryPrice * quantity * quantoMultiplier;
                const entryFee = entryNotional * 0.0005;
                pnl = pnl - entryFee - exitFee;
              }

              // Record close trade
              await dbClient.execute({
                sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                      VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
                args: [
                  tpOrderId,
                  dbSymbol,
                  side,
                  order.price,
                  quantity,
                  leverage,
                  pnl,
                  exitFee,
                  new Date().toISOString(),
                  'take_profit'
                ]
              });

              await dbClient.execute({
                sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                      VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
                args: [
                  new Date().toISOString(),
                  `Take-profit TRIGGERED: ${dbSymbol} at ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${tpOrderId})`
                ]
              });
            }
          } catch (orderError) {
            logger.debug(`Could not fetch take-profit order ${tpOrderId} for ${dbSymbol}: ${(orderError as any).message}`);
          }
        }
      }
    }

    // Check take-profit orders for ALL positions (including those still open)
    logger.debug('Checking take-profit orders for all positions...');
    for (const dbRow of dbResult.rows) {
      const dbSymbol = (dbRow as any).symbol;
      const tpOrdersStr = (dbRow as any).tp_orders;
      const entryOrderId = (dbRow as any).entry_order_id;

      // Skip if no TP orders
      if (!tpOrdersStr) continue;

      // Get entry trade data for PnL calculation
      let entryPrice = 0;
      let quantity = 0;
      let leverage = 1;
      let side: 'long' | 'short' = 'long';

      if (entryOrderId) {
        try {
          const entryTradeResult = await dbClient.execute({
            sql: "SELECT price, quantity, leverage, side FROM trades WHERE order_id = ? AND type = 'open'",
            args: [entryOrderId]
          });
          if (entryTradeResult.rows.length > 0) {
            const entryTrade = entryTradeResult.rows[0] as any;
            entryPrice = parseFloat(entryTrade.price);
            quantity = parseFloat(entryTrade.quantity);
            leverage = parseInt(entryTrade.leverage);
            side = entryTrade.side;
          }
        } catch (err) {
          logger.warn(`Could not fetch entry trade for ${dbSymbol}: ${(err as any).message}`);
        }
      }

      // Parse and check TP orders
      try {
        const tpOrders = JSON.parse(tpOrdersStr);
        for (const tp of tpOrders) {
          if (!tp.triggered) {
            try {
              const order = await exchangeClient.getOrder(tp.orderId, dbSymbol);

              // Check if order was filled
              if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
                // Check if this trade is already recorded (prevent duplicates)
                const existingTrade = await dbClient.execute({
                  sql: 'SELECT order_id FROM trades WHERE order_id = ?',
                  args: [tp.orderId]
                });

                if (existingTrade.rows.length > 0) {
                  logger.debug(`TP ${tp.orderId} already recorded, marking as triggered`);
                  tp.triggered = true;
                  await dbClient.execute({
                    sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                    args: [JSON.stringify(tpOrders), dbSymbol]
                  });
                  continue;
                }

                logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol} (${tp.percentage}% @ ${tp.price}, order ${tp.orderId})`);

                // Calculate PnL for partial TP
                let pnl = 0;
                if (entryPrice > 0 && order.price > 0) {
                  const actualQuantity = quantity * (tp.percentage / 100); // Partial close
                  const priceChange = side === 'long'
                    ? (order.price - entryPrice) / entryPrice
                    : (entryPrice - order.price) / entryPrice;
                  pnl = priceChange * leverage * entryPrice * actualQuantity;
                }

                // Record close trade in trades table (partial close)
                await dbClient.execute({
                  sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                        VALUES (?, ?, ?, 'close', ?, ?, ?, ?, 0, ?, 'closed', ?)`,
                  args: [
                    tp.orderId,
                    dbSymbol,
                    side,
                    order.price,
                    quantity * (tp.percentage / 100), // Partial quantity
                    leverage,
                    pnl,
                    new Date().toISOString(),
                    'take_profit_partial',
                        entryOrderId
                  ]
                });

                // Record in agent decisions
                await dbClient.execute({
                  sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                        VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
                  args: [
                    new Date().toISOString(),
                    `Take-profit TRIGGERED: ${dbSymbol} ${tp.percentage}% @ ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${tp.orderId})`
                  ]
                });

                // Mark this TP as triggered in the positions table
                tp.triggered = true;
                await dbClient.execute({
                  sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                  args: [JSON.stringify(tpOrders), dbSymbol]
                });
              }
            } catch (orderError) {
              logger.debug(`Could not fetch TP order ${tp.orderId} for ${dbSymbol}: ${(orderError as any).message}`);
            }
          }
        }
      } catch (parseError) {
        logger.debug(`Failed to parse tp_orders for ${dbSymbol}: ${(parseError as any).message}`);
      }
    }

    // Re-query positions to get updated tp_orders with triggered status
    const updatedDbResult = await dbClient.execute("SELECT symbol, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, stop_loss, profit_target, entry_order_id, opened_at FROM positions");
    const updatedDbPositionsMap = new Map(
      updatedDbResult.rows.map((row: any) => [row.symbol, row])
    );

    await dbClient.execute("DELETE FROM positions");

    let syncedCount = 0;

    for (const pos of positions) {
      const symbol = pos.symbol;
      let entryPrice = pos.entryPrice;
      let currentPrice = pos.currentPrice;
      const leverage = pos.leverage;
      const side = pos.side;
      const quantity = pos.quantity;
      const unrealizedPnl = pos.unrealizedPnl;
      let liquidationPrice = pos.liquidationPrice;

      if (entryPrice === 0 || currentPrice === 0) {
        try {
          const ticker = await exchangeClient.getFuturesTicker(symbol);
          if (currentPrice === 0) {
            currentPrice = ticker.markPrice;
          }
          if (entryPrice === 0) {
            entryPrice = currentPrice;
          }
        } catch (error) {
          logger.error(`Failed to fetch ${symbol} ticker:`, error as any);
        }
      }

      if (liquidationPrice === 0 && entryPrice > 0) {
        liquidationPrice = side === "long"
          ? entryPrice * (1 - 0.9 / leverage)
          : entryPrice * (1 + 0.9 / leverage);
      }

      const dbPos = updatedDbPositionsMap.get(symbol);

      // Preserve original entry_order_id, do not overwrite
      const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;

      await dbClient.execute({
        sql: `INSERT INTO positions
              (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
               leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, entry_order_id, opened_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          dbPos?.sl_percentage || null,
          dbPos?.tp_percentage || null,
          dbPos?.tp_orders || null, // Preserve tp_orders JSON array
          dbPos?.sl_orders || null, // 🔧 FIX: Preserve sl_orders JSON array
          entryOrderId, // Preserve original order ID
          dbPos?.opened_at || new Date().toISOString(), // Preserve original opening time
        ],
      });

      syncedCount++;
    }

    const activePositionsCount = positions.length;
    if (activePositionsCount > 0 && syncedCount === 0) {
      logger.error(`Exchange has ${activePositionsCount} positions, but database sync failed!`);
    }

  } catch (error) {
    logger.error("Failed to sync positions:", error as any);
  }
}
*/

/**
 * Get position information - fetch latest data directly from the exchange
 * @param cachedPositions Optional, already fetched position data to avoid repeated API calls
 * @returns Formatted position data
 */
async function getPositions(cachedPositions?: any[]) {
  const exchangeClient = createExchangeClient();

  try {
    // If cached data is provided, use it; otherwise fetch new data
    const exchangePositions = cachedPositions || await exchangeClient.getPositions();

    // Get position opening time from database (database stores the correct opening time)
    const dbResult = await dbClient.execute("SELECT symbol, opened_at FROM positions");
    const dbOpenedAtMap = new Map(
      dbResult.rows.map((row: any) => [row.symbol, row.opened_at])
    );

    // Format positions
    const positions = exchangePositions.map((p) => {
        const symbol = p.symbol;

        // Prioritize reading opening time from database to ensure accuracy
        let openedAt = dbOpenedAtMap.get(symbol);

        // If not in database, use current time
        if (!openedAt) {
          openedAt = getChinaTimeISO();
          logger.warn(`Opening time missing for ${symbol} positions, using current time`);
        }

        return {
          symbol,
          contract: p.exchangeSymbol,
          quantity: p.quantity,
          side: p.side,
          entry_price: p.entryPrice,
          current_price: p.currentPrice,
          liquidation_price: p.liquidationPrice,
          unrealized_pnl: p.unrealizedPnl,
          leverage: p.leverage,
          margin: p.margin,
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
 * Get trade history (last 10 records)
 * Fetch historical trade records from database (for monitoring page trade history)
 */
async function getTradeHistory(limit: number = 10) {
  try {
    // Fetch historical trade records from database
    const result = await dbClient.execute({
      sql: `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`,
      args: [limit],
    });

    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Convert database format to format needed for prompts
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

    // Sort by time in ascending order (oldest to newest)
    trades.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return trades;
  } catch (error) {
    logger.error("Failed to get trade history:", error as any);
    return [];
  }
}

/**
 * Get recent N AI decision records
 */
async function getRecentDecisions(limit: number = 3) {
  try {
    const result = await dbClient.execute({
      sql: `SELECT timestamp, iteration, decision, account_value, positions_quantity
            FROM agent_decisions
            ORDER BY timestamp DESC
            LIMIT ?`,
      args: [limit],
    });

    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Return formatted decision records (from oldest to newest)
    return result.rows.reverse().map((row: any) => ({
      timestamp: row.timestamp,
      iteration: row.iteration,
      decision: row.decision,
      account_value: Number.parseFloat(row.account_value || "0"),
      positions_quantity: Number.parseInt(row.positions_quantity || "0"),
    }));
  } catch (error) {
    logger.error("Failed to get recent decision records:", error as any);
    return [];
  }
}

/**
 * Sync risk configuration to database using configManager module
 */
async function syncConfigToDatabase() {
  const configManager = createConfigManager(dbClient, getAccountRiskConfig);
  await configManager.syncConfigToDatabase();
}

/**
 * Load risk configuration from database using configManager module
 */
async function loadConfigFromDatabase() {
  const configManager = createConfigManager(dbClient, getAccountRiskConfig);
  const config = await configManager.loadConfigFromDatabase();

  // Update module-level config if loaded successfully
  if (config) {
    accountRiskConfig = {
      ...config,
      syncOnStartup: accountRiskConfig.syncOnStartup,
    };
  }
}

// OLD IMPLEMENTATION (replaced by configManager module):
/*
async function syncConfigToDatabase() {
  try {
    const config = getAccountRiskConfig();
    const timestamp = getChinaTimeISO();

    // Update or insert configuration
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_stop_loss_usdt', config.stopLossUsdt.toString(), timestamp],
    });

    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['account_take_profit_usdt', config.takeProfitUsdt.toString(), timestamp],
    });

    logger.info(`Configuration synced to database: stop loss=${config.stopLossUsdt} USDT, take profit=${config.takeProfitUsdt} USDT`);
  } catch (error) {
    logger.error("Failed to sync configuration to database:", error as any);
  }
}

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

      logger.info(`Configuration loaded from database: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);
    }
  } catch (error) {
    logger.warn("Failed to load configuration from database, using environment variable configuration:", error as any);
  }
}
*/

/**
 * Fix historical P&L records using riskChecker module
 */
async function fixHistoricalPnlRecords() {
  const exchangeClient = createExchangeClient();
  const riskChecker = createRiskChecker(exchangeClient, dbClient, accountRiskConfig);
  await riskChecker.fixHistoricalPnlRecords();
}

/**
 * Close all positions using riskChecker module
 */
async function closeAllPositions(reason: string): Promise<void> {
  const exchangeClient = createExchangeClient();
  const riskChecker = createRiskChecker(exchangeClient, dbClient, accountRiskConfig);
  await riskChecker.closeAllPositions(reason);
}

/**
 * Check if account balance triggers stop loss or take profit using riskChecker module
 * @returns true: exit condition triggered, false: continue running
 */
async function checkAccountThresholds(accountInfo: any): Promise<boolean> {
  const exchangeClient = createExchangeClient();
  const riskChecker = createRiskChecker(exchangeClient, dbClient, accountRiskConfig);
  return await riskChecker.checkAccountThresholds(accountInfo);
}

// OLD IMPLEMENTATION (replaced by riskChecker module):
/*
async function fixHistoricalPnlRecords() {
  try {
    // Query all closing trade records
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

      // Find corresponding opening trade record
      const openResult = await dbClient.execute({
        sql: `SELECT * FROM trades WHERE symbol = ? AND type = 'open' AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
        args: [symbol, timestamp],
      });

      if (!openResult.rows || openResult.rows.length === 0) {
        continue;
      }

      const openTrade = openResult.rows[0];
      const openPrice = Number.parseFloat(openTrade.price as string);

      // Get contract multiplier
      const contract = `${symbol}_USDT`;
      const quantoMultiplier = await getQuantoMultiplier(contract);

      // Recalculate correct P&L
      const priceChange = side === "long"
        ? (closePrice - openPrice)
        : (openPrice - closePrice);

      const grossPnl = priceChange * quantity * quantoMultiplier;
      const openFee = openPrice * quantity * quantoMultiplier * 0.0005;
      const closeFee = closePrice * quantity * quantoMultiplier * 0.0005;
      const totalFee = openFee + closeFee;
      const correctPnl = grossPnl - totalFee;

      // Calculate difference
      const pnlDiff = Math.abs(recordedPnl - correctPnl);
      const feeDiff = Math.abs(recordedFee - totalFee);

      // If difference exceeds 0.5 USDT, fix it
      if (pnlDiff > 0.5 || feeDiff > 0.1) {
        logger.warn(`Fixing trade record ID=${id} (${symbol} ${side})`);
        logger.warn(`  P&L: ${recordedPnl.toFixed(2)} → ${correctPnl.toFixed(2)} USDT (difference: ${pnlDiff.toFixed(2)})`);

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

async function closeAllPositions(reason: string): Promise<void> {
  const exchangeClient = createExchangeClient();

  try {
    logger.warn(`Closing all positions, reason: ${reason}`);

    const positions = await exchangeClient.getPositions();
    // Positions are already filtered (only non-zero positions)

    if (positions.length === 0) {
      return;
    }

    for (const pos of positions) {
      const symbol = pos.symbol;
      const quantity = pos.quantity;
      const side = pos.side;

      try {
        // Place opposite order to close the position
        await exchangeClient.placeOrder({
          symbol,
          side: side === 'long' ? 'short' : 'long',
          quantity,
          reduceOnly: true,
        });

        logger.info(`Position closed: ${symbol} ${quantity} units`);
      } catch (error) {
        logger.error(`Failed to close position: ${symbol}`, error as any);
      }
    }

    logger.warn(`All positions closed`);
  } catch (error) {
    logger.error("Failed to close all positions:", error as any);
    throw error;
  }
}

async function checkAccountThresholds(accountInfo: any): Promise<boolean> {
  const totalBalance = accountInfo.totalBalance;

  // Check stop loss threshold
  if (totalBalance <= accountRiskConfig.stopLossUsdt) {
    logger.error(`Stop loss triggered! Balance: ${totalBalance.toFixed(2)} USDT <= ${accountRiskConfig.stopLossUsdt} USDT`);
    await closeAllPositions(`Account balance triggered stop loss (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  // Check take profit threshold
  if (totalBalance >= accountRiskConfig.takeProfitUsdt) {
    logger.warn(`Take profit triggered! Balance: ${totalBalance.toFixed(2)} USDT >= ${accountRiskConfig.takeProfitUsdt} USDT`);
    await closeAllPositions(`Account balance triggered take profit (${totalBalance.toFixed(2)} USDT)`);
    return true;
  }

  return false;
}
*/

/**
 * Execute trading decision
 * Optimization: Enhance error handling and data validation to ensure real-time accurate data
 */
async function executeTradingDecision() {
  iterationCount++;
  const minutesElapsed = Math.floor((Date.now() - tradingStartTime.getTime()) / 60000);
  const intervalMinutes = Number.parseInt(process.env.TRADING_INTERVAL_MINUTES || "5");

  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`Trading cycle #${iterationCount} (running for ${minutesElapsed} minutes)`);
  logger.info(`${"=".repeat(80)}\n`);

  let marketData: any = {};
  let accountInfo: any = null;
  let positions: any[] = [];
  let exchangeClient = createExchangeClient();

  try {
    // 1. Collect market data
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
        logger.error("Failed to fetch market data, skipping this cycle");
        return;
      }
    } catch (error) {
      logger.error("Failed to collect market data:", error as any);
      return;
    }

    // 2. Get account information
    try {
      accountInfo = await getAccountInfo();

      if (!accountInfo || accountInfo.totalBalance === 0) {
        logger.error("Account data anomaly, skipping this cycle");
        return;
      }

      // Check if account balance triggers stop loss or take profit
      const shouldExit = await checkAccountThresholds(accountInfo);
      if (shouldExit) {
        logger.error("Account balance triggered exit condition, system will stop!");
        setTimeout(() => {
          process.exit(0);
        }, 5000);
        return;
      }

    } catch (error) {
      logger.error("Failed to get account information:", error as any);
      return;
    }

    // 3. Sync position information (Optimization: call API only once to avoid duplication)
    try {
      const rawPositions = await exchangeClient.getPositions();

      // Use the same data for processing and syncing to avoid repeated API calls
      positions = await getPositions(rawPositions);
      await syncPositionsFromExchange(rawPositions);

      const dbPositions = await dbClient.execute("SELECT COUNT(*) as quantity FROM positions");
      const dbCount = (dbPositions.rows[0] as any).quantity;

      if (positions.length !== dbCount) {
        logger.warn(`Position sync inconsistency: Exchange=${positions.length}, DB=${dbCount}`);
        // Sync again using the same data
        await syncPositionsFromExchange(rawPositions);
      }
    } catch (error) {
      logger.error("Failed to sync positions:", error as any);
    }

    // 4. Risk checks now handled by separate risk monitor (runs every 30 seconds)
    // See: src/scheduler/riskMonitor.ts
    // - 36-hour time limit
    // - Trailing take-profit (locks profits at +8%, +15%, +25%)
    // - Peak drawdown protection (30% retracement from peak)
    // - Stop-loss managed by env variable POSITION_STOP_LOSS_PNL_PERCENT

    // 4. No longer save account history (equity curve module removed)
    // try {
    //   await saveAccountHistory(accountInfo);
    // } catch (error) {
    //   logger.error("Failed to save account history:", error as any);
    //   // Does not affect main flow
    // }

    // 5. Data integrity final check
    const dataValid =
      marketData && Object.keys(marketData).length > 0 &&
      accountInfo && accountInfo.totalBalance > 0 &&
      Array.isArray(positions);

    if (!dataValid) {
      logger.error("Data integrity check failed, skipping this cycle");
      logger.error(`Market data: ${Object.keys(marketData).length}, Account: ${accountInfo?.totalBalance}, Positions: ${positions.length}`);
      return;
    }

    // 6. Fix historical P&L records
    try {
      await fixHistoricalPnlRecords();
    } catch (error) {
      logger.warn("Failed to fix historical P&L records:", error as any);
      // Does not affect main flow, continue execution
    }

    // 7. Get trade history (last 100 records to have enough for per-symbol analysis)
    let tradeHistory: any[] = [];
    try {
      tradeHistory = await getTradeHistory(100);
    } catch (error) {
      logger.warn("Failed to get trade history:", error as any);
      // Does not affect main flow, continue execution
    }

    // 8. Get previous AI decision
    // Disabled to maximize AI response tokens (saves ~1,500 chars)
    let recentDecisions: any[] = [];
    try {
      recentDecisions = await getRecentDecisions(0);
    } catch (error) {
      logger.warn("Failed to get recent decision records:", error as any);
      // Does not affect main flow, continue execution
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

    // Output complete prompt to log
    logger.info("Input Parameters - AI Prompt");
    logger.info("=".repeat(80));
    logger.info(prompt);
    logger.info("=".repeat(80) + "\n");
    
    const agent = createTradingAgent(intervalMinutes);

    // Generate unique conversation ID for this trading cycle
    const conversationId = `trading-cycle-${new Date().toISOString().split('T')[0]}-${iterationCount}`;
    const maxSteps = Number.parseInt(process.env.MAX_STEPS || "10", 10);
    logger.info(`🔗 Using conversation ID: ${conversationId} (maxSteps: ${maxSteps})`);

    try {
      const response = await agent.generateText(prompt, {
        conversationId,
        maxSteps,  // Allow multiple steps for tool calls and analysis (configurable via MAX_STEPS env)
      });

      // Extract AI's complete response from response, no splitting
      let decisionText = "";

      if (typeof response === 'string') {
        decisionText = response;
      } else if (response && typeof response === 'object') {
        const steps = (response as any).steps || [];

        // Collect all AI text responses (preserve completely, no splitting)
        const allTexts: string[] = [];

        for (const step of steps) {
          if (step.content) {
            for (const item of step.content) {
              if (item.type === 'text' && item.text && item.text.trim()) {
                allTexts.push(item.text.trim());
              }
            }
          }
        }

        // Merge all text completely, separated by double newlines
        if (allTexts.length > 0) {
          decisionText = allTexts.join('\n\n');
        }

        // If no text message found, try other fields
        if (!decisionText) {
          decisionText = (response as any).text || (response as any).message || "";
        }

        // If still no text response, AI only called tools without producing decision
        if (!decisionText && steps.length > 0) {
          decisionText = "AI called tools but did not produce decision result";
        }
      }

      logger.info("Output - AI Decision");
      logger.info("=".repeat(80));
      logger.info(decisionText || "No decision output");
      logger.info("=".repeat(80) + "\n");

      // Save decision record
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions
              (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          new Date().toISOString(),
          iterationCount,
          JSON.stringify(marketData),
          decisionText,
          "[]",
          accountInfo.totalBalance,
          positions.length,
        ],
      });

      // Re-sync position data after Agent execution (Optimization: call API only once)
      const updatedRawPositions = await exchangeClient.getPositions();
      await syncPositionsFromExchange(updatedRawPositions);
      const updatedPositions = await getPositions(updatedRawPositions);

      // Re-fetch updated account info with latest unrealized P&L
      const updatedAccountInfo = await getAccountInfo();
      const finalUnrealizedPnL = updatedPositions.reduce((sum: number, pos: any) => sum + (pos.unrealized_pnl || 0), 0);

      logger.info("Final - Position Status");
      logger.info("=".repeat(80));
      logger.info(`Account: ${updatedAccountInfo.totalBalance.toFixed(2)} USDT (Available: ${updatedAccountInfo.availableBalance.toFixed(2)}, Return: ${updatedAccountInfo.returnPercent.toFixed(2)}%)`);

      if (updatedPositions.length === 0) {
        logger.info("Positions: None");
      } else {
        logger.info(`Positions: ${updatedPositions.length} total`);
        updatedPositions.forEach((pos: any) => {
          // Calculate P&L percentage: consider leverage multiple
          // For leveraged trading: P&L% = (price change%) x leverage multiple
          const priceChangePercent = pos.entry_price > 0
            ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
            : 0;
          const pnlPercent = priceChangePercent * pos.leverage;
          logger.info(`  ${pos.symbol} ${pos.side === 'long' ? 'long' : 'short'} ${pos.quantity} units (entry: ${pos.entry_price.toFixed(2)}, current: ${pos.current_price.toFixed(2)}, P&L: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT / ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
        });
      }

      logger.info(`Unrealized P&L: ${finalUnrealizedPnL >= 0 ? '+' : ''}${finalUnrealizedPnL.toFixed(2)} USDT`);
      logger.info("=".repeat(80) + "\n");

    } catch (agentError) {
      logger.error("Agent execution failed:", agentError as any);
      try {
        await syncPositionsFromExchange();
      } catch (syncError) {
        logger.error("Sync failed:", syncError as any);
      }
    }

    // Automatically fix historical P&L records at the end of each cycle
    try {
      logger.info("Checking and fixing historical P&L records...");
      await fixHistoricalPnlRecords();
    } catch (fixError) {
      logger.error("Failed to fix historical P&L:", fixError as any);
      // Does not affect main flow, continue execution
    }

  } catch (error) {
    logger.error("Trading loop execution failed:", error as any);
    try {
      await syncPositionsFromExchange();
    } catch (recoveryError) {
      logger.error("Recovery failed:", recoveryError as any);
    }
  }
}

/**
 * Initialize trading system configuration
 */
export async function initTradingSystem() {
  logger.info("Initializing trading system configuration...");

  // 1. Load configuration
  accountRiskConfig = getAccountRiskConfig();
  logger.info(`Environment variable configuration: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);

  // 2. If startup sync is enabled, sync config to database
  if (accountRiskConfig.syncOnStartup) {
    await syncConfigToDatabase();
  } else {
    // Otherwise load config from database
    await loadConfigFromDatabase();
  }

  logger.info(`Final configuration: stop loss=${accountRiskConfig.stopLossUsdt} USDT, take profit=${accountRiskConfig.takeProfitUsdt} USDT`);
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
  logger.info(`Enabled timeframes: ${ENABLED_TIMEFRAMES.join(", ")}`);

  // Execute once immediately
  executeTradingDecision();

  // Set scheduled task
  const cronExpression = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    executeTradingDecision();
  });

  logger.info(`Scheduled task set: ${cronExpression}`);
}

/**
 * Reset trading start time (for recovering previous trades)
 */
export function setTradingStartTime(time: Date) {
  tradingStartTime = time;
}

/**
 * Reset iteration quantity (for recovering previous trades)
 */
export function setIterationCount(quantity: number) {
  iterationCount = quantity;
}

