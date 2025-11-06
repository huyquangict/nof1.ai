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

