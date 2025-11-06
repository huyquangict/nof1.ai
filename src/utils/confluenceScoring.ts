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
 * 加权共振评分系统
 *
 * Purpose: 量化多时间框架指标的共振强度
 * - 解决二元"对齐/不对齐"判断丢失信号粒度的问题
 * - 为每个时间框架分配权重（长期时间框架权重更高）
 * - 计算每个指标的强度评分（0-10分）
 * - 输出综合共振分数和方向建议
 */

export interface TimeframeIndicators {
  interval: string;
  currentPrice: number;
  ema20: number;
  ema50: number;
  macd: number;
  rsi7: number;
  rsi14: number;
  volume: number;
  avgVolume?: number;
}

export interface SignalScore {
  priceVsEma20: number;     // 0-10分：价格相对EMA20的距离
  priceVsEma50: number;     // 0-10分：价格相对EMA50的距离
  macdStrength: number;     // 0-10分：MACD强度
  rsiPosition: number;      // 0-10分：RSI偏离中性位置的程度
  volumeConfirmation: number; // 0-10分：成交量确认
  totalScore: number;       // 总分（0-50）
  direction: "BULLISH" | "BEARISH" | "NEUTRAL"; // 方向
}

export interface TimeframeScore {
  interval: string;
  weight: number;
  signals: SignalScore;
  weightedScore: number;  // 加权后的分数
}

export interface ConfluenceResult {
  scores: TimeframeScore[];
  totalScore: number;           // 总加权分数（0-100）
  averageScore: number;         // 平均分数
  alignedTimeframes: number;    // 对齐的时间框架数量
  totalTimeframes: number;      // 总时间框架数量
  alignmentPercent: number;     // 对齐百分比
  overallDirection: "BULLISH" | "BEARISH" | "NEUTRAL"; // 整体方向
  signalQuality: "STRONG" | "MODERATE" | "WEAK"; // 信号质量
}

/**
 * 时间框架权重配置
 *
 * 原理：长期时间框架更重要，因为：
 * 1. 噪音更少，信号更可靠
 * 2. 代表更深层次的市场趋势
 * 3. 短期时间框架容易产生虚假信号
 */
const TIMEFRAME_WEIGHTS: Record<string, number> = {
  "1m": 1.0,   // 最短期，权重最低（噪音多）
  "3m": 1.5,   // 日内短期
  "5m": 2.0,   // 日内中期
  "15m": 2.5,  // 日内长期
  "30m": 3.0,  // 跨日中期
  "1h": 3.5,   // 周级别，权重最高（最可靠）
};

/**
 * 计算价格相对EMA的评分
 *
 * @param price 当前价格
 * @param ema EMA值
 * @returns 0-10分，越远离EMA分数越高
 */
function calculatePriceEmaScore(price: number, ema: number): number {
  if (price === 0 || ema === 0) return 0;

  // 计算价格偏离EMA的百分比
  const deviation = Math.abs((price - ema) / ema * 100);

  // 偏离度映射到0-10分
  // 0.5%偏离 = 1分
  // 1%偏离 = 2分
  // 5%偏离 = 10分
  const score = Math.min(deviation * 2, 10);

  return score;
}

/**
 * 计算MACD强度评分
 *
 * @param macd MACD值
 * @returns 0-10分，MACD绝对值越大分数越高
 */
function calculateMacdScore(macd: number): number {
  if (!Number.isFinite(macd)) return 0;

  // MACD绝对值映射到0-10分
  // |MACD| = 10 → 1分
  // |MACD| = 50 → 5分
  // |MACD| = 100+ → 10分
  const score = Math.min(Math.abs(macd) / 10, 10);

  return score;
}

/**
 * 计算RSI位置评分
 *
 * @param rsi RSI值（0-100）
 * @returns 0-10分，越偏离50中性位分数越高
 */
function calculateRsiScore(rsi: number): number {
  if (!Number.isFinite(rsi) || rsi < 0 || rsi > 100) return 0;

  // RSI偏离50的距离映射到0-10分
  // RSI=50（中性）→ 0分
  // RSI=60或40 → 2分
  // RSI=70或30 → 4分
  // RSI=85或15 → 7分
  // RSI=100或0 → 10分
  const deviation = Math.abs(rsi - 50);
  const score = Math.min(deviation / 5, 10);

  return score;
}

/**
 * 计算成交量确认评分
 *
 * @param volume 当前成交量
 * @param avgVolume 平均成交量
 * @returns 0-10分，成交量越高分数越高
 */
function calculateVolumeScore(volume: number, avgVolume: number = 0): number {
  if (volume === 0 || !Number.isFinite(volume)) return 0;
  if (avgVolume === 0 || !Number.isFinite(avgVolume)) return 5; // 默认中等分数

  // 成交量比率映射到0-10分
  // 成交量 = 平均值 → 5分
  // 成交量 = 1.5倍平均值 → 7.5分
  // 成交量 = 2倍+平均值 → 10分
  const ratio = volume / avgVolume;
  const score = Math.min(ratio * 5, 10);

  return score;
}

/**
 * 判断信号方向
 *
 * @param price 当前价格
 * @param ema20 EMA20
 * @param ema50 EMA50
 * @param macd MACD
 * @param rsi RSI
 * @returns 信号方向
 */
function determineDirection(
  price: number,
  ema20: number,
  ema50: number,
  macd: number,
  rsi: number
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  let bullishCount = 0;
  let bearishCount = 0;

  // 价格 vs EMA20
  if (price > ema20) bullishCount++;
  else if (price < ema20) bearishCount++;

  // 价格 vs EMA50
  if (price > ema50) bullishCount++;
  else if (price < ema50) bearishCount++;

  // MACD
  if (macd > 0) bullishCount++;
  else if (macd < 0) bearishCount++;

  // RSI
  if (rsi > 50) bullishCount++;
  else if (rsi < 50) bearishCount++;

  // 判断方向（需要3/4以上指标同意）
  if (bullishCount >= 3) return "BULLISH";
  if (bearishCount >= 3) return "BEARISH";
  return "NEUTRAL";
}

/**
 * 计算单个时间框架的信号评分
 *
 * @param indicators 时间框架指标
 * @returns 信号评分
 */
export function calculateTimeframeSignalScore(indicators: TimeframeIndicators): SignalScore {
  const priceVsEma20 = calculatePriceEmaScore(indicators.currentPrice, indicators.ema20);
  const priceVsEma50 = calculatePriceEmaScore(indicators.currentPrice, indicators.ema50);
  const macdStrength = calculateMacdScore(indicators.macd);
  const rsiPosition = calculateRsiScore(indicators.rsi14);
  const volumeConfirmation = calculateVolumeScore(indicators.volume, indicators.avgVolume);

  const totalScore = priceVsEma20 + priceVsEma50 + macdStrength + rsiPosition + volumeConfirmation;

  const direction = determineDirection(
    indicators.currentPrice,
    indicators.ema20,
    indicators.ema50,
    indicators.macd,
    indicators.rsi14
  );

  return {
    priceVsEma20,
    priceVsEma50,
    macdStrength,
    rsiPosition,
    volumeConfirmation,
    totalScore,
    direction,
  };
}

/**
 * 计算多时间框架加权共振评分
 *
 * @param timeframes 所有时间框架的指标数据
 * @returns 共振评分结果
 */
export function calculateWeightedConfluence(timeframes: TimeframeIndicators[]): ConfluenceResult {
  const scores: TimeframeScore[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  // 计算每个时间框架的评分
  for (const tf of timeframes) {
    const weight = TIMEFRAME_WEIGHTS[tf.interval] || 1.0;
    const signals = calculateTimeframeSignalScore(tf);
    const weightedScore = signals.totalScore * weight;

    scores.push({
      interval: tf.interval,
      weight,
      signals,
      weightedScore,
    });

    totalWeightedScore += weightedScore;
    totalWeight += weight;

    // 统计方向
    if (signals.direction === "BULLISH") bullishCount++;
    else if (signals.direction === "BEARISH") bearishCount++;
  }

  // 计算平均分数和对齐百分比
  const averageScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  const totalTimeframes = timeframes.length;
  const alignedTimeframes = Math.max(bullishCount, bearishCount);
  const alignmentPercent = totalTimeframes > 0 ? (alignedTimeframes / totalTimeframes) * 100 : 0;

  // 归一化总分到0-100
  // 最大可能分数：每个指标10分 × 5个指标 = 50分/时间框架
  // 最大加权分数：50 × 最大权重和
  const maxPossibleScore = 50 * totalWeight;
  const totalScore = maxPossibleScore > 0 ? (totalWeightedScore / maxPossibleScore) * 100 : 0;

  // 判断整体方向
  let overallDirection: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (bullishCount > bearishCount && bullishCount >= totalTimeframes * 0.5) {
    overallDirection = "BULLISH";
  } else if (bearishCount > bullishCount && bearishCount >= totalTimeframes * 0.5) {
    overallDirection = "BEARISH";
  }

  // 判断信号质量
  let signalQuality: "STRONG" | "MODERATE" | "WEAK" = "WEAK";
  if (totalScore >= 70 && alignmentPercent >= 75) {
    signalQuality = "STRONG";
  } else if (totalScore >= 50 && alignmentPercent >= 60) {
    signalQuality = "MODERATE";
  }

  return {
    scores,
    totalScore,
    averageScore,
    alignedTimeframes,
    totalTimeframes,
    alignmentPercent,
    overallDirection,
    signalQuality,
  };
}

/**
 * 格式化共振评分为易读文本
 *
 * @param result 共振评分结果
 * @returns 格式化文本
 */
export function formatConfluenceResult(result: ConfluenceResult): string {
  const lines: string[] = [];

  lines.push(`【加权共振分析】`);
  lines.push(`总分: ${result.totalScore.toFixed(1)}/100`);
  lines.push(`平均分: ${result.averageScore.toFixed(1)}/50`);
  lines.push(`对齐度: ${result.alignedTimeframes}/${result.totalTimeframes} (${result.alignmentPercent.toFixed(1)}%)`);
  lines.push(`整体方向: ${result.overallDirection}`);
  lines.push(`信号质量: ${result.signalQuality}`);
  lines.push(``);
  lines.push(`【各时间框架详情】`);

  for (const score of result.scores) {
    lines.push(`${score.interval} (权重${score.weight}x):`);
    lines.push(`  方向: ${score.signals.direction}`);
    lines.push(`  价格-EMA20: ${score.signals.priceVsEma20.toFixed(1)}/10`);
    lines.push(`  价格-EMA50: ${score.signals.priceVsEma50.toFixed(1)}/10`);
    lines.push(`  MACD强度: ${score.signals.macdStrength.toFixed(1)}/10`);
    lines.push(`  RSI位置: ${score.signals.rsiPosition.toFixed(1)}/10`);
    lines.push(`  成交量: ${score.signals.volumeConfirmation.toFixed(1)}/10`);
    lines.push(`  小计: ${score.signals.totalScore.toFixed(1)}/50 → 加权: ${score.weightedScore.toFixed(1)}`);
    lines.push(``);
  }

  return lines.join('\n');
}
