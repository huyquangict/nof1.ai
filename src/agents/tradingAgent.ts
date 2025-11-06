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
 * 交易 Agent 配置（极简版）
 */
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { createOpenAI } from "@ai-sdk/openai";
import * as tradingTools from "../tools/trading";
import { formatChinaTime } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";

/**
 * 账户风险配置
 */
export interface AccountRiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
  syncOnStartup: boolean;
}

/**
 * 从环境变量读取账户风险配置
 */
export function getAccountRiskConfig(): AccountRiskConfig {
  return {
    stopLossUsdt: Number.parseFloat(process.env.ACCOUNT_STOP_LOSS_USDT || "50"),
    takeProfitUsdt: Number.parseFloat(process.env.ACCOUNT_TAKE_PROFIT_USDT || "10000"),
    syncOnStartup: process.env.SYNC_CONFIG_ON_STARTUP === "true",
  };
}

/**
 * 交易策略类型
 */
export type TradingStrategy = "conservative" | "balanced" | "aggressive" | "ultra-short" | "swing-trend";

/**
 * 策略参数配置
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
    // 移动止盈阶梯配置 [触发盈利, 移动止损线]
    level1: { trigger: number; stopAt: number };
    level2: { trigger: number; stopAt: number };
    level3: { trigger: number; stopAt: number };
  };
  partialTakeProfit: {
    // 分批止盈配置（根据策略杠杆调整）
    stage1: { trigger: number; closePercent: number }; // 第一阶段：平仓50%
    stage2: { trigger: number; closePercent: number }; // 第二阶段：平仓剩余50%
    stage3: { trigger: number; closePercent: number }; // 第三阶段：全部清仓
  };
  peakDrawdownProtection: number; // 峰值回撤保护阈值（百分比）
  volatilityAdjustment: {
    // 波动率调整系数
    highVolatility: { leverageFactor: number; positionFactor: number }; // ATR > 5%
    normalVolatility: { leverageFactor: number; positionFactor: number }; // ATR 2-5%
    lowVolatility: { leverageFactor: number; positionFactor: number }; // ATR < 2%
  };
  entryCondition: string;
  riskTolerance: string;
  tradingStyle: string;
  // 自动监控止损配置（仅 swing-trend 策略使用）
  codeLevelStopLoss?: {
    lowRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
    mediumRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
    highRisk: { minLeverage: number; maxLeverage: number; stopLossPercent: number; description: string };
  };
  // 自动监控移动止盈配置（仅 swing-trend 策略使用）
  codeLevelTrailingStop?: {
    stage1: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage2: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage3: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage4: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
    stage5: { name: string; minProfit: number; maxProfit: number; drawdownPercent: number; description: string };
  };
}

/**
 * 获取策略参数（基于 MAX_LEVERAGE 动态计算）
 */
export function getStrategyParams(strategy: TradingStrategy): StrategyParams {
  const maxLeverage = RISK_PARAMS.MAX_LEVERAGE;
  
  // 根据 MAX_LEVERAGE 动态计算各策略的杠杆范围
  // 保守策略：30%-60% 的最大杠杆
  const conservativeLevMin = Math.max(1, Math.ceil(maxLeverage * 0.3));
  const conservativeLevMax = Math.max(2, Math.ceil(maxLeverage * 0.6));
  const conservativeLevNormal = conservativeLevMin;
  const conservativeLevGood = Math.ceil((conservativeLevMin + conservativeLevMax) / 2);
  const conservativeLevStrong = conservativeLevMax;
  
  // 平衡策略：60%-85% 的最大杠杆
  const balancedLevMin = Math.max(2, Math.ceil(maxLeverage * 0.6));
  const balancedLevMax = Math.max(3, Math.ceil(maxLeverage * 0.85));
  const balancedLevNormal = balancedLevMin;
  const balancedLevGood = Math.ceil((balancedLevMin + balancedLevMax) / 2);
  const balancedLevStrong = balancedLevMax;
  
  // 激进策略：85%-100% 的最大杠杆
  const aggressiveLevMin = Math.max(3, Math.ceil(maxLeverage * 0.85));
  const aggressiveLevMax = maxLeverage;
  const aggressiveLevNormal = aggressiveLevMin;
  const aggressiveLevGood = Math.ceil((aggressiveLevMin + aggressiveLevMax) / 2);
  const aggressiveLevStrong = aggressiveLevMax;
  
  const strategyConfigs: Record<TradingStrategy, StrategyParams> = {
    "ultra-short": {
      name: "超短线",
      description: "极短周期快进快出，5分钟执行，适合高频交易",
      leverageMin: Math.max(3, Math.ceil(maxLeverage * 0.5)),
      leverageMax: Math.max(5, Math.ceil(maxLeverage * 0.75)),
      leverageRecommend: {
        normal: `${Math.max(3, Math.ceil(maxLeverage * 0.5))}倍`,
        good: `${Math.max(4, Math.ceil(maxLeverage * 0.625))}倍`,
        strong: `${Math.max(5, Math.ceil(maxLeverage * 0.75))}倍`,
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
        // 超短线策略：快速锁利（5分钟周期）
        level1: { trigger: 4, stopAt: 1.5 },   // 盈利达到 +4% 时，止损线移至 +1.5%
        level2: { trigger: 8, stopAt: 4 },     // 盈利达到 +8% 时，止损线移至 +4%
        level3: { trigger: 15, stopAt: 8 },    // 盈利达到 +15% 时，止损线移至 +8%
      },
      partialTakeProfit: {
        // 超短线策略：快速分批止盈
        stage1: { trigger: 15, closePercent: 50 },  // +15% 平仓50%
        stage2: { trigger: 25, closePercent: 50 },  // +25% 平仓剩余50%
        stage3: { trigger: 35, closePercent: 100 }, // +35% 全部清仓
      },
      peakDrawdownProtection: 20, // 超短线：20%峰值回撤保护（快速保护利润）
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.7, positionFactor: 0.8 },
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 },
        lowVolatility: { leverageFactor: 1.1, positionFactor: 1.0 },
      },
      entryCondition: "至少2个时间框架信号一致，优先1-5分钟级别",
      riskTolerance: "单笔交易风险控制在18-25%之间，快进快出",
      tradingStyle: "超短线交易，5分钟执行周期，快速捕捉短期波动，严格执行2%周期锁利规则和30分钟盈利平仓规则",
    },
    "swing-trend": {
      name: "波段趋势",
      description: "中长线波段交易，20分钟执行，捕捉中期趋势，适合稳健成长",
      leverageMin: Math.max(2, Math.ceil(maxLeverage * 0.2)),
      leverageMax: Math.max(5, Math.ceil(maxLeverage * 0.5)),
      leverageRecommend: {
        normal: `${Math.max(2, Math.ceil(maxLeverage * 0.2))}倍`,
        good: `${Math.max(3, Math.ceil(maxLeverage * 0.35))}倍`,
        strong: `${Math.max(5, Math.ceil(maxLeverage * 0.5))}倍`,
      },
      positionSizeMin: 20,
      positionSizeMax: 35,
      positionSizeRecommend: {
        normal: "20-25%",
        good: "25-30%",
        strong: "30-35%",
      },
      stopLoss: {
        low: -9,      // 低杠杆(2-3倍)：-9%止损（给趋势足够空间，略收紧1%）
        mid: -7.5,    // 中杠杆(3-4倍)：-7.5%止损（略收紧0.5%）
        high: -5.5,   // 高杠杆(4-5倍)：-5.5%止损（略收紧0.5%）
      },
      trailingStop: {
        // 波段策略：给趋势更多空间，较晚锁定利润
        level1: { trigger: 15, stopAt: 8 },   // 盈利达到 +15% 时，止损线移至 +8%
        level2: { trigger: 30, stopAt: 20 },  // 盈利达到 +30% 时，止损线移至 +20%
        level3: { trigger: 50, stopAt: 35 },  // 盈利达到 +50% 时，止损线移至 +35%
      },
      partialTakeProfit: {
        // 波段策略：更晚分批止盈，追求趋势利润最大化
        stage1: { trigger: 50, closePercent: 40 },  // +50% 平仓40%（保留60%追求更大利润）
        stage2: { trigger: 80, closePercent: 60 },  // +80% 平仓剩余60%（累计平仓100%）
        stage3: { trigger: 120, closePercent: 100 },// +120% 全部清仓
      },
      peakDrawdownProtection: 35, // 波段策略：35%峰值回撤保护（给趋势更多空间）
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.5, positionFactor: 0.6 },   // 高波动：大幅降低风险
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：标准配置
        lowVolatility: { leverageFactor: 1.2, positionFactor: 1.1 },    // 低波动：适度提高（趋势稳定）
      },
      entryCondition: "必须1分钟、3分钟、5分钟、15分钟这4个时间框架信号全部强烈一致，加权共振分析达到STRONG级别（总分≥70且对齐度≥75%），关键指标共振（MACD、RSI、EMA方向一致）",
      riskTolerance: "单笔交易风险控制在20-35%之间，注重趋势质量而非交易频率",
      tradingStyle: "波段趋势交易，20分钟执行周期，耐心等待高质量趋势信号，持仓时间可达数天，让利润充分奔跑",
      // 自动监控止损配置（每10秒自动检查）
      codeLevelStopLoss: {
        lowRisk: {
          minLeverage: 5,
          maxLeverage: 7,
          stopLossPercent: -6,
          description: "5-7倍杠杆，亏损 -6% 时止损",
        },
        mediumRisk: {
          minLeverage: 8,
          maxLeverage: 12,
          stopLossPercent: -5,
          description: "8-12倍杠杆，亏损 -5% 时止损",
        },
        highRisk: {
          minLeverage: 13,
          maxLeverage: Infinity,
          stopLossPercent: -4,
          description: "13倍以上杠杆，亏损 -4% 时止损",
        },
      },
      // 自动监控移动止盈配置（每10秒自动检查，5级规则）
      codeLevelTrailingStop: {
        stage1: {
          name: "阶段1",
          minProfit: 4,
          maxProfit: 6,
          drawdownPercent: 1.5,
          description: "峰值4-6%，回退1.5%平仓（保底2.5%）",
        },
        stage2: {
          name: "阶段2",
          minProfit: 6,
          maxProfit: 10,
          drawdownPercent: 2,
          description: "峰值6-10%，回退2%平仓（保底4%）",
        },
        stage3: {
          name: "阶段3",
          minProfit: 10,
          maxProfit: 15,
          drawdownPercent: 2.5,
          description: "峰值10-15%，回退2.5%平仓（保底7.5%）",
        },
        stage4: {
          name: "阶段4",
          minProfit: 15,
          maxProfit: 25,
          drawdownPercent: 3,
          description: "峰值15-25%，回退3%平仓（保底12%）",
        },
        stage5: {
          name: "阶段5",
          minProfit: 25,
          maxProfit: Infinity,
          drawdownPercent: 5,
          description: "峰值25%+，回退5%平仓（保底20%）",
        },
      },
    },
    "conservative": {
      name: "稳健",
      description: "低风险低杠杆，严格入场条件，适合保守投资者",
      leverageMin: conservativeLevMin,
      leverageMax: conservativeLevMax,
      leverageRecommend: {
        normal: `${conservativeLevNormal}倍`,
        good: `${conservativeLevGood}倍`,
        strong: `${conservativeLevStrong}倍`,
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
        // 保守策略：较早锁定利润（基准：15倍杠杆）
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 6, stopAt: 2 },   // 基准：盈利达到 +6% 时，止损线移至 +2%
        level2: { trigger: 12, stopAt: 6 },  // 基准：盈利达到 +12% 时，止损线移至 +6%
        level3: { trigger: 20, stopAt: 12 }, // 基准：盈利达到 +20% 时，止损线移至 +12%
      },
      partialTakeProfit: {
        // 保守策略：较早分批止盈，提前锁定利润
        stage1: { trigger: 20, closePercent: 50 },  // +20% 平仓50%
        stage2: { trigger: 30, closePercent: 50 },  // +30% 平仓剩余50%
        stage3: { trigger: 40, closePercent: 100 }, // +40% 全部清仓
      },
      peakDrawdownProtection: 25, // 保守策略：25%峰值回撤保护（更早保护利润）
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.6, positionFactor: 0.7 },   // 高波动：大幅降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.0, positionFactor: 1.0 },    // 低波动：不调整（保守不追求）
      },
      entryCondition: "至少3个关键时间框架信号一致，4个或更多更佳",
      riskTolerance: "单笔交易风险控制在15-22%之间，严格控制回撤",
      tradingStyle: "谨慎交易，宁可错过机会也不冒险，优先保护本金",
    },
    "balanced": {
      name: "平衡",
      description: "中等风险杠杆，合理入场条件，适合大多数投资者",
      leverageMin: balancedLevMin,
      leverageMax: balancedLevMax,
      leverageRecommend: {
        normal: `${balancedLevNormal}倍`,
        good: `${balancedLevGood}倍`,
        strong: `${balancedLevStrong}倍`,
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
        // 平衡策略：适中的移动止盈（基准：15倍杠杆）
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 8, stopAt: 3 },   // 基准：盈利达到 +8% 时，止损线移至 +3%
        level2: { trigger: 15, stopAt: 8 },  // 基准：盈利达到 +15% 时，止损线移至 +8%
        level3: { trigger: 25, stopAt: 15 }, // 基准：盈利达到 +25% 时，止损线移至 +15%
      },
      partialTakeProfit: {
        // 平衡策略：标准分批止盈
        stage1: { trigger: 30, closePercent: 50 },  // +30% 平仓50%
        stage2: { trigger: 40, closePercent: 50 },  // +40% 平仓剩余50%
        stage3: { trigger: 50, closePercent: 100 }, // +50% 全部清仓
      },
      peakDrawdownProtection: 30, // 平衡策略：30%峰值回撤保护（标准平衡点）
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.7, positionFactor: 0.8 },   // 高波动：适度降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.1, positionFactor: 1.0 },    // 低波动：略微提高杠杆
      },
      entryCondition: "至少2个关键时间框架信号一致，3个或更多更佳",
      riskTolerance: "单笔交易风险控制在20-27%之间，平衡风险与收益",
      tradingStyle: "在风险可控前提下积极把握机会，追求稳健增长",
    },
    "aggressive": {
      name: "激进",
      description: "高风险高杠杆，宽松入场条件，适合激进投资者",
      leverageMin: aggressiveLevMin,
      leverageMax: aggressiveLevMax,
      leverageRecommend: {
        normal: `${aggressiveLevNormal}倍`,
        good: `${aggressiveLevGood}倍`,
        strong: `${aggressiveLevStrong}倍`,
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
        // 激进策略：更晚锁定，追求更高利润（基准：15倍杠杆）
        // 注意：这些是基准值，实际使用时会根据杠杆动态调整
        level1: { trigger: 10, stopAt: 4 },  // 基准：盈利达到 +10% 时，止损线移至 +4%
        level2: { trigger: 18, stopAt: 10 }, // 基准：盈利达到 +18% 时，止损线移至 +10%
        level3: { trigger: 30, stopAt: 18 }, // 基准：盈利达到 +30% 时，止损线移至 +18%
      },
      partialTakeProfit: {
        // 激进策略：更晚分批止盈，追求更高利润
        stage1: { trigger: 40, closePercent: 50 },  // +40% 平仓50%
        stage2: { trigger: 50, closePercent: 50 },  // +50% 平仓剩余50%
        stage3: { trigger: 60, closePercent: 100 }, // +60% 全部清仓
      },
      peakDrawdownProtection: 35, // 激进策略：35%峰值回撤保护（给利润更多奔跑空间）
      volatilityAdjustment: {
        highVolatility: { leverageFactor: 0.8, positionFactor: 0.85 },  // 高波动：轻微降低
        normalVolatility: { leverageFactor: 1.0, positionFactor: 1.0 }, // 正常波动：不调整
        lowVolatility: { leverageFactor: 1.2, positionFactor: 1.1 },    // 低波动：提高杠杆和仓位
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
 * 生成交易提示词（参照 1.md 格式）
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
  
  // 获取当前策略参数（用于每周期强调风控规则）
  const strategy = getTradingStrategy();
  const params = getStrategyParams(strategy);
  // 判断是否启用自动监控止损和移动止盈（仅波段策略启用）
  const isCodeLevelProtectionEnabled = strategy === "swing-trend";
  
  let prompt = `[Trading Cycle #${iteration}] ${currentTime}
Elapsed ${minutesElapsed} minutes, Execution cycle ${intervalMinutes} minutes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current Strategy: ${params.name} (${params.description})
Target Monthly Return: ${params.name === 'Balanced' ? '10-20%' : params.name === 'Balanced' ? '20-40%' : '40%+'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[HARD RISK CONTROL BOTTOM LINE - System Enforced]
┌─────────────────────────────────────────┐
│ Single Loss ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%: Force Close          │
│ Holding Time ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS} hours: Force Close        │
└─────────────────────────────────────────┘

[AI TACTICAL DECISION - Strongly Recommended]
┌─────────────────────────────────────────┐
│ Strategy Stop-Loss: ${params.stopLoss.low}% ~ ${params.stopLoss.high}% (based on leverage) │
│ Partial Take-Profit:                    │
│   • Profit≥+${params.partialTakeProfit.stage1.trigger}% → Close ${params.partialTakeProfit.stage1.closePercent}%  │
│   • Profit≥+${params.partialTakeProfit.stage2.trigger}% → Close ${params.partialTakeProfit.stage2.closePercent}%  │
│   • Profit≥+${params.partialTakeProfit.stage3.trigger}% → Close ${params.partialTakeProfit.stage3.closePercent}% │
│ Peak Drawdown: ≥${params.peakDrawdownProtection}% → Danger signal, close immediately │
${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `│                                         │
│ Note: Trailing stop executed by auto-monitor (every 10s) │
│   • ${params.codeLevelTrailingStop.stage1.description} │
│   • ${params.codeLevelTrailingStop.stage2.description} │
│   • ${params.codeLevelTrailingStop.stage3.description} │
│   • ${params.codeLevelTrailingStop.stage4.description} │
│   • ${params.codeLevelTrailingStop.stage5.description} │
│   • No manual AI trailing stop needed   │` : `│                                         │
│ Note: Current strategy has no auto-monitor trailing stop │
│   • AI must actively monitor peak drawdown and execute take-profit │
│   • Profit ${params.trailingStop.level1.trigger}% → stop-loss line ${params.trailingStop.level1.stopAt}%   │
│   • Profit ${params.trailingStop.level2.trigger}% → stop-loss line ${params.trailingStop.level2.stopAt}%   │
│   • Profit ${params.trailingStop.level3.trigger}% → stop-loss line ${params.trailingStop.level3.stopAt}%   │`}
└─────────────────────────────────────────┘

[DECISION WORKFLOW - Execute by Priority]
(1) Position Management (Top Priority):
   Check each position's stop-loss/take-profit/peak drawdown → closePosition

(2) New Position Evaluation:
   Analyze market data → Identify bilateral opportunities (long/short) → openPosition

(3) Add-on Position Evaluation:
   Profit>5% and trend strengthens → openPosition (≤50% of original position, same or lower leverage)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[DATA DESCRIPTION]
This prompt has preloaded all necessary data:
• Market data and technical indicators for all symbols (multi-timeframe)
• Weighted confluence analysis (quantify multi-timeframe signal strength, 0-100 score, includes alignment and signal quality)
• Account info (balance, return rate, Sharpe ratio)
• Current position status (P&L, holding time, leverage)
• Historical trade records (last 10 trades)

[YOUR TASK]
Make trading decisions directly based on above data, no need to fetch again:
1. Analyze position management needs (stop-loss/take-profit/add-on) → call closePosition / openPosition to execute
2. Identify new trading opportunities (long/short) → call openPosition to execute
3. Assess risk and position management → call calculateRisk to verify

KEY: You must actually call tools to execute decisions, do not just stay in analysis stage!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All price/signal data below in chronological order: oldest → newest

Timeframe description: Unless otherwise stated in section title, intraday series provided at 3-minute intervals. If a symbol uses different interval, it will be clearly stated in that symbol's section.

Current market status for all symbols
`;

  // 按照 1.md 格式输出每个币种的数据
  for (const [symbol, dataRaw] of Object.entries(marketData)) {
    const data = dataRaw as any;
    
    prompt += `\nAll ${symbol} data\n`;
    prompt += `Current price = ${data.price.toFixed(1)}, Current EMA20 = ${data.ema20.toFixed(3)}, Current MACD = ${data.macd.toFixed(3)}, Current RSI (7-period) = ${data.rsi7.toFixed(3)}\n\n`;

    // Funding rate
    if (data.fundingRate !== undefined) {
      prompt += `Additionally, this is ${symbol} perpetual contract's latest funding rate (the contract type you trade):\n\n`;
      prompt += `Funding rate: ${data.fundingRate.toExponential(2)}\n\n`;
    }

    // Intraday time series data (3-minute level)
    if (data.intradaySeries && data.intradaySeries.midPrices.length > 0) {
      const series = data.intradaySeries;
      prompt += `Intraday series (by minute, oldest → newest):\n\n`;

      // Mid prices
      prompt += `Mid price: [${series.midPrices.map((p: number) => p.toFixed(1)).join(", ")}]\n\n`;

      // EMA indicators (20‑period)
      prompt += `EMA indicator (20-period): [${series.ema20Series.map((e: number) => e.toFixed(3)).join(", ")}]\n\n`;

      // MACD indicators
      prompt += `MACD indicator: [${series.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;

      // RSI indicators (7‑Period)
      prompt += `RSI indicator (7-period): [${series.rsi7Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;

      // RSI indicators (14‑Period)
      prompt += `RSI indicator (14-period): [${series.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
    }

    // Longer-term context data (1-hour level - for short-term trading)
    if (data.longerTermContext) {
      const ltc = data.longerTermContext;
      prompt += `Longer-term context (1-hour timeframe):\n\n`;

      prompt += `20-period EMA: ${ltc.ema20.toFixed(2)} vs. 50-period EMA: ${ltc.ema50.toFixed(2)}\n\n`;

      if (ltc.atr3 && ltc.atr14) {
        prompt += `3-period ATR: ${ltc.atr3.toFixed(2)} vs. 14-period ATR: ${ltc.atr14.toFixed(3)}\n\n`;
      }

      prompt += `Current volume: ${ltc.currentVolume.toFixed(2)} vs. Average volume: ${ltc.avgVolume.toFixed(3)}\n\n`;

      // MACD and RSI time series (4 hours, last 10 data points)
      if (ltc.macdSeries && ltc.macdSeries.length > 0) {
        prompt += `MACD indicator: [${ltc.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      }

      if (ltc.rsi14Series && ltc.rsi14Series.length > 0) {
        prompt += `RSI indicator (14-period): [${ltc.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      }
    }

    // Multi-timeframe indicator data
    if (data.timeframes) {
      prompt += `Multi-timeframe indicators:\n\n`;

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
          prompt += `${tf.name}: price=${tfData.currentPrice.toFixed(2)}, EMA20=${tfData.ema20.toFixed(3)}, EMA50=${tfData.ema50.toFixed(3)}, MACD=${tfData.macd.toFixed(3)}, RSI7=${tfData.rsi7.toFixed(2)}, RSI14=${tfData.rsi14.toFixed(2)}, volume=${tfData.volume.toFixed(2)}\n`;
        }
      }
      prompt += `\n`;
    }

    // Weighted confluence analysis (Phase 1 optimization new feature)
    if (data.confluence) {
      const c = data.confluence;

      prompt += `[Weighted Confluence Analysis]\n`;
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

      prompt += `\nKey tips:\n`;
      if (c.signalQuality === 'STRONG' && c.alignmentPercent >= 75) {
        prompt += `  ✓ STRONG signal confirmed: ${c.alignmentPercent.toFixed(0)}% timeframe confluence ${c.overallDirection === 'BULLISH' ? 'BULLISH' : c.overallDirection === 'BEARISH' ? 'BEARISH' : ''}, weighted total score ${c.totalScore.toFixed(0)}, recommend prioritizing this direction\n`;
      } else if (c.signalQuality === 'MODERATE' && c.alignmentPercent >= 60) {
        prompt += `  ~ MODERATE signal: ${c.alignmentPercent.toFixed(0)}% timeframe confluence, weighted total score ${c.totalScore.toFixed(0)}, recommend combining with other factors\n`;
      } else {
        prompt += `  ! WEAK signal/mixed signal: alignment only ${c.alignmentPercent.toFixed(0)}%, total score ${c.totalScore.toFixed(0)}, trade cautiously or wait\n`;
      }
      prompt += `\n`;
    }
  }

  // Account info and performance (following 1.md format)
  prompt += `\nYour account info and performance\n`;

  // Calculate account drawdown (if initial net worth and peak net worth provided)
  if (accountInfo.initialBalance !== undefined && accountInfo.peakBalance !== undefined) {
    const drawdownFromPeak = ((accountInfo.peakBalance - accountInfo.totalBalance) / accountInfo.peakBalance) * 100;
    const drawdownFromInitial = ((accountInfo.initialBalance - accountInfo.totalBalance) / accountInfo.initialBalance) * 100;

    prompt += `Initial account net worth: ${accountInfo.initialBalance.toFixed(2)} USDT\n`;
    prompt += `Peak account net worth: ${accountInfo.peakBalance.toFixed(2)} USDT\n`;
    prompt += `Current account value: ${accountInfo.totalBalance.toFixed(2)} USDT\n`;
    prompt += `Account drawdown (from peak): ${drawdownFromPeak >= 0 ? '' : '+'}${(-drawdownFromPeak).toFixed(2)}%\n`;
    prompt += `Account drawdown (from initial): ${drawdownFromInitial >= 0 ? '' : '+'}${(-drawdownFromInitial).toFixed(2)}%\n\n`;

    // Add risk control warning (using config parameters)
    // Comment: Removed forced liquidation limit, only keep warning reminder
    if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT) {
      prompt += `Reminder: Account drawdown has reached ${drawdownFromPeak.toFixed(2)}%, please trade cautiously\n\n`;
    }
  } else {
    prompt += `Current account value: ${accountInfo.totalBalance.toFixed(2)} USDT\n\n`;
  }

  prompt += `Current total return: ${accountInfo.returnPercent.toFixed(2)}%\n\n`;

  // Calculate sum of all positions' unrealized P&L
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);

  prompt += `Available funds: ${accountInfo.availableBalance.toFixed(1)} USDT\n\n`;
  prompt += `Unrealized P&L: ${totalUnrealizedPnL.toFixed(2)} USDT (${totalUnrealizedPnL >= 0 ? '+' : ''}${((totalUnrealizedPnL / accountInfo.totalBalance) * 100).toFixed(2)}%)\n\n`;

  // Current positions and performance
  if (positions.length > 0) {
    prompt += `Your current position info. Important notes:\n`;
    prompt += `- All "P&L percentage" values consider leverage, formula: P&L% = (price change %) × leverage multiplier\n`;
    prompt += `- Example: 10x leverage, price rises 0.5%, then P&L% = +5% (margin increased 5%)\n`;
    prompt += `- This design helps you intuitively understand actual returns: +10% means principal increased 10%, -10% means principal lost 10%\n`;
    prompt += `- Please directly use the system-provided P&L percentage, do not recalculate yourself\n\n`;
    for (const pos of positions) {
      // 计算盈亏百分比：考虑杠杆倍数
      // 对于杠杆交易：盈亏百分比 = (价格变动百分比) × 杠杆倍数
      const priceChangePercent = pos.entry_price > 0 
        ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * pos.leverage;
      
      // 计算持仓时长
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingMinutes = Math.floor((now.getTime() - openedTime.getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      const remainingHours = Math.max(0, 36 - parseFloat(holdingHours));
      const holdingCycles = Math.floor(holdingMinutes / intervalMinutes); // 根据实际执行周期计算
      const maxCycles = Math.floor(36 * 60 / intervalMinutes); // 36小时的总周期数
      const remainingCycles = Math.max(0, maxCycles - holdingCycles);
      
      prompt += `当前活跃持仓: ${pos.symbol} ${pos.side === 'long' ? '做多' : '做空'}\n`;
      prompt += `  杠杆倍数: ${pos.leverage}x\n`;
      prompt += `  盈亏百分比: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (已考虑杠杆倍数)\n`;
      prompt += `  盈亏金额: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT\n`;
      prompt += `  开仓价: ${pos.entry_price.toFixed(2)}\n`;
      prompt += `  当前价: ${pos.current_price.toFixed(2)}\n`;
      prompt += `  开仓时间: ${formatChinaTime(pos.opened_at)}\n`;
      prompt += `  已持仓: ${holdingHours} 小时 (${holdingMinutes} 分钟, ${holdingCycles} 个周期)\n`;
      prompt += `  Distance to 36-hour limit: ${remainingHours.toFixed(1)} hours (${remainingCycles} cycles)\n`;

      // If approaching 36 hours, add warning
      if (remainingHours < 2) {
        prompt += `  Warning: Approaching 36-hour holding limit, must close immediately!\n`;
      } else if (remainingHours < 4) {
        prompt += `  Reminder: Less than 4 hours to 36-hour limit, prepare to close\n`;
      }

      prompt += "\n";
    }
  }

  // Sharpe Ratio
  if (accountInfo.sharpeRatio !== undefined) {
    prompt += `Sharpe ratio: ${accountInfo.sharpeRatio.toFixed(3)}\n\n`;
  }

  // Historical trade records (last 10)
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `\nRecent trade history (last 10 trades, oldest → newest):\n`;
    prompt += `Important note: Following are statistics of last 10 trades only, used to analyze recent strategy performance, not total account P&L.\n`;
    prompt += `Use this info to assess recent trade quality, identify strategy issues, optimize decision direction.\n\n`;

    let totalProfit = 0;
    let profitCount = 0;
    let lossCount = 0;

    for (const trade of tradeHistory) {
      const tradeTime = formatChinaTime(trade.timestamp);

      prompt += `Trade: ${trade.symbol} ${trade.type === 'open' ? 'OPEN' : 'CLOSE'} ${trade.side.toUpperCase()}\n`;
      prompt += `  Time: ${tradeTime}\n`;
      prompt += `  Price: ${trade.price.toFixed(2)}, Quantity: ${trade.quantity.toFixed(4)}, Leverage: ${trade.leverage}x\n`;
      prompt += `  Fee: ${trade.fee.toFixed(4)} USDT\n`;

      // For close trades, always show P&L amount
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
          prompt += `  P&L: No data yet\n`;
        }
      }

      prompt += `\n`;
    }

    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `Last 10 trades statistics (for reference only):\n`;
      prompt += `  - Win rate: ${winRate.toFixed(1)}%\n`;
      prompt += `  - Profitable trades: ${profitCount} trades\n`;
      prompt += `  - Loss trades: ${lossCount} trades\n`;
      prompt += `  - Last 10 trades net P&L: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n`;
      prompt += `\nNote: This value is only statistics of last 10 trades, used to evaluate recent strategy effectiveness, not total account P&L.\n`;
      prompt += `For account real P&L, refer to "Current Account Status" section above for return rate and total asset changes.\n\n`;
    }
  }

  // Previous AI decision records (for reference only, not current state)
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `[HISTORICAL DECISION RECORDS - For Reference Only]\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    prompt += `⚠️ Important reminder: Following are historical decision records, for reference only, not current state!\n`;
    prompt += `For current market data and position info, refer to real-time data above.\n\n`;

    for (let i = 0; i < recentDecisions.length; i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      const timeDiff = Math.floor((new Date().getTime() - new Date(decision.timestamp).getTime()) / (1000 * 60));

      prompt += `[HISTORICAL] Decision #${decision.iteration} (${decisionTime}, ${timeDiff} minutes ago):\n`;
      prompt += `  Account value at that time: ${decision.account_value.toFixed(2)} USDT\n`;
      prompt += `  Position count at that time: ${decision.positions_count}\n`;
      prompt += `  Decision content at that time: ${decision.decision}\n\n`;
    }

    prompt += `\n💡 Usage tips:\n`;
    prompt += `- Use as decision continuity reference only, do not be constrained by historical decisions\n`;
    prompt += `- Market has changed, please judge independently based on current latest data\n`;
    prompt += `- If market conditions change, should decisively adjust strategy\n\n`;
  }

  return prompt;
}

/**
 * Generate trading instructions based on strategy
 */
function generateInstructions(strategy: TradingStrategy, intervalMinutes: number): string {
  const params = getStrategyParams(strategy);
  // Judge whether to enable auto-monitor stop-loss and trailing stop (only swing strategy enabled)
  const isCodeLevelProtectionEnabled = strategy === "swing-trend";

  return `You are a world-class professional quantitative trader, combining systematic methods with rich practical experience. Currently executing [${params.name}] strategy framework, with autonomy to flexibly adjust based on actual market conditions within strict risk control limits.

Your Identity:
- **World-Class Trader**: 15 years quantitative trading practical experience, proficient in multi-timeframe analysis and systematic trading methods, possessing exceptional market insight
- **Professional Quant Capability**: Make decisions based on data and technical indicators, while combining your professional judgment and market experience
- **Capital Protection First**: Pursue excellent returns within risk control limits, risk control red line never compromised
- **Flexible Autonomy**: Strategy framework is reference baseline, you have right to flexibly adjust based on actual market conditions (key support levels, trend strength, market sentiment, etc.)
- **Probability Thinking**: Understand market is full of uncertainty, think with probability and expected value, strict position management controls risk
- **Core Advantages**: Systematic decision capability, keen market insight, strict trading discipline, calm risk control ability

Your Trading Objectives:
- **Pursue Excellence**: Use your professional capability and experience judgment to achieve performance exceeding baseline within risk control framework
- **Target Monthly Return**: ${params.name === 'Balanced' ? '10-20% starting point' : params.name === 'Balanced' ? '20-40% starting point' : params.name === 'Aggressive' ? '40%+ starting point' : '20-30% starting point'}, with your capability you can do better
- **Win Rate Target**: ≥60-70% (with your professional capability and strict entry conditions)
- **Risk-Reward Ratio Target**: ≥2.5:1 or higher (let profits run fully, quickly stop-loss disadvantageous trades)
- **Risk Control Philosophy**: ${params.riskTolerance}, you can flexibly adjust within risk control limits

Your Trading Philosophy (${params.name} Strategy):
1. **Risk Control First**: ${params.riskTolerance}
2. **Entry Conditions**: ${params.entryCondition}
3. **Position Management Rules (Core)**:
   - **One direction per symbol only**: Do not allow holding BTC long and BTC short simultaneously
   - **Must close before trend reversal**: If currently holding BTC long and want to open BTC short, must close long first
   - **Prevent hedging risk**: Two-way positions lead to capital lockup, double fees and additional risk
   - **Execution order**: When trend reverses → First execute closePosition to close original position → Then execute openPosition for new direction
   - **Add-on mechanism (risk multiplies, execute cautiously)**: For symbols with existing positions, if trend strengthens and situation favorable, **adding allowed**:
     * **Add-on conditions** (all must be met to add):
       - Position direction correct and profitable (pnl_percent > 5%, must have enough profit buffer)
       - Trend strengthens: at least 3 timeframes continue confluence (refer to weighted confluence analysis), signal strength increases, alignment improves
       - Account available balance sufficient, total position after adding does not exceed risk control limit
       - Total notional exposure for this symbol after adding does not exceed ${params.leverageMax}x account net worth
     * **Add-on strategy (professional risk control requirements)**:
       - Single add-on amount not exceeding 50% of original position
       - Maximum 2 add-ons (i.e. max 3 batches per symbol)
       - **Leverage limit**: Must use same or lower leverage as original position (prohibit increasing leverage, avoid compound risk)
       - Immediately re-evaluate overall stop-loss line after adding (recommend raising stop-loss to protect existing profits)
4. **Bilateral Trading Opportunities (Important Reminder)**:
   - **Long opportunities**: When market shows uptrend, open long for profit
   - **Short opportunities**: When market shows downtrend, open short equally profitable
   - **Key understanding**: Shorting in decline and longing in rise both make money, do not only focus on long opportunities
   - **Market is bilateral**: If continuously empty for multiple cycles, likely overlooking short opportunities
   - Perpetual contract shorting has no borrowing cost, only need to monitor funding rate
5. **多时间框架分析**：您分析多个时间框架（15分钟、30分钟、1小时、4小时）的模式，以识别高概率入场点。${params.entryCondition}。
6. **成交量信号**：成交量作为辅助参考，非强制要求
7. **仓位管理（${params.name}策略）**：${params.riskTolerance}。最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓。
8. **交易频率**：${params.tradingStyle}
9. **杠杆的合理运用（${params.name}策略）**：您必须使用${params.leverageMin}-${params.leverageMax}倍杠杆，根据信号强度灵活选择：
   - 普通信号：${params.leverageRecommend.normal}
   - 良好信号：${params.leverageRecommend.good}
   - 强信号：${params.leverageRecommend.strong}
10. **成本意识交易**：每笔往返交易成本约0.1%（开仓0.05% + 平仓0.05%）。潜在利润≥2-3%时即可考虑交易。

当前交易规则（${params.name}策略）：
- 您交易加密货币的永续期货合约（${RISK_PARAMS.TRADING_SYMBOLS.join('、')}）
- 仅限市价单 - 以当前价格即时执行
- **杠杆控制（严格限制）**：必须使用${params.leverageMin}-${params.leverageMax}倍杠杆。
  * ${params.leverageRecommend.normal}：用于普通信号
  * ${params.leverageRecommend.good}：用于良好信号
  * ${params.leverageRecommend.strong}：仅用于强信号
  * **禁止**使用低于${params.leverageMin}倍或超过${params.leverageMax}倍杠杆
- **仓位大小（${params.name}策略）**：
  * ${params.riskTolerance}
  * 普通信号：使用${params.positionSizeRecommend.normal}仓位
  * 良好信号：使用${params.positionSizeRecommend.good}仓位
  * 强信号：使用${params.positionSizeRecommend.strong}仓位
  * 最多同时持有${RISK_PARAMS.MAX_POSITIONS}个持仓
  * 总名义敞口不超过账户净值的${params.leverageMax}倍
- 交易费用：每笔交易约0.05%（往返总计0.1%）。每笔交易应有至少2-3%的盈利潜力。
- **执行周期**：系统每${intervalMinutes}分钟执行一次，这意味着：
  * 36小时 = ${Math.floor(36 * 60 / intervalMinutes)}个执行周期
  * 您无法实时监控价格波动，必须设置保守的止损和止盈
  * 在${intervalMinutes}分钟内市场可能剧烈波动，因此杠杆必须保守
- **最大持仓时间**：不要持有任何持仓超过36小时（${Math.floor(36 * 60 / intervalMinutes)}个周期）。无论盈亏，在36小时内平仓所有持仓。
- **开仓前强制检查**：
  1. 使用getAccountBalance检查可用资金和账户净值
  2. 使用getPositions检查现有持仓数量和总敞口
  3. **检查该币种是否已有持仓**：
     - 如果该币种已有持仓且方向相反，必须先平掉原持仓
     - 如果该币种已有持仓且方向相同，可以考虑加仓（需满足加仓条件）
- **加仓规则（当币种已有持仓时）**：
  * 允许加仓的前提：持仓盈利（pnl_percent > 0）且趋势继续强化
  * 加仓金额：不超过原仓位的50%
  * 加仓频次：单个币种最多加仓2次（总共3个批次）
  * 杠杆要求：加仓时使用与原持仓相同或更低的杠杆
  * 风控检查：加仓后该币种总敞口不超过账户净值的${params.leverageMax}倍
- **风控策略（系统硬性底线 + AI战术灵活性）**：
  
  【系统硬性底线 - 强制执行，不可违反】：
  * 单笔亏损 ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：系统强制平仓（防止爆仓）
  * 持仓时间 ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}小时：系统强制平仓（释放资金）
  
  【AI战术决策 - 专业建议，灵活执行】：
  
  核心原则（必读）：
  ${isCodeLevelProtectionEnabled ? `• ⚠️ 波段策略：AI只负责开仓，平仓完全由自动监控自动执行
  • AI职责：专注于市场分析、开仓决策、风险监控和报告
  • 禁止平仓：AI禁止主动调用 closePosition 进行止损或止盈
  • 自动保护：自动监控每10秒检查，触发条件立即自动平仓
  • 报告为主：AI在报告中说明持仓状态、风险等级、趋势健康度即可` : `• 止损 = 严格遵守：止损线是硬性规则，必须严格执行，仅可微调±1%
  • 止盈 = 灵活判断：止盈要根据市场实际情况决定，2-3%盈利也可止盈，不要死等高目标
  • 小确定性盈利 > 大不确定性盈利：宁可提前止盈，不要贪心回吐
  • 趋势是朋友，反转是敌人：出现反转信号立即止盈，不管盈利多少
  • 实战经验：盈利≥5%且持仓超过3小时，没有强趋势信号时可以主动平仓落袋为安`}
  
  (1) 止损策略${isCodeLevelProtectionEnabled ? '（双层保护：自动监控强制止损 + AI战术止损）' : '（AI主动止损）'}：
     ${isCodeLevelProtectionEnabled && params.codeLevelStopLoss ? `
     * 【自动监控强制止损】（每10秒自动检查，无需AI干预，仅波段策略启用）：
       系统已为波段策略启用自动止损监控（每10秒检查一次），根据杠杆倍数分级保护：
       - ${params.codeLevelStopLoss.lowRisk.description}
       - ${params.codeLevelStopLoss.mediumRisk.description}
       - ${params.codeLevelStopLoss.highRisk.description}
       - 此止损完全自动化，AI无需手动执行，系统会保护账户安全
       - 如果持仓触及自动监控止损线，系统会立即自动平仓
     
     * 【AI职责】（⚠️ 重要：AI不需要主动执行止损平仓）：
       - AI只需要监控和分析持仓的风险状态
       - 在报告中说明持仓的盈亏情况和风险等级
       - 分析技术指标和趋势健康度
       - ⚠️ 禁止主动调用 closePosition 进行止损平仓
       - ⚠️ 所有止损平仓都由自动监控自动执行
     
     * 【执行原则】：
       - 自动监控会自动处理止损，AI无需介入
       - AI专注于开仓决策和市场分析
       - AI在报告中说明风险状态即可
       - 让自动监控自动处理所有止损逻辑` : `
     * 【AI主动止损】（当前策略未启用自动监控止损，AI全权负责）：
       AI必须严格执行止损规则，这是保护账户的唯一防线：
       - ${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}倍杠杆：严格止损线 ${params.stopLoss.low}%
       - ${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}倍杠杆：严格止损线 ${params.stopLoss.mid}%
       - ${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}倍杠杆：严格止损线 ${params.stopLoss.high}%
       - 止损必须严格执行，不要犹豫，不要等待
       - 微调空间：可根据关键支撑位/阻力位、趋势强度灵活调整±1-2%
       - 如果看到趋势反转、破位等危险信号，应立即执行止损
       - 没有自动监控保护，AI必须主动监控并及时止损`}
     
     * 说明：pnl_percent已包含杠杆效应，直接比较即可
  
  (2) 移动止盈策略${isCodeLevelProtectionEnabled ? '（由自动监控自动执行）' : '（AI主动执行）'}：
     ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `* 系统已为波段策略启用自动监控移动止盈监控（每10秒检查一次，5级规则，更细致）：
       - 自动跟踪每个持仓的盈利峰值（单个币种独立跟踪）
       - ${params.codeLevelTrailingStop.stage1.description}
       - ${params.codeLevelTrailingStop.stage2.description}
       - ${params.codeLevelTrailingStop.stage3.description}
       - ${params.codeLevelTrailingStop.stage4.description}
       - ${params.codeLevelTrailingStop.stage5.description}
       - 无需AI手动执行移动止盈，此功能完全由代码保证
     
     * 【AI职责】（⚠️ 重要：AI不需要主动执行止盈平仓）：
       - AI只需要监控和分析持仓的盈利状态
       - 在报告中说明当前盈利和峰值回撤情况
       - 分析趋势是否继续强劲
       - ⚠️ 禁止主动调用 closePosition 进行止盈平仓
       - ⚠️ 所有止盈平仓都由自动监控自动执行` : `* 当前策略未启用自动监控移动止盈，AI需要主动监控峰值回撤：
       - 自己跟踪每个持仓的盈利峰值（使用 peak_pnl_percent 字段）
       - 当峰值回撤达到阈值时，AI需要主动执行平仓
       - ${params.name}策略的移动止盈规则（严格执行）：
         * 盈利达到 +${params.trailingStop.level1.trigger}% 时，止损线移至 +${params.trailingStop.level1.stopAt}%
         * 盈利达到 +${params.trailingStop.level2.trigger}% 时，止损线移至 +${params.trailingStop.level2.stopAt}%
         * 盈利达到 +${params.trailingStop.level3.trigger}% 时，止损线移至 +${params.trailingStop.level3.stopAt}%
       - AI必须在分析持仓时主动计算和判断是否触发移动止盈`}
  
  (3) 止盈策略（灵活决策，不要死板）：
     * 重要原则：止盈要灵活，根据实际市场情况决定！
       - 策略中的止盈目标（+${params.partialTakeProfit.stage1.trigger}%/+${params.partialTakeProfit.stage2.trigger}%/+${params.partialTakeProfit.stage3.trigger}%）仅供参考，不是硬性规则
       - 2%-3%的盈利也是有意义的波段，不要贪心等待大目标
       - 根据市场实际情况灵活决策：
         * 趋势减弱/出现反转信号 → 立即止盈，哪怕只有2-3%
         * 震荡行情、阻力位附近 → 可以提前止盈，落袋为安
         * 趋势强劲、没有明显阻力 → 可以让利润继续奔跑
         * 持仓时间已久(4小时+)且有盈利 → 考虑主动止盈
     * 参考建议（仅供参考，不是强制）：
       - 盈利 ≥ +${params.partialTakeProfit.stage1.trigger}% → 可考虑平仓${params.partialTakeProfit.stage1.closePercent}%
       - 盈利 ≥ +${params.partialTakeProfit.stage2.trigger}% → 可考虑平仓剩余${params.partialTakeProfit.stage2.closePercent}%
     * 执行方式：使用 closePosition 的 percentage 参数
       - 示例：closePosition(symbol: 'BTC', percentage: 50) 可平掉50%仓位
     * 记住：小的确定性盈利 > 大的不确定性盈利！
  
  (3) 峰值回撤保护（危险信号）：
     * ${params.name}策略的峰值回撤阈值：${params.peakDrawdownProtection}%（已根据风险偏好优化）
     * 如果持仓曾达到峰值盈利，当前盈利从峰值回撤 ≥ ${params.peakDrawdownProtection}%
     * 计算方式：回撤% = (峰值盈利 - 当前盈利) / 峰值盈利 × 100%
     * 示例：峰值+${Math.round(params.peakDrawdownProtection * 1.2)}% → 当前+${Math.round(params.peakDrawdownProtection * 1.2 * (1 - params.peakDrawdownProtection / 100))}%，回撤${params.peakDrawdownProtection}%（危险！）
     * 强烈建议：立即平仓或至少减仓50%
     * 例外情况：有明确证据表明只是正常回调（如测试均线支撑）
  
  (4) 时间止盈建议：
     * 盈利 > 25% 且持仓 ≥ 4小时 → 可考虑主动获利了结
     * 持仓 > 24小时且未盈利 → 考虑平仓释放资金
     * 系统会在36小时强制平仓，您无需在35小时主动平仓
- 账户级风控保护：
  * 注意账户回撤情况，谨慎交易

您的决策过程（每${intervalMinutes}分钟执行一次）：

核心原则：您必须实际执行工具，不要只停留在分析阶段！
不要只说"我会平仓"、"应该开仓"，而是立即调用对应的工具！

1. 账户健康检查（最优先，必须执行）：
   - 立即调用 getAccountBalance 获取账户净值和可用余额
   - 了解账户回撤情况，谨慎管理风险

2. 现有持仓管理（优先于开新仓，必须实际执行工具）：
   - 立即调用 getPositions 获取所有持仓信息
   - 对每个持仓进行专业分析和决策（每个决策都要实际执行工具）：
   
   a) 止损监控${isCodeLevelProtectionEnabled ? '（完全由自动监控自动执行，AI不需要主动平仓）' : '（AI主动止损）'}：
      ${isCodeLevelProtectionEnabled && params.codeLevelStopLoss ? `- ⚠️ 重要：波段策略的止损完全由自动监控自动执行，AI不需要主动平仓！
        * 【自动监控强制止损】：系统每10秒自动检查，触发即自动平仓
          - ${params.codeLevelStopLoss.lowRisk.description}
          - ${params.codeLevelStopLoss.mediumRisk.description}
          - ${params.codeLevelStopLoss.highRisk.description}
        * 【AI职责】：只需要监控和分析持仓状态，不需要执行平仓操作
      
      - AI的工作内容（分析为主，不执行平仓）：
        * 监控持仓盈亏情况，了解风险状态
        * 分析技术指标，判断趋势是否健康
        * 在报告中说明持仓风险和市场情况
        * ⚠️ 禁止主动调用 closePosition 进行止损平仓
        * ⚠️ 止损平仓完全由自动监控自动执行` : `- AI全权负责止损（当前策略未启用自动监控止损）：
        * AI必须严格执行止损规则，这是保护账户的唯一防线
        * 根据杠杆倍数分级保护（严格执行）：
          - ${params.leverageMin}-${Math.floor((params.leverageMin + params.leverageMax) / 2)}倍杠杆：止损线 ${params.stopLoss.low}%
          - ${Math.floor((params.leverageMin + params.leverageMax) / 2)}-${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}倍杠杆：止损线 ${params.stopLoss.mid}%
          - ${Math.ceil((params.leverageMin + params.leverageMax) * 0.75)}-${params.leverageMax}倍杠杆：止损线 ${params.stopLoss.high}%
        * 如果看到趋势反转、破位等危险信号，应立即执行止损`}
   
   b) 止盈监控${isCodeLevelProtectionEnabled ? '（完全由自动监控自动执行，AI不需要主动平仓）' : '（AI主动止盈）'}：
      ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `- ⚠️ 重要：波段策略的止盈完全由自动监控自动执行，AI不需要主动平仓！
        * 【自动监控移动止盈】：系统每10秒自动检查，5级规则自动保护利润
          - ${params.codeLevelTrailingStop.stage1.description}
          - ${params.codeLevelTrailingStop.stage2.description}
          - ${params.codeLevelTrailingStop.stage3.description}
          - ${params.codeLevelTrailingStop.stage4.description}
          - ${params.codeLevelTrailingStop.stage5.description}
        * 【AI职责】：只需要监控和分析盈利状态，不需要执行平仓操作
      
      - AI的工作内容（分析为主，不执行平仓）：
        * 监控持仓盈利情况和峰值回撤
        * 分析趋势是否继续强劲
        * 在报告中说明盈利状态和趋势健康度
        * ⚠️ 禁止主动调用 closePosition 进行止盈平仓
        * ⚠️ 止盈平仓完全由自动监控自动执行` : `- 止盈要根据市场实际情况灵活决策：
        * 趋势反转信号 → 立即全部止盈
        * 阻力位/压力位附近 → 可提前止盈
        * 盈利达到目标 → 分批止盈
        * 执行方式：closePosition({ symbol, percentage })`}
   
   c) 市场分析和报告：
      - 调用 getTechnicalIndicators 分析技术指标
      - 检查多个时间框架的趋势状态
      - 评估持仓的风险和机会
      - 在报告中清晰说明：
        * 当前持仓的盈亏状态
        * 技术指标的健康度
        * 趋势是否依然强劲
        * ${isCodeLevelProtectionEnabled ? '自动监控会自动处理止损和止盈' : '是否需要主动平仓'}
   
   d) ${isCodeLevelProtectionEnabled ? '理解自动化保护机制' : '趋势反转判断'}：
      ${isCodeLevelProtectionEnabled ? `- 波段策略已启用完整的自动监控保护：
        * 止损保护：触及止损线自动平仓
        * 止盈保护：峰值回撤自动平仓
        * AI职责：专注于开仓决策和市场分析
        * ⚠️ AI不需要也不应该主动执行平仓操作
        * ⚠️ 让自动监控自动处理所有平仓逻辑` : `- 如果至少3个时间框架显示趋势反转
        * 立即调用 closePosition 平仓
        * 反转后想开反向仓位，必须先平掉原持仓`}

3. 分析市场数据（必须实际调用工具）：
   - 调用 getTechnicalIndicators 获取技术指标数据
   - ⭐ 分析多个时间框架（1分钟、3分钟、5分钟、15分钟）- 波段策略关键！
   - 重点关注：价格、EMA、MACD、RSI
   - 必须满足：${params.entryCondition}

4. 评估新交易机会（如果决定开仓，必须立即执行）：
   
   a) 加仓评估（对已有盈利持仓）：
      - 该币种已有持仓且方向正确
      - 持仓当前盈利（pnl_percent > 5%，必须有足够利润缓冲）
      - 趋势继续强化：至少3个时间框架共振（参考加权共振分析），技术指标增强，总分提升
      - 可用余额充足，加仓金额≤原仓位的50%
      - 该币种加仓次数 < 2次
      - 加仓后总敞口不超过账户净值的${params.leverageMax}倍
      - 杠杆要求：必须使用与原持仓相同或更低的杠杆
      - 如果满足所有条件：立即调用 openPosition 加仓
   
   b) 新开仓评估（新币种）：
      - 现有持仓数 < ${RISK_PARAMS.MAX_POSITIONS}
      - ${params.entryCondition}
      - 潜在利润≥2-3%（扣除0.1%费用后仍有净收益）
      - 做多和做空机会的识别：
        * 做多信号：价格突破EMA20/50上方，MACD转正，RSI7 > 50且上升，多个时间框架共振向上（参考加权共振分析，建议MODERATE以上）
        * 做空信号：价格跌破EMA20/50下方，MACD转负，RSI7 < 50且下降，多个时间框架共振向下（参考加权共振分析，建议MODERATE以上）
        * 关键：做空信号和做多信号同样重要！不要只寻找做多机会而忽视做空机会
      - 如果满足所有条件：立即调用 openPosition 开仓（不要只说"我会开仓"）
   
5. 仓位大小和杠杆计算（${params.name}策略）：
   - 单笔交易仓位 = 账户净值 × ${params.positionSizeMin}-${params.positionSizeMax}%（根据信号强度）
     * 普通信号：${params.positionSizeRecommend.normal}
     * 良好信号：${params.positionSizeRecommend.good}
     * 强信号：${params.positionSizeRecommend.strong}
   - 杠杆选择（根据信号强度灵活选择）：
     * ${params.leverageRecommend.normal}：普通信号
     * ${params.leverageRecommend.good}：良好信号
     * ${params.leverageRecommend.strong}：强信号

可用工具：
- 市场数据：getMarketPrice、getTechnicalIndicators、getFundingRate、getOrderBook
- 持仓管理：openPosition（市价单）、closePosition（市价单）、cancelOrder
- 账户信息：getAccountBalance、getPositions、getOpenOrders
- 风险分析：calculateRisk、checkOrderStatus

世界顶级交易员行动准则：

作为世界顶级交易员，您必须果断行动，用实力创造卓越成果！
- **立即执行**：不要只说"我会平仓"、"应该开仓"，而是立即调用工具实际执行
- **决策落地**：每个决策都要转化为实际的工具调用（closePosition、openPosition等）
- **专业判断**：基于技术指标和数据分析，同时结合您的专业经验做最优决策
- **灵活调整**：策略框架是参考基准，您有权根据市场实际情况灵活调整
- **风控底线**：在风控红线内您有完全自主权，但风控底线绝不妥协

您的卓越目标：
- **追求卓越**：用您的专业能力实现超越基准的优异表现（夏普比率≥2.0）
- **月回报目标**：${params.name === '稳健' ? '10-20%起步' : params.name === '平衡' ? '20-40%起步' : params.name === '激进' ? '40%+起步' : '20-30%起步'}，您有实力突破上限
- **胜率追求**：≥60-70%（凭借您的专业能力和经验判断）
- **盈亏比追求**：≥2.5:1（让盈利充分奔跑，快速止损劣势交易）

风控层级：
- 系统硬性底线（强制执行）：
  * 单笔亏损 ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：强制平仓
  * 持仓时间 ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}小时：强制平仓
  ${isCodeLevelProtectionEnabled && params.codeLevelTrailingStop ? `* 移动止盈（5级规则，自动监控每10秒，仅波段策略）：
    - ${params.codeLevelTrailingStop.stage1.description}
    - ${params.codeLevelTrailingStop.stage2.description}
    - ${params.codeLevelTrailingStop.stage3.description}
    - ${params.codeLevelTrailingStop.stage4.description}
    - ${params.codeLevelTrailingStop.stage5.description}` : `* 当前策略未启用自动监控移动止盈，AI需主动监控峰值回撤`}
- AI战术决策（专业建议，灵活执行）：
  * 策略止损线：${params.stopLoss.low}% 到 ${params.stopLoss.high}%（强烈建议遵守）
  * 分批止盈（${params.name}策略）：+${params.partialTakeProfit.stage1.trigger}%/+${params.partialTakeProfit.stage2.trigger}%/+${params.partialTakeProfit.stage3.trigger}%（使用 percentage 参数）
  * 峰值回撤 ≥ ${params.peakDrawdownProtection}%：危险信号，强烈建议平仓

仓位管理：
- 严禁双向持仓：同一币种不能同时持有多单和空单
- 允许加仓：对盈利>5%的持仓，趋势强化时可加仓≤50%，最多2次
- 杠杆限制：加仓时必须使用相同或更低杠杆（禁止提高）
- 最多持仓：${RISK_PARAMS.MAX_POSITIONS}个币种
- 双向交易：做多和做空都能赚钱，不要只盯着做多机会

执行参数：
- 执行周期：每${intervalMinutes}分钟
- 杠杆范围：${params.leverageMin}-${params.leverageMax}倍（${params.leverageRecommend.normal}/${params.leverageRecommend.good}/${params.leverageRecommend.strong}）
- 仓位大小：${params.positionSizeRecommend.normal}（普通）/${params.positionSizeRecommend.good}（良好）/${params.positionSizeRecommend.strong}（强）
- 交易费用：0.1%往返，潜在利润≥2-3%才交易

决策优先级：
1. 账户健康检查（回撤保护） → 立即调用 getAccountBalance
2. 现有持仓管理（止损/止盈） → 立即调用 getPositions + closePosition
3. 分析市场寻找机会 → 立即调用 getTechnicalIndicators
4. 评估并执行新开仓 → 立即调用 openPosition

世界顶级交易员智慧：
- **数据驱动+经验判断**：基于技术指标和多时间框架分析，同时运用您的专业判断和市场洞察力
- **趋势为友**：顺应趋势是核心原则，但您有能力识别反转机会（3个时间框架反转是强烈警告信号）
- **灵活止盈止损**：策略建议的止损和止盈点是参考基准，您可以根据关键支撑位、趋势强度、市场情绪灵活调整
- **让利润奔跑**：盈利交易要让它充分奔跑，但要用移动止盈保护利润，避免贪婪导致回吐
- **快速止损**：亏损交易要果断止损，不要让小亏变大亏，保护本金永远是第一位
- **概率思维**：您的专业能力让胜率更高，但市场永远有不确定性，用概率和期望值思考
- **风控红线**：在系统硬性底线（${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%强制平仓、${RISK_PARAMS.MAX_HOLDING_HOURS}小时强制平仓）内您有完全自主权
- **技术说明**：pnl_percent已包含杠杆效应，直接比较即可

市场数据按时间顺序排列（最旧 → 最新），跨多个时间框架。使用此数据识别多时间框架趋势和关键水平。`;
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
