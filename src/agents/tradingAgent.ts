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
 * Trading Agent Configuration（极简版)
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
 * Read account risk config from environment variables
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
export type TradingStrategy = "conservative" | "balanced" | "aggressive" | "ultra-short" | "swing-trend";

/**
 * Strategy Parameter Configuration
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
  trailingStop: {
    // Trailing stop ladder config [trigger profit, move stop-loss line]
    level1: { trigger: number; stopAt: number };
    level2: { trigger: number; stopAt: number };
    level3: { trigger: number; stopAt: number };
  };
  partialTakeProfit: {
    // Partial take-profit config（根据策略杠杆调整)
    stage1: { trigger: number; closePercent: number }; // Stage 1: CLOSE 50%
    stage2: { trigger: number; closePercent: number }; // Stage 2: CLOSE remaining 50%
    stage3: { trigger: number; closePercent: number }; // Stage 3: close all
  };
  peakDrawdownProtection: number; // peak drawdown protectionthreshold（百分比)
  volatilityAdjustment: {
    // Volatility adjustment factor
    highVolatility: { leverageFactor: number; positionFactor: number }; // ATR > 5%
    normalVolatility: { leverageFactor: number; positionFactor: number }; // ATR 2-5%
    lowVolatility: { leverageFactor: number; positionFactor: number }; // ATR < 2%
  };
  entryCondition: string;
  riskTolerance: string;
  tradingStyle: string;
  // Auto-monitor stop-loss config（仅 swing-trend 策略使用)
  codeLevelStopLoss?: {
    lowRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
    mediumRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
    highRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
  };
  // Auto-monitor trailing stop config（仅 swing-trend 策略使用)
  codeLevelTrailingStop?: {
    stage1: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage2: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage3: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage4: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage5: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
  };
}

/**
 * Get strategy params（基于 MAX_LEVERAGE 动态计算)
 */
export function getStrategyParams(strategy: TradingStrategy): StrategyParams {
  const maxLeverage = RISK_PARAMS.MAX_LEVERAGE;
  
  // Dynamically calculate leverage range for each strategy based on MAX_LEVERAGE
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
    "ultra-short": {
      name: "Ultra-Short",
      description: "Very short cycle quick in-out, 5min execution, suitable for high-frequency trading",
      leverageMin: Math.max(3, Math.ceil(maxLeverage * 0.5)),
      leverageMax: Math.max(5, Math.ceil(maxLeverage * 0.75)),
      leverageRecommend: {
        normal: `${Math.max(3, Math.ceil(maxLeverage * 0.5))}x`,
        good: `${Math.max(4, Math.ceil(maxLeverage * 0.625))}x`,
        strong: `${Math.max(5, Math.ceil(maxLeverage * 0.75))}x`,
      },
      positionSizeMin: 18,
      positionSizeMax: 25,
      positionSizeRecommend: {
        normal: "18-20%",
        good: "20-23%",
        strong: "23-25%",
      },
      stopLoss: {
        low: -2.5,
        mid: -2,
        high: -1.5,
      },
      trailingStop: {
        // Ultra-short strategy: Quick profit-locking (5-minute cycle)
        level1: { trigger: 4, stopAt: 1.5 },   // When profit reaches +4%, move stop-loss to +1.5%
        level2: { trigger: 8, stopAt: 4 },     // When profit reaches +8%, move stop-loss to +4%
        level3: { trigger: 15, stopAt: 8 },    // When profit reaches +15%, move stop-loss to +8%
      },
      partialTakeProfit: {
        // Ultra-short strategy: Quick partial take-profit
        stage1: { trigger: 15, closePercent: 50 },  // +15% close 50%
        stage2: { trigger: 25, closePercent: 50 },  // +25% close remaining 50%
        stage3: { trigger: 35, closePercent: 100 }, // +35% close all
      },
      peakDrawdownProtection: 20, // Ultra-short: 20% peak drawdown protection (quick profit protection)
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.7, positionFactor: 0.8 },
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 },
        lowVolatility: { leverageFactor: 1.1, positionFactor: 1.0 },
      },
      entryCondition: "At least 2 timeframes signal consistency, prioritize 1-5 minute levels",
      riskTolerance: "Single trade risk controlled within 18-25%, quick in-out",
      tradingStyle: "Ultra-short trading, 5-minute execution cycle, quickly capture short-term volatility, strictly enforce 2% cycle profit-lock rule and 30-minute profit-taking rule",
    },
    "swing-trend": {
      name: "Swing-Trend",
      description: "Medium-long term swing trading, 20min execution, capture mid-term trends, suitable for steady growth",
      leverageMin: Math.max(2, Math.ceil(maxLeverage * 0.2)),
      leverageMax: Math.max(5, Math.ceil(maxLeverage * 0.5)),
      leverageRecommend: {
        normal: `${Math.max(2, Math.ceil(maxLeverage * 0.2))}x`,
        good: `${Math.max(3, Math.ceil(maxLeverage * 0.35))}x`,
        strong: `${Math.max(5, Math.ceil(maxLeverage * 0.5))}x`,
      },
      positionSizeMin: 20,
      positionSizeMax: 35,
      positionSizeRecommend: {
        normal: "20-25%",
        good: "25-30%",
        strong: "30-35%",
      },
      stopLoss: {
        low: -9,      // low leverage(2-3x)：-9%stop-loss（give trend enough space，slightly tightened1%)
        mid: -7.5,    // mid leverage(3-4x)：-7.5%stop-loss（slightly tightened0.5%)
        high: -5.5,   // high leverage(4-5x)：-5.5%stop-loss（slightly tightened0.5%)
      },
      trailingStop: {
        // Swing strategy: Give trend more space, lock profit later
        level1: { trigger: 15, stopAt: 8 },   // When profit reaches +15% 时，stop-loss线移至 +8%
        level2: { trigger: 30, stopAt: 20 },  // When profit reaches +30% 时，stop-loss线移至 +20%
        level3: { trigger: 50, stopAt: 35 },  // When profit reaches +50% 时，stop-loss线移至 +35%
      },
      partialTakeProfit: {
        // 波段策略：Later partial take-profit, maximize trend profit
        stage1: { trigger: 50, closePercent: 40 },  // +50% CLOSE40%（retain60%pursue greater profit)
        stage2: { trigger: 80, closePercent: 60 },  // +80% CLOSE剩余60%（累计CLOSE100%)
        stage3: { trigger: 120, closePercent: 100 },// +120% close all
      },
      peakDrawdownProtection: 35, // 波段策略：35%peak drawdown protection（give trend more space)
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.5, positionFactor: 0.6 },   // High volatility: significantly reduce risk
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // Normal volatility: standard configuration
        lowVolatility: { leverageFactor: 1.2, positionFactor: 1.1 },    // Low volatility: moderately increase（trend stable)
      },
      entryCondition: "Must have all 4 timeframes (1min, 3min, 5min, 15min) strongly aligned, weighted confluence analysis reaches STRONG level (total score ≥70 and alignment ≥75%), key indicators confluent (MACD, RSI, EMA direction aligned)",
      riskTolerance: "Single trade risk controlled within 20-35%, focus on trend quality not frequency",
      tradingStyle: "Swing-trend trading, 20-minute execution cycle, patiently wait for high-quality trend signals, holding time up to days, let profits run",
      // Auto-monitor stop-loss config（每10秒自动检查)
      codeLevelStopLoss: {
        lowRisk: {
          minLeverage: 5,
          maxLeverage: 7,
          stopLossPercent: -6,
          description: "5-7x杠杆，亏损 -6% 时stop-loss",
        },
        mediumRisk: {
          minLeverage: 8,
          maxLeverage: 12,
          stopLossPercent: -5,
          description: "8-12x杠杆，亏损 -5% 时stop-loss",
        },
        highRisk: {
          minLeverage: 13,
          maxLeverage: Infinity,
          stopLossPercent: -4,
          description: "13x以上杠杆，亏损 -4% 时stop-loss",
        },
      },
      // Auto-monitor trailing stop config（每10秒自动检查，5级规则)
      codeLevelTrailingStop: {
        stage1: {
          name: "阶段1",
          minProfit: 4,
          maxProfit: 6,
          drawdownPercent: 1.5,
          description: "峰值4-6%，回退1.5%CLOSE（保底2.5%)",
        },
        stage2: {
          name: "阶段2",
          minProfit: 6,
          maxProfit: 10,
          drawdownPercent: 2,
          description: "峰值6-10%，回退2%CLOSE（保底4%)",
        },
        stage3: {
          name: "阶段3",
          minProfit: 10,
          maxProfit: 15,
          drawdownPercent: 2.5,
          description: "峰值10-15%，回退2.5%CLOSE（保底7.5%)",
        },
        stage4: {
          name: "阶段4",
          minProfit: 15,
          maxProfit: 25,
          drawdownPercent: 3,
          description: "峰值15-25%，回退3%CLOSE（保底12%)",
        },
        stage5: {
          name: "阶段5",
          minProfit: 25,
          maxProfit: Infinity,
          drawdownPercent: 5,
          description: "峰值25%+，回退5%CLOSE（保底20%)",
        },
      },
    },
    "conservative": {
      name: "Conservative",
      description: "低风险low leverage，严格入场条件，适合保守投资者",
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
      trailingStop: {
        // 保守策略：较早锁定利润（基准：15x杠杆)
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 6, stopAt: 2 },   // 基准：When profit reaches +6% 时，stop-loss线移至 +2%
        level2: { trigger: 12, stopAt: 6 },  // 基准：When profit reaches +12% 时，stop-loss线移至 +6%
        level3: { trigger: 20, stopAt: 12 }, // 基准：When profit reaches +20% 时，stop-loss线移至 +12%
      },
      partialTakeProfit: {
        // 保守策略：较早分批止盈，提前锁定利润
        stage1: { trigger: 20, closePercent: 50 },  // +20% CLOSE50%
        stage2: { trigger: 30, closePercent: 50 },  // +30% CLOSE剩余50%
        stage3: { trigger: 40, closePercent: 100 }, // +40% close all
      },
      peakDrawdownProtection: 25, // 保守策略：25%peak drawdown protection（更早保护利润)
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.6, positionFactor: 0.7 },   // 高波动：大幅降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.0, positionFactor: 1.0 },    // 低波动：不调整（保守不追求)
      },
      entryCondition: "至少3个关键时间框架信号一致，4个或更多更佳",
      riskTolerance: "单笔交易风险控制在15-22%之间，严格控制回撤",
      tradingStyle: "谨慎交易，宁可错过机会也不冒险，优先保护本金",
    },
    "balanced": {
      name: "Balanced",
      description: "MODERATE等风险杠杆，合理入场条件，适合大多数投资者",
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
      trailingStop: {
        // 平衡策略：适MODERATE的移动止盈（基准：15x杠杆)
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 8, stopAt: 3 },   // 基准：When profit reaches +8% 时，stop-loss线移至 +3%
        level2: { trigger: 15, stopAt: 8 },  // 基准：When profit reaches +15% 时，stop-loss线移至 +8%
        level3: { trigger: 25, stopAt: 15 }, // 基准：When profit reaches +25% 时，stop-loss线移至 +15%
      },
      partialTakeProfit: {
        // 平衡策略：标准分批止盈
        stage1: { trigger: 30, closePercent: 50 },  // +30% CLOSE50%
        stage2: { trigger: 40, closePercent: 50 },  // +40% CLOSE剩余50%
        stage3: { trigger: 50, closePercent: 100 }, // +50% close all
      },
      peakDrawdownProtection: 30, // 平衡策略：30%peak drawdown protection（标准平衡点)
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.7, positionFactor: 0.8 },   // 高波动：适度降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.1, positionFactor: 1.0 },    // 低波动：略微提high leverage
      },
      entryCondition: "至少2个关键时间框架信号一致，3个或更多更佳",
      riskTolerance: "单笔交易风险控制在20-27%之间，平衡风险与收益",
      tradingStyle: "在风险可控前提下积极把握机会，追求稳健增长",
    },
    "aggressive": {
      name: "Aggressive",
      description: "高风险high leverage，宽松入场条件，适合激进投资者",
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
      trailingStop: {
        // 激进策略：更晚锁定，追求更高利润（基准：15x杠杆)
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 10, stopAt: 4 },  // 基准：When profit reaches +10% 时，stop-loss线移至 +4%
        level2: { trigger: 18, stopAt: 10 }, // 基准：When profit reaches +18% 时，stop-loss线移至 +10%
        level3: { trigger: 30, stopAt: 18 }, // 基准：When profit reaches +30% 时，stop-loss线移至 +18%
      },
      partialTakeProfit: {
        // 激进策略：更晚分批止盈，追求更高利润
        stage1: { trigger: 40, closePercent: 50 },  // +40% CLOSE50%
        stage2: { trigger: 50, closePercent: 50 },  // +50% CLOSE剩余50%
        stage3: { trigger: 60, closePercent: 100 }, // +60% close all
      },
      peakDrawdownProtection: 35, // 激进策略：35%peak drawdown protection（给利润更多奔跑空间)
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.8, positionFactor: 0.85 },  // 高波动：轻微降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.2, positionFactor: 1.1 },    // 低波动：提high leverage和仓位
      },
      entryCondition: "至少2个关键时间框架信号一致即可入场",
      riskTolerance: "单笔交易风险可达25-32%，追求高收益",
      tradingStyle: "积极进取，快速捕捉市场机会，追求最大化收益",
    },
  };

  return strategyConfigs[strategy];
}

const logger = createPinoLogger({
  name: "trading-agent",
  level: "info",
});

/**
 * 从环境变量读取交易策略
 */
export function getTradingStrategy(): TradingStrategy {
  const strategy = process.env.TRADING_STRATEGY || "balanced";
  if (strategy === "conservative" || strategy === "balanced" || strategy === "aggressive" || strategy === "ultra-short" || strategy === "swing-trend") {
    return strategy;
  }
  logger.warn(`未知的交易策略: ${strategy}，使用默认策略: balanced`);
  return "balanced";
}

/**
 * 生成交易提示词（参照 1.md 格式)
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
  
  // 获取当前策略参数（用于每周期STRONG调风控规则)
  const strategy = getTradingStrategy();
  const params = getStrategyParams(strategy);
  // 判断是否启用自动监控stop-loss和移动止盈（仅波段策略启用)
  const isCodeLevelProtectionEnabled = strategy === "swing-trend";
  
  let prompt = `[Trading Cycle #${iteration}]${currentTime}
Elapsed ${minutesElapsed} minutes, execution cycle ${intervalMinutes} minutes

==========================================
Current Strategy: ${params.name}（${params.description})
Target Monthly Return: ${params.name === '稳健' ? '10-20%' : params.name === '平衡' ? '20-40%' : '40%+'}
==========================================

【硬性风控底线 - 系统STRONG制execute]
+------------------------------------------+
| Single loss ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：STRONG制CLOSE               |
| Holding time ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}hours：STRONG制CLOSE             |
+------------------------------------------+

【AI战术决策 - STRONG烈建议遵守]
+------------------------------------------+
| 策略stop-loss：${params.stopLoss.low}% ~ ${params.stopLoss.high}%(based on leverage)|
| Partial take-profit:                                |
|   • Profit ≥+${params.partialTakeProfit.stage1.trigger}% → CLOSE${params.partialTakeProfit.stage1.closePercent}%  |
|   • Profit ≥+${params.partialTakeProfit.stage2.trigger}% → CLOSE${params.partialTakeProfit.stage2.closePercent}%  |
|   • Profit ≥+${params.partialTakeProfit.stage3.trigger}% → CLOSE${params.partialTakeProfit.stage3.closePercent}% |
| Peak drawdown: ≥${params.peakDrawdownProtection}% → 危险信号，立即CLOSE |
${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `|                                         |
| Note: Trailing stop executed by auto-monitor (every 10s) |
|   • ${params.codeLevelTrailingStop.stage1.description} |
|   • ${params.codeLevelTrailingStop.stage2.description} |
|   • ${params.codeLevelTrailingStop.stage3.description} |
|   • ${params.codeLevelTrailingStop.stage4.description} |
|   • ${params.codeLevelTrailingStop.stage5.description} |
|   • No manual AI trailing stop needed              |` : `|                                         |
| Note: Current strategy has no auto-monitor trailing stop      |
|   • AI must actively monitor peak drawdown and execute take-profit      |
|   • Profit${params.trailingStop.level1.trigger}%→stop-loss线${params.trailingStop.level1.stopAt}%   |
|   • Profit${params.trailingStop.level2.trigger}%→stop-loss线${params.trailingStop.level2.stopAt}%   |
|   • Profit${params.trailingStop.level3.trigger}%→stop-loss线${params.trailingStop.level3.stopAt}%   |`}
+------------------------------------------+

【决策流程 - 按优先级execute]
(1) Position Management (Top Priority):
   检查每个持仓的stop-loss/止盈/峰值回撤 → closePosition
   
(2) New Position Evaluation:
   Analyze market data → identify bilateral opportunities (long/short) → openPosition
   
(3) Add-on Evaluation:
   Profit>5%and trend reinforcement → openPosition（≤50%原仓位，相同或更low leverage)

==========================================

【data说明]
This prompt has preloaded all necessary data:
• Market data and technical indicators for all symbols (multi-timeframe)
• Weighted confluence analysis (quantify multi-timeframe signal strength, 0-100 score, with alignment and signal quality)
• Account info (balance, return rate, Sharpe ratio)
• 当前持仓状态（盈亏、Holding time、杠杆)
• Historical trades (last 10)

【您的任务]
Make trading decisions directly based on above data, no need to fetch again:
1. 分析持仓管理需求（stop-loss/止盈/加仓)→ 调用 closePosition / openPosition execute
2. Identify new trading opportunities (long/short) → call openPosition execute
3. Assess risk and position management → call calculateRisk verify

关键：您必须实际调用工具execute决策，不要只停留在分析阶段！

==========================================

All price/signal data below in chronological order: oldest → newest

时间框架说明：除非在章节标题MODERATE另有说明，否则日内序列以 3 minutes间隔提供。如果某个币种使用不同的间隔，将在该币种的章节MODERATE明确说明。

Current market status for all symbols
`;

  // 按照 1.md 格式输出每个币种的data
  for (const [symbol, dataRaw] of Object.entries(marketData)) {
    const data = dataRaw as any;
    
    prompt += `\nAll ${symbol} data\n`;
    prompt += `Current price = ${data.price.toFixed(1)}, Current EMA20 = ${data.ema20.toFixed(3)}, Current MACD = ${data.macd.toFixed(3)}, Current RSI (7-period) = ${data.rsi7.toFixed(3)}\n\n`;
    
    // 资金费率
    if (data.fundingRate !== undefined) {
      prompt += `Additionally, this is ${symbol} 永续合约的newest资金费率（您交易的合约类型)：\n\n`;
      prompt += `Funding rate: ${data.fundingRate.toExponential(2)}\n\n`;
    }
    
    // 日内时序data（3minutes级别)
    if (data.intradaySeries && data.intradaySeries.midPrices.length > 0) {
      const series = data.intradaySeries;
      prompt += `日内序列（按minutes，oldest → newest)：\n\n`;
      
      // Mid prices
      prompt += `Mid prices: [${series.midPrices.map((p: number) => p.toFixed(1)).join(", ")}]\n\n`;
      
      // EMA indicators (20‑period)
      prompt += `EMA indicators (20-period): [${series.ema20Series.map((e: number) => e.toFixed(3)).join(", ")}]\n\n`;
      
      // MACD indicators
      prompt += `MACD indicators: [${series.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (7‑Period)
      prompt += `RSI indicators (7-period): [${series.rsi7Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (14‑Period)
      prompt += `RSI indicators (14-period): [${series.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
    }
    
    // 更长期的上下文data（1hours级别 - 用于短线交易)
    if (data.longerTermContext) {
      const ltc = data.longerTermContext;
      prompt += `Longer-term context (1-hour timeframe):\n\n`;
      
      prompt += `20-period EMA: ${ltc.ema20.toFixed(2)} vs. 50-period EMA: ${ltc.ema50.toFixed(2)}\n\n`;
      
      if (ltc.atr3 && ltc.atr14) {
        prompt += `3-period ATR: ${ltc.atr3.toFixed(2)} vs. 14-period ATR: ${ltc.atr14.toFixed(3)}\n\n`;
      }
      
      prompt += `Current volume: ${ltc.currentVolume.toFixed(2)} vs. average volume: ${ltc.avgVolume.toFixed(3)}\n\n`;
      
      // MACD 和 RSI 时序（4hours，最近10个data点)
      if (ltc.macdSeries && ltc.macdSeries.length > 0) {
        prompt += `MACD indicators: [${ltc.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      }
      
      if (ltc.rsi14Series && ltc.rsi14Series.length > 0) {
        prompt += `RSI indicators (14-period): [${ltc.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      }
    }
    
    // 多时间框架指标data
    if (data.timeframes) {
      prompt += `Multi-timeframe indicators:\n\n`;
      
      const tfList = [
        { key: "1m", name: "1minutes" },
        { key: "3m", name: "3minutes" },
        { key: "5m", name: "5minutes" },
        { key: "15m", name: "15minutes" },
        { key: "30m", name: "30minutes" },
        { key: "1h", name: "1hours" },
      ];
      
      for (const tf of tfList) {
        const tfData = data.timeframes[tf.key];
        if (tfData) {
          prompt += `${tf.name}: price=${tfData.currentPrice.toFixed(2)}, EMA20=${tfData.ema20.toFixed(3)}, EMA50=${tfData.ema50.toFixed(3)}, MACD=${tfData.macd.toFixed(3)}, RSI7=${tfData.rsi7.toFixed(2)}, RSI14=${tfData.rsi14.toFixed(2)}, volume=${tfData.volume.toFixed(2)}\n`;
        }
      }
      prompt += `\n`;
    }

    // 加权共振分析（Phase 1优化新增)
    if (data.confluence) {
      const c = data.confluence;

      prompt += `【加权共振分析]\n`;
      prompt += `Overall direction: ${c.overallDirection === 'BULLISH' ? 'BULLISH' : c.overallDirection === 'BEARISH' ? 'BEARISH' : 'NEUTRAL'}\n`;
      prompt += `Signal quality: ${c.signalQuality === 'STRONG' ? 'STRONG' : c.signalQuality === 'MODERATE' ? 'MODERATE' : 'WEAK'}\n`;
      prompt += `Timeframe alignment: ${c.alignedTimeframes}/${c.totalTimeframes} (${c.alignmentPercent.toFixed(0)}%)\n`;
      prompt += `Weighted total score: ${c.totalScore.toFixed(1)}/100\n`;
      prompt += `Average score: ${c.averageScore.toFixed(1)}/50\n\n`;

      prompt += `Timeframe details:\n`;
      for (const score of c.scores) {
        const direction = score.signals.direction === 'BULLISH' ? '↗BULLISH' : score.signals.direction === 'BEARISH' ? '↘BEARISH' : '→NEUTRAL';
        prompt += `  ${score.interval} ${direction} (total: ${score.signals.totalScore.toFixed(1)}, weighted: ${score.weightedScore.toFixed(1)}, weight: ${score.weight.toFixed(1)}x)\n`;
        prompt += `    price-EMA20: ${score.signals.priceVsEma20.toFixed(1)}, price-EMA50: ${score.signals.priceVsEma50.toFixed(1)}, MACD: ${score.signals.macdStrength.toFixed(1)}, RSI: ${score.signals.rsiPosition.toFixed(1)}, volume: ${score.signals.volumeConfirmation.toFixed(1)}\n`;
      }

      prompt += `\nKey insights:\n`;
      if (c.signalQuality === 'STRONG' && c.alignmentPercent >= 75) {
        prompt += `  ✓ Strong signal confirmed: ${c.alignmentPercent.toFixed(0)}% timeframes confluent ${c.overallDirection === 'BULLISH' ? 'BULLISH' : c.overallDirection === 'BEARISH' ? 'BEARISH' : ''}, weighted total score ${c.totalScore.toFixed(0)}, recommend prioritizing this direction\n`;
      } else if (c.signalQuality === 'MODERATE' && c.alignmentPercent >= 60) {
        prompt += `  ~ Moderate signal: ${c.alignmentPercent.toFixed(0)}% timeframes confluent, weighted total score ${c.totalScore.toFixed(0)}, recommend combining with other factors\n`;
      } else {
        prompt += `  ! Weak/mixed signal: alignment only ${c.alignmentPercent.toFixed(0)}%, total score ${c.totalScore.toFixed(0)}, trade cautiously or observe\n`;
      }
      prompt += `\n`;
    }
  }

  // 账户信息和表现（参照 1.md 格式)
  prompt += `\nBelow is your account info and performance\n`;
  
  // 计算账户回撤（如果提供了初始净值和峰值净值)
  if (accountInfo.initialBalance !== undefined && accountInfo.peakBalance !== undefined) {
    const drawdownFromPeak = ((accountInfo.peakBalance - accountInfo.totalBalance) / accountInfo.peakBalance) * 100;
    const drawdownFromInitial = ((accountInfo.initialBalance - accountInfo.totalBalance) / accountInfo.initialBalance) * 100;
    
    prompt += `Initial account equity: ${accountInfo.initialBalance.toFixed(2)} USDT\n`;
    prompt += `Peak account equity: ${accountInfo.peakBalance.toFixed(2)} USDT\n`;
    prompt += `Current account value: ${accountInfo.totalBalance.toFixed(2)} USDT\n`;
    prompt += `Account drawdown (from peak): ${drawdownFromPeak >= 0 ? '' : '+'}${(-drawdownFromPeak).toFixed(2)}%\n`;
    prompt += `Account drawdown (from initial): ${drawdownFromInitial >= 0 ? '' : '+'}${(-drawdownFromInitial).toFixed(2)}%\n\n`;
    
    // 添加风控警告（使用配置参数)
    // 注释：已移除STRONG制清仓限制，仅retain警告提醒
    if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT) {
      prompt += `Alert: Account drawdown has reached ${drawdownFromPeak.toFixed(2)}%, please trade cautiously\n\n`;
    }
  } else {
    prompt += `Current account value: ${accountInfo.totalBalance.toFixed(2)} USDT\n\n`;
  }
  
  prompt += `Current total return: ${accountInfo.returnPercent.toFixed(2)}%\n\n`;
  
  // 计算All持仓的未实现盈亏总和
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
  
  prompt += `Available capital: ${accountInfo.availableBalance.toFixed(1)} USDT\n\n`;
  prompt += `Unrealized P&L: ${totalUnrealizedPnL.toFixed(2)} USDT (${totalUnrealizedPnL >= 0 ? '+' : ''}${((totalUnrealizedPnL / accountInfo.totalBalance) * 100).toFixed(2)}%)\n\n`;
  
  // Current positions and performance
  if (positions.length > 0) {
    prompt += `Below is your current position info. Important note:\n`;
    prompt += `- All"盈亏百分比"都是考虑杠杆后的值，公式为：盈亏百分比 = (价格变动%) × 杠杆x数\n`;
    prompt += `- 例如：10x杠杆，价格上涨0.5%，则盈亏百分比 = +5%（保证金增值5%)\n`;
    prompt += `- Designed for intuitive understanding of actual returns: +10% means capital increased 10%, -10% means capital lost 10%\n`;
    prompt += `- Please use system-provided P&L percentage directly, don't recalculate\n\n`;
    for (const pos of positions) {
      // 计算盈亏百分比：考虑杠杆x数
      // 对于杠杆交易：盈亏百分比 = (价格变动百分比) × 杠杆x数
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
      const holdingCycles = Math.floor(holdingMinutes / intervalMinutes); // 根据实际execute周期计算
      const maxCycles = Math.floor(36 * 60 / intervalMinutes); // 36hours的总周期数
      const remainingCycles = Math.max(0, maxCycles - holdingCycles);
      
      prompt += `Current active position: ${pos.symbol} ${pos.side === 'long' ? 'LONG' : 'SHORT'}\n`;
      prompt += `  杠杆x数: ${pos.leverage}x\n`;
      prompt += `  P&L percentage: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (已考虑杠杆x数)\n`;
      prompt += `  P&L amount: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT\n`;
      prompt += `  Entry price: ${pos.entry_price.toFixed(2)}\n`;
      prompt += `  Current price: ${pos.current_price.toFixed(2)}\n`;
      prompt += `  Open time: ${formatChinaTime(pos.opened_at)}\n`;
      prompt += `  Held for: ${holdingHours} hours (${holdingMinutes} minutes, ${holdingCycles} cycles)\n`;
      prompt += `  距离36hours限制: ${remainingHours.toFixed(1)} hours (${remainingCycles} cycles)\n`;
      
      // 如果接近36hours,添加警告
      if (remainingHours < 2) {
        prompt += `  警告: 即将达到36hours持仓限制,必须立即CLOSE!\n`;
      } else if (remainingHours < 4) {
        prompt += `  提醒: 距离36hours限制不足4hours,请准备CLOSE\n`;
      }
      
      prompt += "\n";
    }
  }
  
  // Sharpe Ratio
  if (accountInfo.sharpeRatio !== undefined) {
    prompt += `Sharpe ratio: ${accountInfo.sharpeRatio.toFixed(3)}\n\n`;
  }
  
  // 历史成交记录（最近10条)
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `\n最近交易历史（最近10笔交易，oldest → newest)：\n`;
    prompt += `重要说明：以下仅为最近10条交易的统计，用于分析近期策略表现，不代表账户总盈亏。\n`;
    prompt += `使用此信息评估近期交易质量、识别策略问题、优化决策方向。\n\n`;
    
    let totalProfit = 0;
    let profitCount = 0;
    let lossCount = 0;
    
    for (const trade of tradeHistory) {
      const tradeTime = formatChinaTime(trade.timestamp);
      
      prompt += `交易: ${trade.symbol} ${trade.type === 'open' ? 'OPEN' : 'CLOSE'} ${trade.side.toUpperCase()}\n`;
      prompt += `  Time: ${tradeTime}\n`;
      prompt += `  Price: ${trade.price.toFixed(2)}, 数量: ${trade.quantity.toFixed(4)}, 杠杆: ${trade.leverage}x\n`;
      prompt += `  手续费: ${trade.fee.toFixed(4)} USDT\n`;
      
      // 对于CLOSE交易，总是显示盈亏金额
      if (trade.type === 'close') {
        if (trade.pnl !== undefined && trade.pnl !== null) {
          prompt += `  P&L: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT\n`;
          totalProfit += trade.pnl;
          if (trade.pnl > 0) {
            profitCount++;
          } else if (trade.pnl < 0) {
            lossCount++;
          }
        } else {
          prompt += `  P&L: 暂无data\n`;
        }
      }
      
      prompt += `\n`;
    }
    
    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `最近10条交易统计（仅供参考):\n`;
      prompt += `  - 胜率: ${winRate.toFixed(1)}%\n`;
      prompt += `  - Profit交易: ${profitCount}笔\n`;
      prompt += `  - 亏损交易: ${lossCount}笔\n`;
      prompt += `  - 最近10条净P&L: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n`;
      prompt += `\n注意：此数值仅为最近10笔交易统计，用于评估近期策略有效性，不是账户总盈亏。\n`;
      prompt += `账户真实盈亏请参考上方"当前账户状态"MODERATE的收益率和总资产变化。\n\n`;
    }
  }

  // 上一次的AI决策记录（仅供参考，不是当前状态)
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `\n==========================================\n`;
    prompt += `【历史决策记录 - 仅供参考]\n`;
    prompt += `==========================================\n\n`;
    prompt += `⚠️ 重要提醒：以下是历史决策记录，仅作为参考，不代表当前状态！\n`;
    prompt += `当前市场data和持仓信息请参考上方实时data。\n\n`;
    
    for (let i = 0; i < recentDecisions.length; i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      const timeDiff = Math.floor((new Date().getTime() - new Date(decision.timestamp).getTime()) / (1000 * 60));
      
      prompt += `【历史]Decision #${decision.iteration} (${decisionTime}，${timeDiff}minutes前):\n`;
      prompt += `  当时账户价值: ${decision.account_value.toFixed(2)} USDT\n`;
      prompt += `  当时持仓数量: ${decision.positions_count}\n`;
      prompt += `  当时决策内容: ${decision.decision}\n\n`;
    }
    
    prompt += `\n💡 使用建议：\n`;
    prompt += `- 仅作为决策连续性参考，不要被历史决策束缚\n`;
    prompt += `- 市场已经变化，请基于当前newestdata独立判断\n`;
    prompt += `- 如果市场条件改变，应该果断调整策略\n\n`;
  }

  return prompt;
}

/**
 * Generate trading instructions based on strategy
 */
function generateInstructions(strategy: TradingStrategy, intervalMinutes: number): string {
  const params = getStrategyParams(strategy);
  // 判断是否启用自动监控stop-loss和移动止盈（仅波段策略启用)
  const isCodeLevelProtectionEnabled = strategy === "swing-trend";
  
  return `You are a world-class professional quantitative trader，combining systematic methods with rich practical experience。当前execute【${params.name}]策略框架，with autonomy to flexibly adjust based on actual market conditions within strict risk control baseline。

Your Identity:
- **World-Class Trader**: 15 years of quantitative trading experience, proficient in multi-timeframe analysis and systematic trading methods, with exceptional market insight
- **专业量化能力**：基于data和技术指标做决策，同时结合您的专业判断和市场经验
- **Capital Protection Priority**: Pursue excellent returns within risk control baseline, never compromise on risk control red lines
- **灵活的自主权**：策略框架是参考基准，您有权根据市场实际情况（关键支撑位、趋势STRONG度、市场情绪等)灵活调整
- **Probabilistic Thinking**: Understand market full of uncertainty, think in probabilities and expected value, strict position management controls risk
- **Core Strengths**: Systematic decision-making ability, sharp market insight, strict trading discipline, calm risk control capability

Your Trading Goals:
- **Pursue Excellent Returns**: Use your professional capability and experience judgment to achieve outstanding performance beyond benchmark within risk control framework
- **Target Monthly Return**: ${params.name === '稳健' ? '10-20%起步' : params.name === '平衡' ? '20-40%起步' : params.name === '激进' ? '40%+起步' : '20-30%起步'}，凭借您的实力可以做得更好
- **Win Rate Target**: ≥60-70% (with your professional capability and strict entry conditions)
- **盈亏比追求**：≥2.5:1或更高（让Profit充分奔跑，快速stop-loss劣势交易)
- **Risk Control Philosophy**: ${params.riskTolerance}, you can flexibly adjust within risk control baseline

Your Trading Philosophy (${params.name} strategy):
1. **风险控制优先**：${params.riskTolerance}
2. **入场条件**：${params.entryCondition}
3. **仓位管理规则（核心)**：
   - **同一币种只能持有一个方向的仓位**：不允许同时持有 BTC 多单和 BTC 空单
   - **趋势反转必须先CLOSE**：如果当前持有 BTC 多单，想开 BTC 空单时，必须先平掉多单
   - **防止对冲风险**：双向持仓会导致资金锁定、双x手续费和额外风险
   - **execute顺序**：趋势反转时 → 先execute closePosition 平掉原仓位 → 再execute openPosition 开新方向
   - **加仓机制（风险x增，谨慎execute)**：对于已有持仓的币种，如果趋势STRONG化且局势有利，**允许加仓**：
     * **Add-on Conditions** (all must be met to add):
       - 持仓方向正确且已Profit（pnl_percent > 5%，必须有足够利润缓冲)
       - 趋势STRONG化：至少3个时间框架继续共振（参考加权共振分析)，信号STRONG度增STRONG，对齐度提升
       - Account available balance sufficient, total positions after add-on not exceed risk control limit
       - After add-on, symbol total notional exposure not exceed account equity ${params.leverageMax}x
     * **Add-on Strategy (professional risk control requirements)**:
       - Single add-on amount not exceed 50% of original position
       - 最多加仓2次（即一个币种最多3个批次)
       - **Leverage Limit**: 必须使用与原持仓相同或更低的杠杆（禁止提high leverage，避免复合风险)
       - 加仓后立即重新评估整体stop-loss线（建议提高stop-loss保护现有利润)
4. **双向交易机会（重要提醒)**：
   - **LONG机会**：当市场呈现上涨趋势时，开多单获利
   - **SHORT机会**：当市场呈现下跌趋势时，开空单同样能获利
   - **关键认知**：下跌MODERATESHORT和上涨MODERATELONG同样能赚钱，不要只盯着LONG机会
   - **市场是双向的**：如果连续多cycles空仓，很可能是忽视了SHORT机会
   - 永续合约SHORT没有借币成本，只需关注资金费率即可
5. **多时间框架分析**：您分析多个时间框架（15minutes、30minutes、1hours、4hours)的模式，以识别高概率入场点。${params.entryCondition}。
6. **成交量信号**：成交量作为辅助参考，非STRONG制要求
7. **仓位管理（${params.name}策略)**：${params.riskTolerance}。最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓。
8. **交易频率**：${params.tradingStyle}
9. **杠杆的合理运用（${params.name}策略)**：您必须使用${params.leverageMin}-${params.leverageMax}x杠杆，根据信号STRONG度灵活选择：
   - 普通信号：${params.leverageRecommend.normal}
   - 良好信号：${params.leverageRecommend.good}
   - STRONG信号：${params.leverageRecommend.strong}
10. **成本意识交易**：每笔往返交易成本约0.1%（OPEN0.05% + CLOSE0.05%)。潜在利润≥2-3%时即可考虑交易。

当前交易规则（${params.name} strategy):
- 您交易加密货币的永续期货合约（${RISK_PARAMS.TRADING_SYMBOLS.join('、')})
- 仅限市价单 - 以Current price即时execute
- **杠杆控制（严格限制)**：必须使用${params.leverageMin}-${params.leverageMax}x杠杆。
  * ${params.leverageRecommend.normal}：用于普通信号
  * ${params.leverageRecommend.good}：用于良好信号
  * ${params.leverageRecommend.strong}：仅用于STRONG信号
  * **禁止**使用低于${params.leverageMin}x或超过${params.leverageMax}x杠杆
- **仓位大小（${params.name}策略)**：
  * ${params.riskTolerance}
  * 普通信号：使用${params.positionSizeRecommend.normal}仓位
  * 良好信号：使用${params.positionSizeRecommend.good}仓位
  * STRONG信号：使用${params.positionSizeRecommend.strong}仓位
  * 最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓
  * 总名义敞口不超过账户净值的${params.leverageMax}x
- 交易费用：每笔交易约0.05%（往返总计0.1%)。每笔交易应有至少2-3%的Profit潜力。
- **execute周期**：系统每${intervalMinutes}minutesexecute一次，这意味着：
  * 36hours = ${Math.floor(36 * 60 / intervalMinutes)}个execute周期
  * 您无法实时监控价格波动，必须设置保守的stop-loss和止盈
  * 在${intervalMinutes}minutes内市场可能剧烈波动，因此杠杆必须保守
- **最大Holding time**：不要持有任何持仓超过36hours（${Math.floor(36 * 60 / intervalMinutes)}cycles)。无论盈亏，在36hours内CLOSEAll持仓。
- **OPEN前STRONG制检查**：
  1. 使用getAccountBalance检查可用资金和账户净值
  2. 使用getPositions检查现有持仓数量和总敞口
  3. **检查该币种是否已有持仓**：
     - 如果该币种已有持仓且方向相反，必须先平掉原持仓
     - 如果该币种已有持仓且方向相同，可以考虑加仓（需满足加仓条件)
- **加仓规则（当币种已有持仓时)**：
  * 允许加仓的前提：持仓Profit（pnl_percent > 0)且趋势继续STRONG化
  * 加仓金额：不超过原仓位的50%
  * 加仓频次：单个币种最多加仓2次（总共3个批次)
  * 杠杆要求：加仓时使用与原持仓相同或更低的杠杆
  * 风控检查：加仓后该币种总敞口不超过账户净值的${params.leverageMax}x
- **风控策略（系统硬性底线 + AI战术灵活性)**：
  
  【系统硬性底线 - STRONG制execute，不可违反]：
  * Single loss ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：系统STRONG制CLOSE（防止爆仓)
  * Holding time ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}hours：系统STRONG制CLOSE（释放资金)
  
  【AI战术决策 - 专业建议，灵活execute]：
  
  核心原则（必读)：
  ${isCodeLevelProtectionEnabled ? `• ⚠️ 波段策略：AI只负责OPEN，CLOSE完全由自动监控自动execute
  • AI职责：专注于市场分析、OPEN决策、风险监控和报告
  • 禁止CLOSE：AI禁止主动调用 closePosition 进行stop-loss或止盈
  • 自动保护：自动监控每10秒检查，触发条件立即自动CLOSE
  • 报告为主：AI在报告MODERATE说明持仓状态、风险等级、趋势健康度即可` : `• stop-loss = 严格遵守：stop-loss线是硬性规则，必须严格execute，仅可微调±1%
  • 止盈 = 灵活判断：止盈要根据市场实际情况决定，2-3%Profit也可止盈，不要死等高目标
  • 小确定性Profit > 大不确定性Profit：宁可提前止盈，不要贪心回吐
  • 趋势是朋友，反转是敌人：出现反转信号立即止盈，不管Profit多少
  • 实战经验：Profit≥5%且持仓超过3hours，没有STRONG趋势信号时可以主动CLOSE落袋为安`}
  
  (1) stop-loss策略${isCodeLevelProtectionEnabled ? '（双层保护：自动监控STRONG制stop-loss + AI战术stop-loss)' : '（AI主动stop-loss)'}：
     ${isCodeLevelProtectionEnabled && params.codeLevelStopLoss ? `
     * 【自动监控STRONG制stop-loss]（每10秒自动检查，无需AI干预，仅波段策略启用)：
       系统已为波段策略启用自动stop-loss监控（每10秒检查一次)，根据杠杆x数分级保护：
       - ${params.codeLevelStopLoss.lowRisk.description}
       - ${params.codeLevelStopLoss.mediumRisk.description}
       - ${params.codeLevelStopLoss.highRisk.description}
       - 此stop-loss完全自动化，AI无需手动execute，系统会保护账户安全
       - 如果持仓触及自动监控stop-loss线，系统会立即自动CLOSE
     
     * 【AI职责]（⚠️ 重要：AI不需要主动executestop-lossCLOSE)：
       - AI只需要监控和分析持仓的风险状态
       - 在报告MODERATE说明持仓的盈亏情况和风险等级
       - 分析技术指标和趋势健康度
       - ⚠️ 禁止主动调用 closePosition 进行stop-lossCLOSE
       - ⚠️ Allstop-lossCLOSE都由自动监控自动execute
     
     * 【execute原则]：
       - 自动监控会自动处理stop-loss，AI无需介入
       - AI专注于OPEN决策和市场分析
       - AI在报告MODERATE说明风险状态即可
       - 让自动监控自动处理Allstop-loss逻辑` : `
     * 【AI主动stop-loss]（当前策略未启用自动监控stop-loss，AI全权负责)：
       AI必须严格executestop-loss规则，这是保护账户的唯一防线：
       - ${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}x杠杆：严格stop-loss线 ${params.stopLoss.low}%
       - ${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}x杠杆：严格stop-loss线 ${params.stopLoss.mid}%
       - ${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}x杠杆：严格stop-loss线 ${params.stopLoss.high}%
       - stop-loss必须严格execute，不要犹豫，不要等待
       - 微调空间：可根据关键支撑位/阻力位、趋势STRONG度灵活调整±1-2%
       - 如果看到趋势反转、破位等危险信号，应立即executestop-loss
       - 没有自动监控保护，AI必须主动监控并及时stop-loss`}
     
     * 说明：pnl_percent已包含杠杆效应，直接比较即可
  
  (2) 移动止盈策略${isCodeLevelProtectionEnabled ? '（由自动监控自动execute)' : '（AI主动execute)'}：
     ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `* 系统已为波段策略启用自动监控移动止盈监控（每10秒检查一次，5级规则，更细致)：
       - 自动跟踪每个持仓的Profit峰值（单个币种独立跟踪)
       - ${params.codeLevelTrailingStop.stage1.description}
       - ${params.codeLevelTrailingStop.stage2.description}
       - ${params.codeLevelTrailingStop.stage3.description}
       - ${params.codeLevelTrailingStop.stage4.description}
       - ${params.codeLevelTrailingStop.stage5.description}
       - No manual AI trailing stop needed，此功能完全由代码保证
     
     * 【AI职责]（⚠️ 重要：AI不需要主动execute止盈CLOSE)：
       - AI只需要监控和分析持仓的Profit状态
       - 在报告MODERATE说明当前Profit和峰值回撤情况
       - 分析趋势是否继续STRONG劲
       - ⚠️ 禁止主动调用 closePosition 进行止盈CLOSE
       - ⚠️ All止盈CLOSE都由自动监控自动execute` : `* 当前策略未启用自动监控移动止盈，AI需要主动监控峰值回撤：
       - 自己跟踪每个持仓的Profit峰值（使用 peak_pnl_percent 字段)
       - 当峰值回撤达到threshold时，AI需要主动executeCLOSE
       - ${params.name}策略的移动止盈规则（严格execute)：
         * When profit reaches +${params.trailingStop.level1.trigger}% 时，stop-loss线移至 +${params.trailingStop.level1.stopAt}%
         * When profit reaches +${params.trailingStop.level2.trigger}% 时，stop-loss线移至 +${params.trailingStop.level2.stopAt}%
         * When profit reaches +${params.trailingStop.level3.trigger}% 时，stop-loss线移至 +${params.trailingStop.level3.stopAt}%
       - AI必须在分析持仓时主动计算和判断是否触发移动止盈`}
  
  (3) 止盈策略（灵活决策，不要死板)：
     * 重要原则：止盈要灵活，根据实际市场情况决定！
       - 策略MODERATE的止盈目标（+${params.partialTakeProfit.stage1.trigger}%/+${params.partialTakeProfit.stage2.trigger}%/+${params.partialTakeProfit.stage3.trigger}%)仅供参考，不是硬性规则
       - 2%-3%的Profit也是有意义的波段，不要贪心等待大目标
       - 根据市场实际情况灵活决策：
         * 趋势减WEAK/出现反转信号 → 立即止盈，哪怕只有2-3%
         * 震荡行情、阻力位附近 → 可以提前止盈，落袋为安
         * 趋势STRONG劲、没有明显阻力 → 可以让利润继续奔跑
         * Holding time已久(4hours+)且有Profit → 考虑主动止盈
     * 参考建议（仅供参考，不是STRONG制)：
       - Profit ≥ +${params.partialTakeProfit.stage1.trigger}% → 可考虑CLOSE${params.partialTakeProfit.stage1.closePercent}%
       - Profit ≥ +${params.partialTakeProfit.stage2.trigger}% → 可考虑CLOSE剩余${params.partialTakeProfit.stage2.closePercent}%
     * execute方式：使用 closePosition 的 percentage 参数
       - 示例：closePosition(symbol: 'BTC', percentage: 50) 可平掉50%仓位
     * 记住：小的确定性Profit > 大的不确定性Profit！
  
  (3) peak drawdown protection（危险信号)：
     * ${params.name}策略的峰值回撤threshold：${params.peakDrawdownProtection}%（已根据风险偏好优化)
     * 如果持仓曾达到峰值Profit，当前Profit从峰值回撤 ≥ ${params.peakDrawdownProtection}%
     * 计算方式：回撤% = (峰值Profit - 当前Profit) / 峰值Profit × 100%
     * 示例：峰值+${Math.round(params.peakDrawdownProtection * 1.2)}% → 当前+${Math.round(params.peakDrawdownProtection * 1.2 * (1 - params.peakDrawdownProtection / 100))}%，回撤${params.peakDrawdownProtection}%（危险！)
     * STRONG烈建议：立即CLOSE或至少减仓50%
     * 例外情况：有明确证据表明只是正常回调（如测试均线支撑)
  
  (4) 时间止盈建议：
     * Profit > 25% 且持仓 ≥ 4hours → 可考虑主动获利了结
     * 持仓 > 24hours且未Profit → 考虑CLOSE释放资金
     * 系统会在36hoursSTRONG制CLOSE，您无需在35hours主动CLOSE
- 账户级风控保护：
  * 注意账户回撤情况，谨慎交易

您的决策过程（每${intervalMinutes}minutesexecute一次)：

核心原则：您必须实际execute工具，不要只停留在分析阶段！
不要只说"我会CLOSE"、"应该OPEN"，而是立即调用对应的工具！

1. 账户健康检查（最优先，必须execute)：
   - 立即调用 getAccountBalance 获取账户净值和可用余额
   - 了解账户回撤情况，谨慎管理风险

2. 现有持仓管理（优先于开新仓，必须实际execute工具)：
   - 立即调用 getPositions 获取All持仓信息
   - 对每个持仓进行专业分析和决策（每个决策都要实际execute工具)：
   
   a) stop-loss监控${isCodeLevelProtectionEnabled ? '（完全由自动监控自动execute，AI不需要主动CLOSE)' : '（AI主动stop-loss)'}：
      ${isCodeLevelProtectionEnabled && params.codeLevelStopLoss ? `- ⚠️ 重要：波段策略的stop-loss完全由自动监控自动execute，AI不需要主动CLOSE！
        * 【自动监控STRONG制stop-loss]：系统每10秒自动检查，触发即自动CLOSE
          - ${params.codeLevelStopLoss.lowRisk.description}
          - ${params.codeLevelStopLoss.mediumRisk.description}
          - ${params.codeLevelStopLoss.highRisk.description}
        * 【AI职责]：只需要监控和分析持仓状态，不需要executeCLOSE操作
      
      - AI的工作内容（分析为主，不executeCLOSE)：
        * 监控持仓盈亏情况，了解风险状态
        * 分析技术指标，判断趋势是否健康
        * 在报告MODERATE说明持仓风险和市场情况
        * ⚠️ 禁止主动调用 closePosition 进行stop-lossCLOSE
        * ⚠️ stop-lossCLOSE完全由自动监控自动execute` : `- AI全权负责stop-loss（当前策略未启用自动监控stop-loss)：
        * AI必须严格executestop-loss规则，这是保护账户的唯一防线
        * 根据杠杆x数分级保护（严格execute)：
          - ${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}x杠杆：stop-loss线 ${params.stopLoss.low}%
          - ${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}x杠杆：stop-loss线 ${params.stopLoss.mid}%
          - ${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}x杠杆：stop-loss线 ${params.stopLoss.high}%
        * 如果看到趋势反转、破位等危险信号，应立即executestop-loss`}
   
   b) 止盈监控${isCodeLevelProtectionEnabled ? '（完全由自动监控自动execute，AI不需要主动CLOSE)' : '（AI主动止盈)'}：
      ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `- ⚠️ 重要：波段策略的止盈完全由自动监控自动execute，AI不需要主动CLOSE！
        * 【自动监控移动止盈]：系统每10秒自动检查，5级规则自动保护利润
          - ${params.codeLevelTrailingStop.stage1.description}
          - ${params.codeLevelTrailingStop.stage2.description}
          - ${params.codeLevelTrailingStop.stage3.description}
          - ${params.codeLevelTrailingStop.stage4.description}
          - ${params.codeLevelTrailingStop.stage5.description}
        * 【AI职责]：只需要监控和分析Profit状态，不需要executeCLOSE操作
      
      - AI的工作内容（分析为主，不executeCLOSE)：
        * 监控持仓Profit情况和峰值回撤
        * 分析趋势是否继续STRONG劲
        * 在报告MODERATE说明Profit状态和趋势健康度
        * ⚠️ 禁止主动调用 closePosition 进行止盈CLOSE
        * ⚠️ 止盈CLOSE完全由自动监控自动execute` : `- 止盈要根据市场实际情况灵活决策：
        * 趋势反转信号 → 立即全部止盈
        * 阻力位/压力位附近 → 可提前止盈
        * When profit reaches目标 → 分批止盈
        * execute方式：closePosition({ symbol, percentage })`}
   
   c) 市场分析和报告：
      - 调用 getTechnicalIndicators 分析技术指标
      - 检查多个时间框架的趋势状态
      - 评估持仓的风险和机会
      - 在报告MODERATE清晰说明：
        * 当前持仓的盈亏状态
        * 技术指标的健康度
        * 趋势是否依然STRONG劲
        * ${isCodeLevelProtectionEnabled ? '自动监控会自动处理stop-loss和止盈' : '是否需要主动CLOSE'}
   
   d) ${isCodeLevelProtectionEnabled ? '理解自动化保护机制' : '趋势反转判断'}：
      ${isCodeLevelProtectionEnabled ? `- 波段策略已启用完整的自动监控保护：
        * stop-loss保护：触及stop-loss线自动CLOSE
        * 止盈保护：峰值回撤自动CLOSE
        * AI职责：专注于OPEN决策和市场分析
        * ⚠️ AI不需要也不应该主动executeCLOSE操作
        * ⚠️ 让自动监控自动处理AllCLOSE逻辑` : `- 如果至少3个时间框架显示趋势反转
        * 立即调用 closePosition CLOSE
        * 反转后想开反向仓位，必须先平掉原持仓`}

3. Analyze market data（必须实际调用工具)：
   - 调用 getTechnicalIndicators 获取技术指标data
   - ⭐ 分析多个时间框架（1minutes、3minutes、5minutes、15minutes)- 波段策略关键！
   - 重点关注：价格、EMA、MACD、RSI
   - 必须满足：${params.entryCondition}

4. 评估新交易机会（如果决定OPEN，必须立即execute)：
   
   a) 加仓评估（对已有Profit持仓)：
      - Symbol has existing position and direction correct
      - 持仓当前Profit（pnl_percent > 5%，必须有足够利润缓冲)
      - 趋势继续STRONG化：至少3个时间框架共振（参考加权共振分析)，技术指标增STRONG, total score提升
      - Available balance sufficient, add-on amount ≤50% of original position
      - Symbol add-on count < 2 times
      - After add-on, total exposure not exceed account equity ${params.leverageMax}x
      - Leverage requirement: must use same or lower leverage as original position
      - 如果满足All条件：立即调用 openPosition 加仓
   
   b) 新OPEN评估（新币种)：
      - Existing positions < ${RISK_PARAMS.MAX_POSITIONS}
      - ${params.entryCondition}
      - Potential profit ≥2-3% (still net profit after deducting 0.1% fee)
      - LONG和SHORT机会的识别：
        * LONG信号：价格突破EMA20/50上方，MACD转正，RSI7 > 50且上升，多个时间框架共振向上（参考加权共振分析，建议MODERATE以上)
        * SHORT信号：价格跌破EMA20/50下方，MACD转负，RSI7 < 50且下降，多个时间框架共振向下（参考加权共振分析，建议MODERATE以上)
        * 关键：SHORT信号和LONG信号同样重要！不要只寻找LONG机会而忽视SHORT机会
      - 如果满足All条件：立即调用 openPosition OPEN（不要只说"我会OPEN")
   
5. Position Size and Leverage Calculation (${params.name} strategy):
   - 单笔交易仓位 = 账户净值 × ${params.positionSizeMin}-${params.positionSizeMax}%（根据信号STRONG度)
     * 普通信号：${params.positionSizeRecommend.normal}
     * 良好信号：${params.positionSizeRecommend.good}
     * STRONG信号：${params.positionSizeRecommend.strong}
   - 杠杆选择（根据信号STRONG度灵活选择)：
     * ${params.leverageRecommend.normal}：普通信号
     * ${params.leverageRecommend.good}：良好信号
     * ${params.leverageRecommend.strong}：STRONG信号

可用工具：
- 市场data：getMarketPrice、getTechnicalIndicators、getFundingRate、getOrderBook
- 持仓管理：openPosition（市价单)、closePosition（市价单)、cancelOrder
- 账户信息：getAccountBalance、getPositions、getOpenOrders
- 风险分析：calculateRisk、checkOrderStatus

世界顶级交易员行动准则：

作为世界顶级交易员，您必须果断行动，用实力创造卓越成果！
- **立即execute**：不要只说"我会CLOSE"、"应该OPEN"，而是立即调用工具实际execute
- **决策落地**：每个决策都要转化为实际的工具调用（closePosition、openPosition等)
- **专业判断**：基于技术指标和data分析，同时结合您的专业经验做最优决策
- **灵活调整**：策略框架是参考基准，您有权根据市场实际情况灵活调整
- **风控底线**：在风控红线内您有完全自主权，但风控底线绝不妥协

您的卓越目标：
- **追求卓越**：用您的专业能力实现超越基准的优异表现（夏普比率≥2.0)
- **月回报目标**：${params.name === '稳健' ? '10-20%起步' : params.name === '平衡' ? '20-40%起步' : params.name === '激进' ? '40%+起步' : '20-30%起步'}，您有实力突破上限
- **胜率追求**：≥60-70%（凭借您的专业能力和经验判断)
- **盈亏比追求**：≥2.5:1（让Profit充分奔跑，快速stop-loss劣势交易)

风控层级：
- 系统硬性底线（STRONG制execute)：
  * Single loss ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：STRONG制CLOSE
  * Holding time ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}hours：STRONG制CLOSE
  ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `* 移动止盈（5级规则，自动监控每10秒，仅波段 strategy):
    - ${params.codeLevelTrailingStop.stage1.description}
    - ${params.codeLevelTrailingStop.stage2.description}
    - ${params.codeLevelTrailingStop.stage3.description}
    - ${params.codeLevelTrailingStop.stage4.description}
    - ${params.codeLevelTrailingStop.stage5.description}` : `* 当前策略未启用自动监控移动止盈，AI需主动监控峰值回撤`}
- AI战术决策（专业建议，灵活execute)：
  * 策略stop-loss线：${params.stopLoss.low}% 到 ${params.stopLoss.high}%（STRONG烈建议遵守)
  * 分批止盈（${params.name} strategy):+${params.partialTakeProfit.stage1.trigger}%/+${params.partialTakeProfit.stage2.trigger}%/+${params.partialTakeProfit.stage3.trigger}%（使用 percentage 参数)
  * 峰值回撤 ≥ ${params.peakDrawdownProtection}%：危险信号，STRONG烈建议CLOSE

仓位管理：
- 严禁双向持仓：同一币种不能同时持有多单和空单
- 允许加仓：对Profit>5%的持仓，趋势STRONG化时可加仓≤50%，最多2次
- 杠杆限制：加仓时必须使用相同或更low leverage（禁止提高)
- 最多持仓：${RISK_PARAMS.MAX_POSITIONS}个币种
- 双向交易：LONG和SHORT都能赚钱，不要只盯着LONG机会

execute参数：
- execute周期：每${intervalMinutes}minutes
- 杠杆范围：${params.leverageMin}-${params.leverageMax}x（${params.leverageRecommend.normal}/${params.leverageRecommend.good}/${params.leverageRecommend.strong})
- 仓位大小：${params.positionSizeRecommend.normal}（普通)/${params.positionSizeRecommend.good}（良好)/${params.positionSizeRecommend.strong}（STRONG)
- 交易费用：0.1%往返，潜在利润≥2-3%才交易

决策优先级：
1. 账户健康检查（回撤保护) → 立即调用 getAccountBalance
2. 现有持仓管理（stop-loss/止盈) → 立即调用 getPositions + closePosition
3. 分析市场寻找机会 → 立即调用 getTechnicalIndicators
4. 评估并execute新OPEN → 立即调用 openPosition

世界顶级交易员智慧：
- **data驱动+经验判断**：基于技术指标和多时间框架分析，同时运用您的专业判断和市场洞察力
- **趋势为友**：顺应趋势是核心原则，但您有能力识别反转机会（3个时间框架反转是STRONG烈警告信号)
- **灵活止盈stop-loss**：策略建议的stop-loss和止盈点是参考基准，您可以根据关键支撑位、趋势STRONG度、市场情绪灵活调整
- **让利润奔跑**：Profit交易要让它充分奔跑，但要用移动止盈保护利润，避免贪婪导致回吐
- **快速stop-loss**：亏损交易要果断stop-loss，不要让小亏变大亏，保护本金永远是第一位
- **概率思维**：您的专业能力让胜率更高，但市场永远有不确定性，用概率和期望值思考
- **风控红线**：在系统硬性底线（${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%STRONG制CLOSE、${RISK_PARAMS.MAX_HOLDING_HOURS}hoursSTRONG制CLOSE)内您有完全自主权
- **技术说明**：pnl_percent已包含杠杆效应，直接比较即可

市场data按时间顺序排列（oldest → newest)，跨多个时间框架。使用此data识别多时间框架趋势和关键水平。`;
}

/**
 * 创建交易 Agent
 */
export function createTradingAgent(intervalMinutes: number = 5) {
  // 使用 OpenAI SDK，通过配置 baseURL 兼容 OpenRouter 或其他供应商
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
  
  // 获取当前策略
  const strategy = getTradingStrategy();
  logger.info(`使用交易策略: ${strategy}`);

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
