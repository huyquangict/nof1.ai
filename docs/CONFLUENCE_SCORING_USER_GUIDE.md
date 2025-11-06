# Confluence Scoring System - User Guide

**Feature**: Weighted Multi-Timeframe Confluence Scoring
**Since**: Phase 1
**Status**: Enabled by default

## What is Confluence Scoring?

**In simple terms**: Confluence scoring answers the question "How strong is the trading signal?" with a clear 0-100 score instead of you having to manually analyze dozens of indicators.

### The Problem It Solves

**Before Confluence Scoring**:
- You (or the AI) had to look at 6 timeframes (1m, 3m, 5m, 15m, 30m, 1h)
- Each timeframe had 8 indicators (price, EMA20, EMA50, MACD, RSI7, RSI14, volume, ATR)
- That's **48 data points** to analyze manually
- Hard to know if a signal was "strong" or just "okay"
- All timeframes treated equally (but 1h is more reliable than 1m)

**With Confluence Scoring**:
- Get a single 0-100 score representing signal strength
- Clear quality labels: STRONG, MODERATE, or WEAK
- Longer timeframes (1h) weighted 3.5x more than short ones (1m)
- AI makes better decisions with less effort

## How It Works

### 1. Five Signal Dimensions

For each timeframe, the system scores five aspects (0-10 each):

#### A. **Price vs EMA20** (Trend Strength)
- Measures how far price is from the 20-period moving average
- **High score** (8-10): Price significantly above (bullish) or below (bearish) EMA20
- **Low score** (0-3): Price near EMA20 (no clear trend)

**Example**:
- BTC price: $50,000
- EMA20: $49,000
- Distance: +2% → **Score: 8.5/10** (strong bullish signal)

#### B. **Price vs EMA50** (Long-Term Trend)
- Measures distance from the 50-period moving average
- Same logic as EMA20, but for longer-term trend
- Both scores align = stronger confidence

#### C. **MACD Strength** (Momentum)
- MACD shows momentum direction and strength
- **High score**: Strong positive (bullish) or negative (bearish) MACD
- **Low score**: MACD near zero (no momentum)

**Example**:
- MACD: +75 → **Score: 7.5/10** (good bullish momentum)
- MACD: +5 → **Score: 2.0/10** (weak momentum)

#### D. **RSI Position** (Overbought/Oversold)
- RSI shows if asset is overbought (>70) or oversold (<30)
- **High score**: RSI strongly above 50 (bullish) or below 50 (bearish)
- **Low score**: RSI near 50 (neutral, no clear direction)

**Example**:
- RSI: 65 → **Score: 7.5/10** (bullish, not overbought)
- RSI: 51 → **Score: 2.0/10** (neutral, no conviction)

#### E. **Volume Confirmation** (Conviction)
- Compares current volume to average
- **High score**: High volume confirms the move (real conviction)
- **Low score**: Low volume (weak conviction, may be false signal)

**Example**:
- Current volume: 2000 BTC
- Average volume: 1200 BTC
- Ratio: 1.67x → **Score: 7.0/10** (strong volume)

### 2. Timeframe Weighting

Not all timeframes are equal. Longer timeframes are more reliable:

| Timeframe | Weight | Rationale |
|-----------|--------|-----------|
| **1 hour** | **3.5x** | Most reliable, long-term trend |
| 30 minute | 3.0x | Strong reliability |
| 15 minute | 2.5x | Good reliability |
| 5 minute | 2.0x | Moderate reliability |
| 3 minute | 1.5x | Lower reliability |
| **1 minute** | **1.0x** | Least reliable, noise-prone |

**Why this matters**:
- A BULLISH signal on 1h (weight 3.5x) counts way more than 1m (weight 1.0x)
- System prioritizes longer-term trends over short-term noise

### 3. Total Score Calculation

**Formula**:
```
Total Score = Sum of (Timeframe Score × Weight) for all timeframes
Scale: 0-100 (higher = stronger signal)
```

**Example**:
- 1m: 36 points × 1.0 = 36
- 5m: 38 points × 2.0 = 76
- 1h: 40 points × 3.5 = 140
- **Total**: ~75/100 (after normalization)

### 4. Signal Quality Classification

| Quality | Criteria | Meaning |
|---------|----------|---------|
| **STRONG** | Score ≥70 AND alignment ≥75% | **High confidence** - Priority consideration |
| **MODERATE** | Score ≥50 AND alignment ≥60% | **Medium confidence** - Combine with other factors |
| **WEAK** | Below MODERATE thresholds | **Low confidence** - Caution or observe |

**Alignment** = percentage of timeframes agreeing on direction (bullish/bearish)

## What You See

### In Logs (Chinese)

When the trading system runs, you'll see this for each symbol:

```
BTC 共振分析:
【加权共振分析】
总分: 75.5/100
平均分: 35.2/50
对齐度: 5/6 (83.3%)
整体方向: BULLISH
信号质量: STRONG

【各时间框架详情】
1m (权重1.0x):
  方向: BULLISH
  价格-EMA20: 8.5/10
  价格-EMA50: 7.2/10
  MACD强度: 6.8/10
  RSI位置: 7.5/10
  成交量: 6.0/10
  小计: 36.0/50 → 加权: 36.0

5m (权重2.0x):
  方向: BULLISH
  价格-EMA20: 9.0/10
  价格-EMA50: 8.0/10
  MACD强度: 7.5/10
  RSI位置: 8.0/10
  成交量: 5.5/10
  小计: 38.0/50 → 加权: 76.0

1h (权重3.5x):
  方向: BULLISH
  价格-EMA20: 9.5/10
  价格-EMA50: 8.8/10
  MACD强度: 8.2/10
  RSI位置: 8.5/10
  成交量: 5.0/10
  小计: 40.0/50 → 加权: 140.0
```

### In AI Decisions

The AI receives this data in a structured format and references it in decisions:

```
【加权共振分析】
总体方向: 看涨
信号质量: 强
时间框架对齐度: 5/6 (83%)
加权总分: 75.5/100

关键提示：
  ✓ 强信号确认：83%时间框架共振看涨，加权总分76，建议优先考虑此方向
```

## How to Use It

### 1. Understanding Signal Quality

**STRONG Signals (≥70, ≥75% alignment)**:
- **What it means**: High confidence, most timeframes agree strongly
- **Action**: Priority consideration for entering trades
- **Risk**: Lower (but never zero)
- **Example**: 5 out of 6 timeframes bullish with strong scores

**MODERATE Signals (≥50, ≥60% alignment)**:
- **What it means**: Medium confidence, partial agreement
- **Action**: Combine with other factors (fundamentals, news, support/resistance)
- **Risk**: Medium
- **Example**: 4 out of 6 timeframes bullish with moderate scores

**WEAK Signals (<50 or <60%)**:
- **What it means**: Low confidence, mixed signals or low scores
- **Action**: Caution, observe, or skip
- **Risk**: High (likely choppy market or uncertain direction)
- **Example**: 3 out of 6 bullish, 3 bearish, or all weak scores

### 2. Strategy-Specific Usage

#### Swing-Trend Strategy (Recommended)

**Entry Requirement**: STRONG signal (≥70, ≥75%)

**Why**: This strategy captures medium-term trends (20-minute cycles). STRONG signals filter out noise and increase win rate.

**Example Decision**:
- BTC confluence: 76/100, STRONG, 83% alignment, BULLISH
- AI: "Strong bullish confluence confirmed. Entering long position with 3x leverage."

#### Ultra-Short Strategy

**Entry Requirement**: MODERATE or higher (≥50)

**Why**: This strategy trades 5-minute cycles. Needs more opportunities, can tolerate moderate signals with tight stop-loss.

**Example Decision**:
- ETH confluence: 55/100, MODERATE, 67% alignment, BULLISH
- AI: "Moderate bullish signal. Entering cautious long with 2x leverage and tight stop-loss."

#### Conservative Strategy

**Entry Requirement**: STRONG signal + additional confirmations

**Why**: Capital protection priority. Only trades highest-confidence setups.

**Example Decision**:
- SOL confluence: 82/100, STRONG, 100% alignment, BULLISH
- AI: "Exceptional confluence. Entering long with 2x leverage (conservative)."

### 3. Combining with Other Factors

Confluence scoring is powerful but not the only factor:

**Also Consider**:
- 📰 **News Events**: Major announcements can override technical signals
- 📊 **Support/Resistance**: Confluence near key levels is stronger
- 💵 **Volume Profile**: High-volume nodes confirm signals
- 🕒 **Time of Day**: Liquidity varies (higher during US/EU hours)
- 🌐 **Market Sentiment**: Overall crypto market trend

**Best Approach**:
1. Check confluence score (quick signal strength assessment)
2. Verify with chart (visual confirmation of indicators)
3. Check news (no major negative catalysts)
4. Confirm risk parameters (stop-loss, position size)
5. Execute if all factors align

### 4. Interpreting Conflicting Signals

**Scenario 1: High Score but Low Alignment**
- Example: Score 68/100, but only 50% alignment
- **Meaning**: One or two timeframes have very strong signals, others neutral
- **Action**: Caution - may be false signal or early trend

**Scenario 2: High Alignment but Low Score**
- Example: 83% alignment, but score 45/100
- **Meaning**: All timeframes agree on direction but weakly
- **Action**: Possible opportunity in early trend, but risky

**Scenario 3: Both High (STRONG)**
- Example: 75/100 score, 83% alignment
- **Meaning**: Strong, confident signal
- **Action**: Best setup for entry

**Scenario 4: Both Low (WEAK)**
- Example: 35/100 score, 50% alignment
- **Meaning**: Choppy, uncertain market
- **Action**: Stay out, observe

## Common Questions

### Q: What's a "good" confluence score?

**A**: Depends on strategy:
- **Aggressive**: ≥50 (MODERATE+)
- **Balanced**: ≥60
- **Conservative**: ≥70 (STRONG only)

### Q: Can confluence scores be wrong?

**A**: Yes, no indicator is 100% accurate. Confluence reduces false signals but doesn't eliminate them. Always use stop-losses.

### Q: Why did a STRONG signal fail?

**Possible reasons**:
- Unexpected news event
- Market-wide crash
- Low liquidity (slippage)
- Flash crash / manipulation

**Solution**: Even STRONG signals need stop-loss protection.

### Q: Should I only trade STRONG signals?

**A**: Not necessarily. MODERATE signals can work with:
- Tight stop-loss
- Smaller position size
- Additional confirmation (support/resistance)

**But**: STRONG signals have better win rate (historically).

### Q: How often do STRONG signals appear?

**A**: Depends on market conditions:
- **Trending market**: Several per day
- **Choppy market**: Few per week
- **Low volatility**: Rare

**Note**: Swing-trend strategy (20-min cycles) may wait hours for STRONG signal. This is intentional - quality over quantity.

### Q: Can I adjust the thresholds?

**A**: Yes, but requires code changes:
- STRONG threshold: Edit `confluenceScoring.ts` line 290 (`STRONG_THRESHOLD`)
- Alignment threshold: Edit line 291 (`HIGH_ALIGNMENT_PERCENT`)

**Default values** (recommended):
- STRONG: ≥70 score, ≥75% alignment
- MODERATE: ≥50 score, ≥60% alignment

### Q: Does this work in all market conditions?

**A**: Best in:
- ✅ **Trending markets** (strong directional moves)
- ✅ **High liquidity** (major pairs like BTC, ETH)

Less effective in:
- ⚠️ **Sideways/choppy markets** (many WEAK signals, few STRONG)
- ⚠️ **Low liquidity** (prices may not follow indicators)
- ⚠️ **Black swan events** (nothing works in extreme volatility)

### Q: How is this different from other indicators?

**Key Differences**:
1. **Multi-timeframe**: Combines 6 timeframes (most traders use 1-2)
2. **Weighted**: Longer timeframes prioritized (most systems don't weight)
3. **Quantified**: Single 0-100 score (most are binary yes/no)
4. **Comprehensive**: 5 dimensions per timeframe (most use 1-2 indicators)

## Advanced Usage

### Tracking Confluence Accuracy

Monitor your trades with confluence scores:

```csv
Date,Symbol,Confluence,Quality,Direction,Outcome,P&L
2025-11-06,BTC,75.5,STRONG,BULLISH,WIN,+5.2%
2025-11-06,ETH,55.0,MODERATE,BULLISH,LOSS,-2.1%
2025-11-06,SOL,30.0,WEAK,NEUTRAL,SKIP,N/A
```

**After 30+ trades, analyze**:
- Win rate for STRONG vs MODERATE vs WEAK
- Average P&L by signal quality
- Best performing timeframe alignments

### Combining with Backtesting

If you backtest strategies:
1. Calculate historical confluence scores
2. Filter trades by STRONG/MODERATE/WEAK
3. Compare win rates and P&L
4. Optimize thresholds based on data

### Using Confluence for Position Sizing

**Adaptive Position Sizing**:
- STRONG signal: 100% of planned position
- MODERATE signal: 50-75% of planned position
- WEAK signal: 25-50% or skip

**Example**:
- Plan: 30% of capital
- BTC confluence: 78 (STRONG) → Position: 30%
- ETH confluence: 55 (MODERATE) → Position: 20%
- SOL confluence: 40 (WEAK) → Position: Skip or 10%

## Best Practices

### Do's ✅

- ✅ **Use confluence as primary filter** for signal quality
- ✅ **Combine with other confirmations** (support/resistance, news)
- ✅ **Always use stop-losses** even for STRONG signals
- ✅ **Track your results** by confluence quality over time
- ✅ **Wait for STRONG signals** in swing-trend strategy (patience pays)
- ✅ **Consider alignment percentage** not just total score

### Don'ts ❌

- ❌ **Don't ignore WEAK signals** (they warn you to stay out)
- ❌ **Don't override STRONG signals** without good reason
- ❌ **Don't trade WEAK signals** hoping for luck
- ❌ **Don't use confluence alone** (it's one tool of many)
- ❌ **Don't expect 100% accuracy** (no indicator is perfect)
- ❌ **Don't change thresholds** without testing first

## Troubleshooting

### Confluence Scores Not Showing

**Check logs**:
```bash
grep "共振分析" logs/trading-loop.log
```

**If missing**:
- Verify you're running Phase 1 code: `git log --oneline --grep="Phase 1"`
- Restart trading system: `npm run trading:restart`

### All Signals Are WEAK

**Possible reasons**:
- Choppy/sideways market (normal)
- Low volatility period
- All timeframes disagree on direction

**Action**: Be patient. STRONG signals will come when trend emerges.

### Too Many STRONG Signals

**Possible reasons**:
- Strong trending market (good!)
- Thresholds too low (check defaults)

**Action**: If trades still failing, consider raising thresholds.

## Support

- **Documentation**: See `docs/` directory
- **Code**: `src/utils/confluenceScoring.ts`
- **Tests**: `src/utils/confluenceScoring.test.ts`
- **Issues**: GitHub Issues

---

**Last Updated**: 2025-11-06
**Phase**: 1 Complete
**Status**: Production Ready
