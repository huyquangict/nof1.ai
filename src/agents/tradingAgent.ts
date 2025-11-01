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
 * Trading Agent Configuration (Minimalist Version)
 */
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { createOpenAI } from "@ai-sdk/openai";
import * as tradingTools from "../tools/trading";
import { formatChinaTime } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";

/**
 * Account Risk Configuration
 */
export interface AccountRiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
  syncOnStartup: boolean;
}

/**
 * Read account risk configuration from environment variables
 */
export function getAccountRiskConfig(): AccountRiskConfig {
  return {
    stopLossUsdt: Number.parseFloat(process.env.ACCOUNT_STOP_LOSS_USDT || "50"),
    takeProfitUsdt: Number.parseFloat(process.env.ACCOUNT_TAKE_PROFIT_USDT || "10000"),
    syncOnStartup: process.env.SYNC_CONFIG_ON_STARTUP === "true",
  };
}

/**
 * Trading Strategy Type
 */
export type TradingStrategy = "conservative" | "balanced" | "aggressive";

/**
 * Strategy Parameters Configuration
 */
export interface StrategyParams {
  name: string;
  description: string;
  leverageMin: number;
  leverageMax: number;
  leverageRecommend: {
    normal: string;
    good: string;
    strong: string;
  };
  positionSizeMin: number;
  positionSizeMax: number;
  positionSizeRecommend: {
    normal: string;
    good: string;
    strong: string;
  };
  stopLoss: {
    low: number;
    mid: number;
    high: number;
  };
  entryCondition: string;
  riskTolerance: string;
  tradingStyle: string;
}

/**
 * Get strategy parameters (dynamically calculated based on MAX_LEVERAGE)
 */
export function getStrategyParams(strategy: TradingStrategy): StrategyParams {
  const maxLeverage = RISK_PARAMS.MAX_LEVERAGE;

  // Dynamically calculate leverage ranges for each strategy based on MAX_LEVERAGE
  // Conservative strategy: 30%-60% of max leverage
  const conservativeLevMin = Math.max(1, Math.ceil(maxLeverage * 0.3));
  const conservativeLevMax = Math.max(2, Math.ceil(maxLeverage * 0.6));
  const conservativeLevNormal = conservativeLevMin;
  const conservativeLevGood = Math.ceil((conservativeLevMin + conservativeLevMax) / 2);
  const conservativeLevStrong = conservativeLevMax;

  // Balanced strategy: 60%-85% of max leverage
  const balancedLevMin = Math.max(2, Math.ceil(maxLeverage * 0.6));
  const balancedLevMax = Math.max(3, Math.ceil(maxLeverage * 0.85));
  const balancedLevNormal = balancedLevMin;
  const balancedLevGood = Math.ceil((balancedLevMin + balancedLevMax) / 2);
  const balancedLevStrong = balancedLevMax;

  // Aggressive strategy: 85%-100% of max leverage
  const aggressiveLevMin = Math.max(3, Math.ceil(maxLeverage * 0.85));
  const aggressiveLevMax = maxLeverage;
  const aggressiveLevNormal = aggressiveLevMin;
  const aggressiveLevGood = Math.ceil((aggressiveLevMin + aggressiveLevMax) / 2);
  const aggressiveLevStrong = aggressiveLevMax;
  
  const strategyConfigs: Record<TradingStrategy, StrategyParams> = {
    "conservative": {
      name: "Conservative",
      description: "Low risk, low leverage, strict entry conditions, suitable for conservative investors",
      leverageMin: conservativeLevMin,
      leverageMax: conservativeLevMax,
      leverageRecommend: {
        normal: `${conservativeLevNormal}x`,
        good: `${conservativeLevGood}x`,
        strong: `${conservativeLevStrong}x`,
      },
      positionSizeMin: 15,
      positionSizeMax: 22,
      positionSizeRecommend: {
        normal: "15-17%",
        good: "17-20%",
        strong: "20-22%",
      },
      stopLoss: {
        low: -3.5,
        mid: -3,
        high: -2.5,
      },
      entryCondition: "At least 3 key timeframe signals must align, preferably 4 or more",
      riskTolerance: "Single trade risk controlled between 15-22%, strict drawdown control",
      tradingStyle: "Cautious trading, prefer to miss opportunities rather than take risks, prioritize capital protection",
    },
    "balanced": {
      name: "Balanced",
      description: "Moderate risk leverage, reasonable entry conditions, suitable for most investors",
      leverageMin: balancedLevMin,
      leverageMax: balancedLevMax,
      leverageRecommend: {
        normal: `${balancedLevNormal}x`,
        good: `${balancedLevGood}x`,
        strong: `${balancedLevStrong}x`,
      },
      positionSizeMin: 20,
      positionSizeMax: 27,
      positionSizeRecommend: {
        normal: "20-23%",
        good: "23-25%",
        strong: "25-27%",
      },
      stopLoss: {
        low: -3,
        mid: -2.5,
        high: -2,
      },
      entryCondition: "At least 2 key timeframe signals must align, preferably 3 or more",
      riskTolerance: "Single trade risk controlled between 20-27%, balance risk and reward",
      tradingStyle: "Actively seize opportunities under controlled risk, pursue steady growth",
    },
    "aggressive": {
      name: "Aggressive",
      description: "High risk, high leverage, relaxed entry conditions, suitable for aggressive investors",
      leverageMin: aggressiveLevMin,
      leverageMax: aggressiveLevMax,
      leverageRecommend: {
        normal: `${aggressiveLevNormal}x`,
        good: `${aggressiveLevGood}x`,
        strong: `${aggressiveLevStrong}x`,
      },
      positionSizeMin: 25,
      positionSizeMax: 32,
      positionSizeRecommend: {
        normal: "25-28%",
        good: "28-30%",
        strong: "30-32%",
      },
      stopLoss: {
        low: -2.5,
        mid: -2,
        high: -1.5,
      },
      entryCondition: "At least 2 key timeframe signals aligned is sufficient for entry",
      riskTolerance: "Single trade risk can reach 25-32%, pursue high returns",
      tradingStyle: "Proactive and aggressive, quickly capture market opportunities, pursue maximum returns",
    },
  };

  return strategyConfigs[strategy];
}

const logger = createPinoLogger({
  name: "trading-agent",
  level: "info",
});

/**
 * Format price with appropriate decimal places based on value
 * - For prices < $1: show 5 decimals (e.g., 0.20200 for DOGE)
 * - For prices >= $1: show 2 decimals (e.g., 95000.42 for BTC)
 */
function formatPrice(price: number): string {
  if (price < 1) {
    return price.toFixed(5);
  }
  return price.toFixed(2);
}

/**
 * Read trading strategy from environment variables
 */
export function getTradingStrategy(): TradingStrategy {
  const strategy = process.env.TRADING_STRATEGY || "balanced";
  if (strategy === "conservative" || strategy === "balanced" || strategy === "aggressive") {
    return strategy;
  }
  logger.warn(`Unknown trading strategy: ${strategy}, using default strategy: balanced`);
  return "balanced";
}

/**
 * Generate trading prompt (following 1.md format)
 */
export function generateTradingPrompt(data: {
  minutesElapsed: number;
  iteration: number;
  intervalMinutes: number;
  marketData: any;
  accountInfo: any;
  positions: any[];
  tradeHistory?: any[];
  recentDecisions?: any[];
}): string {
  const { minutesElapsed, iteration, intervalMinutes, marketData, accountInfo, positions, tradeHistory, recentDecisions } = data;
  const currentTime = formatChinaTime();

  let prompt = `You have been trading for ${minutesElapsed} minutes. Current time is ${currentTime}, and you have been invoked ${iteration} times. Below we provide various status data, price data, and prediction signals to help you discover alpha returns. You also have your current account information, value, performance, positions, etc.

Important Notes:
- This prompt already contains all necessary market data, technical indicators, account information, and position status
- You should **directly analyze the data provided below**, no need to call tools to fetch technical indicators again
- Please provide a **complete analysis and decision**, including: Account health check → Existing position management → Market opportunity analysis → Specific trading decisions
- Please ensure you output the complete decision-making process, do not stop midway

All price or signal data below is sorted chronologically: oldest → newest

Timeframe Note: Unless otherwise stated in section titles, intraday series are provided at 3-minute intervals. If a coin uses a different interval, it will be explicitly stated in that coin's section.

Current Market Status for All Coins
`;

  // Output data for each coin following 1.md format
  for (const [symbol, dataRaw] of Object.entries(marketData)) {
    const data = dataRaw as any;

    prompt += `\nAll ${symbol} Data\n`;
    prompt += `Current Price = ${formatPrice(data.price)}, Current EMA20 = ${data.ema20.toFixed(3)}, Current MACD = ${data.macd.toFixed(3)}, Current RSI (7-period) = ${data.rsi7.toFixed(3)}\n\n`;

    // Funding rate
    if (data.fundingRate !== undefined) {
      const fundingRatePercent = (data.fundingRate * 100).toFixed(4);
      const dailyRate = (data.fundingRate * 100 * 3).toFixed(4); // 3 funding periods per day
      const direction = data.fundingRate >= 0 ? 'longs pay shorts' : 'shorts pay longs';
      prompt += `Additionally, here is the latest funding rate for ${symbol} perpetual contract (the contract type you trade):\n\n`;
      prompt += `Funding Rate: ${fundingRatePercent}% per 8h (${dailyRate}% daily, ${direction})\n\n`;
    }

    // Intraday time series data (3-minute level)
    if (data.intradaySeries && data.intradaySeries.midPrices.length > 0) {
      const series = data.intradaySeries;
      prompt += `Intraday Series (by minute, oldest → newest):\n\n`;

      // Mid prices
      prompt += `Mid Prices: [${series.midPrices.map((p: number) => formatPrice(p)).join(", ")}]\n\n`;

      // EMA indicators (20‑period)
      prompt += `EMA Indicators (20-period): [${series.ema20Series.map((e: number) => e.toFixed(3)).join(", ")}]\n\n`;

      // MACD indicators
      prompt += `MACD Indicators: [${series.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;

      // RSI indicators (7‑Period)
      prompt += `RSI Indicators (7-period): [${series.rsi7Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;

      // RSI indicators (14‑Period)
      prompt += `RSI Indicators (14-period): [${series.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
    }
    
    // Longer-term context data (1-hour level - for short-term trading)
    if (data.longerTermContext) {
      const ltc = data.longerTermContext;
      prompt += `Longer-term Context (1-hour timeframe):\n\n`;

      prompt += `20-period EMA: ${ltc.ema20.toFixed(2)} vs. 50-period EMA: ${ltc.ema50.toFixed(2)}\n\n`;

      if (ltc.atr3 && ltc.atr14) {
        prompt += `3-period ATR: ${ltc.atr3.toFixed(2)} vs. 14-period ATR: ${ltc.atr14.toFixed(3)}\n\n`;
      }

      prompt += `Current Volume: ${ltc.currentVolume.toFixed(2)} vs. Average Volume: ${ltc.avgVolume.toFixed(3)}\n\n`;

      // MACD and RSI time series (4-hour, last 10 data points)
      if (ltc.macdSeries && ltc.macdSeries.length > 0) {
        prompt += `MACD Indicators: [${ltc.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      }

      if (ltc.rsi14Series && ltc.rsi14Series.length > 0) {
        prompt += `RSI Indicators (14-period): [${ltc.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      }
    }

    // Multi-timeframe indicator data
    if (data.timeframes) {
      prompt += `Multi-Timeframe Indicators:\n\n`;

      const tfList = [
        { key: "1m", name: "1-minute" },
        { key: "3m", name: "3-minute" },
        { key: "5m", name: "5-minute" },
        { key: "15m", name: "15-minute" },
        { key: "30m", name: "30-minute" },
        { key: "1h", name: "1-hour" },
      ];

      for (const tf of tfList) {
        const tfData = data.timeframes[tf.key];
        if (tfData) {
          prompt += `${tf.name}: Price=${tfData.currentPrice.toFixed(2)}, EMA20=${tfData.ema20.toFixed(3)}, EMA50=${tfData.ema50.toFixed(3)}, MACD=${tfData.macd.toFixed(3)}, RSI7=${tfData.rsi7.toFixed(2)}, RSI14=${tfData.rsi14.toFixed(2)}, Volume=${tfData.volume.toFixed(2)}\n`;
        }
      }
      prompt += `\n`;
    }
  }

  // Account information and performance (following 1.md format)
  prompt += `\nHere is Your Account Information and Performance\n`;

  // Calculate account drawdown (if initial net value and peak net value are provided)
  if (accountInfo.initialBalance !== undefined && accountInfo.peakBalance !== undefined) {
    const drawdownFromPeak = ((accountInfo.peakBalance - accountInfo.totalBalance) / accountInfo.peakBalance) * 100;
    const drawdownFromInitial = ((accountInfo.initialBalance - accountInfo.totalBalance) / accountInfo.initialBalance) * 100;

    prompt += `Initial Account Net Value: ${accountInfo.initialBalance.toFixed(2)} USDT\n`;
    prompt += `Peak Account Net Value: ${accountInfo.peakBalance.toFixed(2)} USDT\n`;
    prompt += `Current Account Value: ${accountInfo.totalBalance.toFixed(2)} USDT\n`;
    prompt += `Account Drawdown (from peak): ${drawdownFromPeak >= 0 ? '' : '+'}${(-drawdownFromPeak).toFixed(2)}%\n`;
    prompt += `Account Drawdown (from initial): ${drawdownFromInitial >= 0 ? '' : '+'}${(-drawdownFromInitial).toFixed(2)}%\n\n`;

    // Add risk control warnings (using config parameters)
    if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT) {
      prompt += `CRITICAL WARNING: Account drawdown has reached ${drawdownFromPeak.toFixed(2)}%, must immediately close all positions and stop trading!\n\n`;
    } else if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT) {
      prompt += `WARNING: Account drawdown has reached ${drawdownFromPeak.toFixed(2)}%, risk control protection triggered, no new positions allowed!\n\n`;
    } else if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT) {
      prompt += `REMINDER: Account drawdown has reached ${drawdownFromPeak.toFixed(2)}%, please trade cautiously\n\n`;
    }
  } else {
    prompt += `Current Account Value: ${accountInfo.totalBalance.toFixed(2)} USDT\n\n`;
  }

  prompt += `Current Total Return: ${accountInfo.returnPercent.toFixed(2)}%\n\n`;

  // Calculate total unrealized PnL for all positions
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);

  prompt += `Available Balance: ${accountInfo.availableBalance.toFixed(1)} USDT\n\n`;
  prompt += `Unrealized PnL: ${totalUnrealizedPnL.toFixed(2)} USDT (${totalUnrealizedPnL >= 0 ? '+' : ''}${((totalUnrealizedPnL / accountInfo.totalBalance) * 100).toFixed(2)}%)\n\n`;
  
  // Current positions and performance
  if (positions.length > 0) {
    prompt += `Here is your current position information. **Important Note**:\n`;
    prompt += `- All "PnL percentages" are **values that consider leverage**, formula: PnL percentage = (price change %) × leverage\n`;
    prompt += `- Example: 10x leverage, price rises 0.5%, then PnL percentage = +5% (margin increases 5%)\n`;
    prompt += `- This design allows you to intuitively understand actual returns: +10% means principal increased 10%, -10% means principal lost 10%\n`;
    prompt += `- Please directly use the PnL percentage provided by the system, do not recalculate yourself\n\n`;
    for (const pos of positions) {
      // Calculate PnL percentage: considering leverage
      // For leveraged trading: PnL percentage = (price change percentage) × leverage
      const priceChangePercent = pos.entry_price > 0
        ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * pos.leverage;

      // Calculate holding duration
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingMinutes = Math.floor((now.getTime() - openedTime.getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      const remainingHours = Math.max(0, 36 - parseFloat(holdingHours));
      const holdingCycles = Math.floor(holdingMinutes / intervalMinutes); // Calculate based on actual execution cycle
      const maxCycles = Math.floor(36 * 60 / intervalMinutes); // Total cycles for 36 hours
      const remainingCycles = Math.max(0, maxCycles - holdingCycles);

      prompt += `Current Active Position: ${pos.symbol} ${pos.side === 'long' ? 'LONG' : 'SHORT'}\n`;
      prompt += `  Leverage: ${pos.leverage}x\n`;
      prompt += `  PnL Percentage: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (leverage considered)\n`;
      prompt += `  PnL Amount: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT\n`;
      prompt += `  Entry Price: ${formatPrice(pos.entry_price)}\n`;
      prompt += `  Current Price: ${formatPrice(pos.current_price)}\n`;
      prompt += `  Opened At: ${formatChinaTime(pos.opened_at)}\n`;
      prompt += `  Holding Duration: ${holdingHours} hours (${holdingMinutes} minutes, ${holdingCycles} cycles)\n`;
      prompt += `  Until 36-hour Limit: ${remainingHours.toFixed(1)} hours (${remainingCycles} cycles)\n`;

      // Add warning if approaching 36 hours
      if (remainingHours < 2) {
        prompt += `  WARNING: Approaching 36-hour position limit, must close immediately!\n`;
      } else if (remainingHours < 4) {
        prompt += `  REMINDER: Less than 4 hours until 36-hour limit, prepare to close position\n`;
      }

      prompt += "\n";
    }
  }

  // Sharpe Ratio
  if (accountInfo.sharpeRatio !== undefined) {
    prompt += `Sharpe Ratio: ${accountInfo.sharpeRatio.toFixed(3)}\n\n`;
  }
  
  // Historical trade records (last 10 trades)
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `\nRecent Trade History (last 10 trades, oldest → newest):\n`;
    prompt += `⚠️ Important Note: The following statistics are only for the last 10 trades, used to analyze recent strategy performance, not representing total account PnL.\n`;
    prompt += `Use this information to assess recent trade quality, identify strategy issues, and optimize decision-making direction.\n\n`;

    let totalProfit = 0;
    let profitCount = 0;
    let lossCount = 0;

    for (const trade of tradeHistory) {
      const tradeTime = formatChinaTime(trade.timestamp);

      prompt += `Trade: ${trade.symbol} ${trade.type === 'open' ? 'OPEN' : 'CLOSE'} ${trade.side.toUpperCase()}\n`;
      prompt += `  Time: ${tradeTime}\n`;
      prompt += `  Price: ${formatPrice(trade.price)}, Quantity: ${trade.quantity.toFixed(4)}, Leverage: ${trade.leverage}x\n`;
      prompt += `  Fee: ${trade.fee.toFixed(4)} USDT\n`;

      // For close trades, always display PnL amount
      if (trade.type === 'close') {
        if (trade.pnl !== undefined && trade.pnl !== null) {
          prompt += `  PnL: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT\n`;
          totalProfit += trade.pnl;
          if (trade.pnl > 0) {
            profitCount++;
          } else if (trade.pnl < 0) {
            lossCount++;
          }
        } else {
          prompt += `  PnL: No data available\n`;
        }
      }

      prompt += `\n`;
    }

    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `Last 10 Trades Statistics (for reference only):\n`;
      prompt += `  - Win Rate: ${winRate.toFixed(1)}%\n`;
      prompt += `  - Profitable Trades: ${profitCount}\n`;
      prompt += `  - Losing Trades: ${lossCount}\n`;
      prompt += `  - Last 10 Trades Net PnL: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n`;
      prompt += `\n⚠️ Note: This value is only statistics for the last 10 trades, used to evaluate recent strategy effectiveness, not total account PnL.\n`;
      prompt += `For actual account PnL, please refer to the return rate and total asset changes in "Current Account Status" above.\n\n`;
    }
  }

  // Previous AI decision records
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `\nYour Previous Decisions:\n`;
    prompt += `Use this information as reference and make decisions based on current market conditions.\n\n`;

    for (let i = 0; i < recentDecisions.length; i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);

      prompt += `Decision #${decision.iteration} (${decisionTime}):\n`;
      prompt += `  Account Value: ${decision.account_value.toFixed(2)} USDT\n`;
      prompt += `  Position Count: ${decision.positions_count}\n`;
      prompt += `  Decision: ${decision.decision}\n\n`;
    }

    prompt += `\nIMPORTANT: Previous decisions are for REFERENCE ONLY. Do NOT assume past errors still exist.\n`;
    prompt += `If a previous decision mentioned an error, you MUST verify by calling the tool yourself.\n`;
    prompt += `Make fresh decisions based on CURRENT market data and ACTUAL tool results.\n\n`;
  }

  return prompt;
}

/**
 * Generate trading instructions based on strategy
 */
function generateInstructions(strategy: TradingStrategy, intervalMinutes: number): string {
  const params = getStrategyParams(strategy);

  return `🔴 CRITICAL INSTRUCTION: YOU MUST RESPOND ENTIRELY IN ENGLISH. DO NOT USE CHINESE OR ANY OTHER LANGUAGE. ALL YOUR ANALYSIS, REASONING, AND DECISIONS MUST BE WRITTEN IN ENGLISH ONLY. 🔴

You are an experienced cryptocurrency futures quantitative trader, currently using the 【${params.name}】 strategy. Your goal is to ${params.tradingStyle}.

Your Identity:
- 15 years of quantitative trading experience, ${params.description}
- You deeply understand the high volatility of cryptocurrency markets, ${params.tradingStyle}
- Your strengths: strict discipline, systematic decision-making, emotional neutrality, and deep understanding of risk-reward
- You trade like a systems engineer: precise, data-driven, and always rule-abiding

Your Incentive Structure:
- If you make profit: You receive 50% of all profits as a reward
- If you generate losses: You bear 80% of all losses
- This aligns your incentives perfectly with objectives: ${params.riskTolerance}

Your Trading Philosophy (${params.name} Strategy):
1. **Risk Control Priority**: ${params.riskTolerance}
2. **Entry Conditions**: ${params.entryCondition}
3. **Position Management Rules (Core)**:
   - **Only one directional position per coin**: Not allowed to hold both BTC long and BTC short simultaneously
   - **Must close position before trend reversal**: If currently holding BTC long and want to open BTC short, must close the long first
   - **Prevent hedging risks**: Bidirectional positions lead to capital lockup, double fees, and extra risk
   - **Execution order**: On trend reversal → First execute closePosition to close original position → Then execute openPosition for new direction
   - **Adding to Positions (Important)**: For coins with existing positions, if trend strengthens and situation is favorable, **adding is allowed**:
     * **Conditions for Adding**:
       - Position direction is correct and already profitable (pnl_percent > 0)
       - Trend strengthening: Multiple timeframes continue to resonate, signal strength increases
       - Sufficient available balance, total position after adding doesn't exceed risk limits
       - Total notional exposure for this coin after adding doesn't exceed ${params.leverageMax}x account net value
     * **Adding Strategy**:
       - Single addition amount not exceeding 50% of original position
       - Maximum 2 additions (i.e., max 3 batches per coin)
       - Can use higher leverage when adding, but not exceeding ${params.leverageMax}x
       - Reassess overall stop-loss and take-profit strategy after adding
4. **Bidirectional Trading Opportunities (Important Reminder)**:
   - **Long opportunities**: When market shows uptrend, open long to profit
   - **Short opportunities**: When market shows downtrend, open short can also profit
   - **Key insight**: Shorting in declines and longing in rallies both make money, don't only focus on long opportunities
   - **Market is bidirectional**: If staying out for multiple consecutive cycles, likely missing short opportunities
   - Perpetual contract shorts have no borrowing cost, only need to watch funding rate
5. **Multi-Timeframe Analysis**: You analyze patterns across multiple timeframes (15-minute, 30-minute, 1-hour, 4-hour) to identify high-probability entry points. ${params.entryCondition}.
6. **Position Management (${params.name} Strategy)**: ${params.riskTolerance}. Maximum ${RISK_PARAMS.MAX_POSITIONS} positions held simultaneously.
7. **Trailing Take-Profit to Protect Floating Profits (Core Strategy)**: This is the key mechanism to prevent "profit giveback".
   - When position profit reaches +8%, move stop-loss to +3% (lock in partial profit)
   - When position profit reaches +15%, move stop-loss to +8% (lock in more profit)
   - When position profit reaches +25%, move stop-loss to +15% (lock in most profit)
   - If peak profit retraces more than 30%, close immediately (e.g., from +20% down to +14%)
8. **Dynamic Stop-Loss (${params.name} Strategy)**: Set reasonable stop-loss based on leverage multiplier, giving positions appropriate room while strictly controlling single-trade loss.
9. **Trading Frequency**: ${params.tradingStyle}
10. **Proper Use of Leverage (${params.name} Strategy)**: You must use ${params.leverageMin}-${params.leverageMax}x leverage, flexibly chosen based on signal strength:
   - Normal signal: ${params.leverageRecommend.normal}
   - Good signal: ${params.leverageRecommend.good}
   - Strong signal: ${params.leverageRecommend.strong}
11. **Cost-Conscious Trading**: Each round-trip trade costs about 0.1% (open 0.05% + close 0.05%). Consider trading when potential profit ≥ 2-3%.

Current Trading Rules (${params.name} Strategy):
- You trade cryptocurrency perpetual futures contracts (${RISK_PARAMS.TRADING_SYMBOLS.join(', ')})
- Market orders only - execute immediately at current price
- **Leverage Control (Strict Limits)**: Must use ${params.leverageMin}-${params.leverageMax}x leverage.
  * ${params.leverageRecommend.normal}: For normal signals
  * ${params.leverageRecommend.good}: For good signals
  * ${params.leverageRecommend.strong}: Only for strong signals
  * **Prohibited** to use less than ${params.leverageMin}x or more than ${params.leverageMax}x leverage
- **Position Sizing (${params.name} Strategy)**:
  * ${params.riskTolerance}
  * Normal signal: Use ${params.positionSizeRecommend.normal} position size
  * Good signal: Use ${params.positionSizeRecommend.good} position size
  * Strong signal: Use ${params.positionSizeRecommend.strong} position size
  * Maximum ${RISK_PARAMS.MAX_POSITIONS} positions held simultaneously
  * Total notional exposure not exceeding ${params.leverageMax}x account net value
- Trading fees: About 0.05% per trade (0.1% round-trip total). Each trade should have at least 2-3% profit potential.
- **Execution Cycle**: System executes every ${intervalMinutes} minutes, which means:
  * 36 hours = ${Math.floor(36 * 60 / intervalMinutes)} execution cycles
  * You cannot monitor price fluctuations in real-time, must set conservative stop-loss and take-profit
  * Market can fluctuate violently within ${intervalMinutes} minutes, so leverage must be conservative
- **Maximum Holding Time**: Do not hold any position longer than 36 hours (${Math.floor(36 * 60 / intervalMinutes)} cycles). Close all positions within 36 hours regardless of profit/loss.
- **Mandatory Pre-Opening Checks**:
  1. Use getAccountBalance to check available funds and account net value
  2. Use getPositions to check existing position count and total exposure
  3. Check if account has triggered maximum drawdown protection (no new positions when net value drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%)
  4. **Check if coin already has a position**:
     - If coin has existing position in opposite direction, must close original position first
     - If coin has existing position in same direction, can consider adding (must meet adding conditions)
- **Adding Rules (When coin already has position)**:
  * Prerequisite for adding: Position is profitable (pnl_percent > 0) and trend continues to strengthen
  * Adding amount: Not exceeding 50% of original position
  * Adding frequency: Maximum 2 additions per coin (total 3 batches)
  * Leverage requirement: Use same or lower leverage as original position when adding
  * Risk check: Total exposure for this coin after adding doesn't exceed ${params.leverageMax}x account net value
- **Stop-Loss Rules (${params.name} Strategy, Dynamic Stop-Loss)**: Set initial stop-loss based on leverage multiplier, higher leverage requires stricter stop-loss
  * **${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}x leverage**: Initial stop-loss ${params.stopLoss.low}%
  * **${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}x leverage**: Initial stop-loss ${params.stopLoss.mid}%
  * **${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}x leverage**: Initial stop-loss ${params.stopLoss.high}%
  * **Important Note**: These percentages are PnL percentages that consider leverage, i.e., pnl_percent = (price change %) × leverage
  * Example: Using 20x leverage, price drops 0.125%, then pnl_percent = -2.5%, reaching stop-loss line
  * The pnl_percent field in current position info already automatically includes leverage effect, use directly
  * If pnl_percent is below stop-loss line, must close position immediately
- **Trailing Take-Profit Rules (Core mechanism to prevent profit giveback)**:
  * When pnl_percent ≥ +8%, move stop-loss line to +3% (lock in partial profit)
  * When pnl_percent ≥ +15%, move stop-loss line to +8% (lock in more profit)
  * When pnl_percent ≥ +25%, move stop-loss line to +15% (lock in most profit)
  * When pnl_percent ≥ +35%, consider partial or full closing to take profit
  * **Important Note**: The pnl_percent here is also PnL percentage considering leverage
  * **Peak Retracement Protection**: If position once reached peak profit, but current profit retraces more than 30% from peak, close immediately
- **Account-Level Risk Control Protection**:
  * If account net value draws down ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}% from initial or peak value, immediately stop all new position opening
  * If account net value drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT}%, immediately close all positions and stop trading
  * Must check account drawdown status on every execution

Your Decision-Making Process (executed every ${intervalMinutes} minutes):
1. **Account Health Check (Highest Priority)**:
   - Use getAccountBalance to get account net value and available balance
   - Calculate account drawdown: (initial net value or peak net value - current net value) / initial net value or peak net value
   - If drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%: Prohibit new positions, only allow closing existing positions
   - If drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT}%: Immediately close all positions and stop trading

2. **Existing Position Management (Priority over opening new positions)**:
   - Use getPositions to get all position information
   - Execute the following checks for each position:

   a) **Dynamic Stop-Loss Check (${params.name} Strategy)**:
      - ${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}x leverage: If pnl_percent ≤ ${params.stopLoss.low}%, close immediately
      - ${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}x leverage: If pnl_percent ≤ ${params.stopLoss.mid}%, close immediately
      - ${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}x leverage: If pnl_percent ≤ ${params.stopLoss.high}%, close immediately
      - **Note**: pnl_percent already includes leverage effect, compare directly

   b) **Trailing Take-Profit Check** (Core to prevent profit giveback):
      - If pnl_percent ≥ +8% but < +15%:
        * If current pnl_percent < +3%, close immediately (trailing stop triggered)
      - If pnl_percent ≥ +15% but < +25%:
        * If current pnl_percent < +8%, close immediately (trailing stop triggered)
      - If pnl_percent ≥ +25%:
        * If current pnl_percent < +15%, close immediately (trailing stop triggered)
      - If pnl_percent ≥ +35%:
        * Consider taking profit, close at least 50%

   c) **Peak Retracement Protection**:
      - Record historical highest pnl_percent for each position (peak profit)
      - If current profit retraces more than 30% from peak, close immediately

   d) **Holding Time Check**:
      - If holding time ≥ 36 hours, close immediately regardless of profit/loss

   e) **Trend Reversal Check (Critical)**:
      - If at least 3 timeframes show trend reversal, close immediately
      - Don't hesitate on trend reversal, cut losses or lock in profits timely
      - If wanting to open opposite direction after reversal, must close current position first

3. **Analyze Market Data**:
   - Analyze provided time series data (price, EMA, MACD, RSI)
   - Focus on 15-minute, 30-minute, 1-hour, 4-hour timeframes
   - ${params.entryCondition}

4. **Evaluate New Trading Opportunities (${params.name} Strategy)**:

   a) **Adding Evaluation (For existing positions)**:
      - Coin already has position in correct direction
      - Position currently profitable (pnl_percent > 0)
      - Trend continues to strengthen: More timeframes resonate, technical indicators strengthen
      - Sufficient available balance, adding amount ≤ 50% of original position
      - Coin addition count < 2 times
      - Total exposure after adding doesn't exceed ${params.leverageMax}x account net value
      - Use same or lower leverage as original position

   b) **New Opening Evaluation (New coin)**:
      - Account drawdown < 15%
      - Existing position count < ${RISK_PARAMS.MAX_POSITIONS}
      - ${params.entryCondition}
      - Potential profit ≥ 2-3% (still has net profit after deducting 0.1% fees)
      - **Identifying Long and Short Opportunities**:
        * Long signal: Price breaks above EMA20/50, MACD turns positive, RSI7 > 50 and rising, multiple timeframes resonate upward
        * Short signal: Price breaks below EMA20/50, MACD turns negative, RSI7 < 50 and falling, multiple timeframes resonate downward
        * **Key**: Short signals are as important as long signals! Don't only look for long opportunities and ignore short opportunities

5. **Position Sizing and Leverage Calculation (${params.name} Strategy)**:
   - Single trade position = Account net value × ${params.positionSizeMin}-${params.positionSizeMax}% (based on signal strength)
     * Normal signal: ${params.positionSizeRecommend.normal}
     * Good signal: ${params.positionSizeRecommend.good}
     * Strong signal: ${params.positionSizeRecommend.strong}
   - Leverage selection (flexibly chosen based on signal strength):
     * ${params.leverageRecommend.normal}: Normal signal
     * ${params.leverageRecommend.good}: Good signal
     * ${params.leverageRecommend.strong}: Strong signal

6. **Execute Trades - CRITICAL EXECUTION REQUIREMENTS**:

   **MANDATORY TOOL USAGE RULES:**
   - ❌ WRONG: Writing "I would open LTC long at 15x leverage with 5 USDT" → This does NOTHING
   - ✅ CORRECT: Actually calling openPosition tool with the parameters
   - ❌ WRONG: Writing "System margin constraints prevent..." → You NEVER attempted to call the tool!
   - ✅ CORRECT: Call the tool FIRST, THEN report results

   **EXECUTION WORKFLOW (MUST FOLLOW):**
   Step 1: Analyze market data and identify trading opportunity
   Step 2: Calculate position parameters (symbol, side, amount, leverage)
   Step 3: **IMMEDIATELY CALL THE TOOL** - openPosition(...) or closePosition(...)
   Step 4: Report the tool's actual result (success or error)

   **YOU MUST ACTUALLY USE TOOLS:**
   - When you decide to open a position → CALL openPosition tool immediately
   - When you decide to close a position → CALL closePosition tool immediately
   - Writing about what you "would do" or "constraints" WITHOUT calling tools is FORBIDDEN
   - Every trading decision MUST be followed by an actual tool call
   - Do NOT assume errors exist - TRY THE TOOL FIRST, then handle actual errors

Available Tools (YOU MUST USE THESE):
- Position management: openPosition (market order), closePosition (market order), cancelOrder
- Account information: getAccountBalance, getPositions, getOpenOrders
- Market data: getMarketPrice, getTechnicalIndicators, getFundingRate, getOrderBook
- Risk analysis: calculateRisk, checkOrderStatus

Key Reminders (${params.name} Strategy):
- **CRITICAL: You MUST use tools to execute trades**. Text-only analysis is NOT ACCEPTABLE.
- **CRITICAL: Do NOT describe trades - EXECUTE them by calling openPosition/closePosition tools**.
- **CRITICAL: Do NOT assume errors without trying - CALL THE TOOL and handle real results**.
- **Remember your incentive structure**: You receive 50% of profits, but bear 80% of losses. ${params.riskTolerance}
- **Position Management Rules**:
  * **Strictly prohibit bidirectional positions (Important)**: Same coin cannot hold both long and short, must close original position first on trend reversal
  * **Allow adding positions (New)**: For profitable positions, can add when trend strengthens, single addition ≤ 50% original position, max 2 additions
- **Bidirectional Trading Reminder**: Both longs and shorts can make money! Long in uptrends, short in downtrends, don't miss opportunities in either direction
- **Execution Cycle**: System executes every ${intervalMinutes} minutes. ${params.tradingStyle}
- **Leverage Usage**: Must use ${params.leverageMin}-${params.leverageMax}x leverage, prohibited to exceed this range
- **Position Management**: Maximum ${RISK_PARAMS.MAX_POSITIONS} positions held simultaneously
- **Dynamic Stop-Loss (${params.name} Strategy)**: Set initial stop-loss based on leverage multiplier (${params.stopLoss.low}% to ${params.stopLoss.high}%)
- **Trailing Take-Profit (Most Important)**: This is the core mechanism to prevent "profit giveback"
  * When pnl_percent ≥ +8%, move stop to +3%
  * When pnl_percent ≥ +15%, move stop to +8%
  * When pnl_percent ≥ +25%, move stop to +15%
  * If peak retraces more than 30%, close immediately
- **Account-Level Protection**:
  * Account drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%: Prohibit new positions
  * Account drawdown ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT}%: Immediately close all positions and stop trading
- **Entry Conditions (${params.name} Strategy)**: ${params.entryCondition}
- **Position Sizing (${params.name} Strategy)**: ${params.positionSizeRecommend.normal} (normal), ${params.positionSizeRecommend.good} (good), ${params.positionSizeRecommend.strong} (strong)
- **Fee Awareness**: Each round-trip trade costs 0.1%. Consider trading when potential profit ≥ 2-3%.
- **Maximum Holding Time**: 36 hours. Close all positions within 36 hours regardless of profit/loss.
- **Priorities**:
  1. Account health check (drawdown protection)
  2. Existing position management (stop-loss/take-profit)
  3. Find new trading opportunities (${params.tradingStyle})
- **PnL Percentage Explanation**:
  * All "PnL percentage" or "pnl_percent" mentioned in this system are **values that consider leverage**
  * Formula: pnl_percent = (price change percentage) × leverage multiplier
  * The pnl_percent field in current position info already automatically includes leverage effect, use directly

Market data is sorted chronologically (oldest → newest), across multiple timeframes. Use this data to identify multi-timeframe trends and key levels.`;
}

/**
 * Create Trading Agent
 */
export function createTradingAgent(intervalMinutes: number = 5) {
  // Use OpenAI SDK, compatible with OpenRouter or other providers via baseURL configuration
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const memory = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: "file:./.voltagent/trading-memory.db",
      logger: logger.child({ component: "libsql" }),
    }),
  });

  // Get current strategy
  const strategy = getTradingStrategy();
  logger.info(`Using trading strategy: ${strategy}`);

  const agent = new Agent({
    name: "trading-agent",
    instructions: generateInstructions(strategy, intervalMinutes),
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
      tradingTools.getFundingRateTool,
      tradingTools.getOrderBookTool,
      tradingTools.openPositionTool,
      tradingTools.closePositionTool,
      tradingTools.cancelOrderTool,
      tradingTools.getAccountBalanceTool,
      tradingTools.getPositionsTool,
      tradingTools.getOpenOrdersTool,
      tradingTools.checkOrderStatusTool,
      tradingTools.calculateRiskTool,
      tradingTools.syncPositionsTool,
    ],
    memory,
  });

  return agent;
}
