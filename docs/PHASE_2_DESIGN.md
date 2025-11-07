# Phase 2: Accuracy Improvements - Technical Design

**Status**: 🚧 In Progress
**Created**: 2025-01-07
**Last Updated**: 2025-01-07

## Overview

Phase 2 adds advanced technical indicators and pattern detection to improve trading signal accuracy:
- Bollinger Bands (volatility)
- VWAP (institutional trading levels)
- OBV (volume flow confirmation)
- Divergence Detection (reversal signals)
- Support/Resistance Levels (key price zones)

## 1. New Indicators

### 1.1 Bollinger Bands

**Purpose**: Measure price volatility and overbought/oversold conditions

**Calculation**:
```
Middle Band (SMA20) = 20-period Simple Moving Average
Standard Deviation = sqrt(sum((price - SMA)^2) / 20)
Upper Band = SMA20 + (2 × StdDev)
Lower Band = SMA20 - (2 × StdDev)
%B = (Price - Lower Band) / (Upper Band - Lower Band)
Bandwidth = (Upper Band - Lower Band) / Middle Band
```

**Signals**:
- %B > 1.0: Price above upper band (overbought)
- %B < 0.0: Price below lower band (oversold)
- %B ≈ 0.5: Price at middle band (neutral)
- Bandwidth < 0.02: Squeeze (low volatility, breakout likely)
- Bandwidth > 0.08: Expansion (high volatility)

**Storage**: Add to `CachedIndicators`
```typescript
bbUpper: number;
bbMiddle: number;
bbLower: number;
bbPercent: number;  // %B
bbBandwidth: number;
```

---

### 1.2 VWAP (Volume Weighted Average Price)

**Purpose**: Identify institutional entry/exit levels and fair value

**Calculation**:
```
Typical Price = (High + Low + Close) / 3
VWAP = sum(Typical Price × Volume) / sum(Volume)
```

**Note**: VWAP resets daily. For intraday trading, calculate from session start.

**Signals**:
- Price > VWAP: Bullish (buyers in control)
- Price < VWAP: Bearish (sellers in control)
- Price crosses VWAP: Potential reversal
- Distance from VWAP > 2%: Mean reversion opportunity

**Storage**: Add to `CachedIndicators`
```typescript
vwap: number;
vwapDeviation: number;  // (Price - VWAP) / VWAP × 100
```

---

### 1.3 OBV (On Balance Volume)

**Purpose**: Confirm price trends through volume flow

**Calculation**:
```
If Close > Close[prev]:
  OBV = OBV[prev] + Volume
Else if Close < Close[prev]:
  OBV = OBV[prev] - Volume
Else:
  OBV = OBV[prev]
```

**Signals**:
- OBV rising + Price rising: Strong uptrend
- OBV falling + Price falling: Strong downtrend
- OBV diverges from price: Potential reversal

**Storage**: Add to `CachedIndicators`
```typescript
obv: number;
obvEma20: number;  // EMA of OBV for smoother signal
```

---

## 2. Divergence Detection

**Purpose**: Identify potential trend reversals before they happen

### 2.1 Algorithm Design

**Method**: Swing Point Analysis (4-point pattern)

```
Bullish Divergence (Reversal up):
  Price: Lower Low (LL)
  Indicator: Higher Low (HL)
  → Price making new lows but indicator refusing to follow
  → Weakening bearish momentum

Bearish Divergence (Reversal down):
  Price: Higher High (HH)
  Indicator: Lower High (LH)
  → Price making new highs but indicator refusing to follow
  → Weakening bullish momentum
```

**Detection Window**: Last 50-100 candles
**Minimum Swing Distance**: 10 candles between swing points
**Confirmation**: Require at least 2 swing points on each side

### 2.2 Implementation Strategy

**Step 1**: Find swing points in price
```typescript
function findSwingPoints(prices: number[], window: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = window; i < prices.length - window; i++) {
    const isHigh = prices.slice(i - window, i + window + 1).every(p => prices[i] >= p);
    const isLow = prices.slice(i - window, i + window + 1).every(p => prices[i] <= p);

    if (isHigh) swings.push({ index: i, price: prices[i], type: 'high' });
    if (isLow) swings.push({ index: i, price: prices[i], type: 'low' });
  }

  return swings;
}
```

**Step 2**: Find corresponding indicator values at swing points
```typescript
function findIndicatorAtSwings(swings: SwingPoint[], indicator: number[]): number[] {
  return swings.map(swing => indicator[swing.index]);
}
```

**Step 3**: Detect divergence pattern
```typescript
function detectDivergence(
  priceSwings: SwingPoint[],
  indicatorValues: number[]
): DivergenceSignal | null {
  // Look for last 2 highs or last 2 lows
  const highs = priceSwings.filter(s => s.type === 'high').slice(-2);
  const lows = priceSwings.filter(s => s.type === 'low').slice(-2);

  // Bearish divergence: Price HH, Indicator LH
  if (highs.length === 2) {
    const priceHH = highs[1].price > highs[0].price;
    const indicatorLH = indicatorValues[highs[1].index] < indicatorValues[highs[0].index];

    if (priceHH && indicatorLH) {
      return { type: 'bearish', strength: calculateStrength(...) };
    }
  }

  // Bullish divergence: Price LL, Indicator HL
  if (lows.length === 2) {
    const priceLL = lows[1].price < lows[0].price;
    const indicatorHL = indicatorValues[lows[1].index] > indicatorValues[lows[0].index];

    if (priceLL && indicatorHL) {
      return { type: 'bullish', strength: calculateStrength(...) };
    }
  }

  return null;
}
```

### 2.3 Indicators to Monitor

1. **MACD Divergence** (most reliable)
2. **RSI Divergence** (early signal)

**Storage**: Add to market data (not cached, calculated per cycle)
```typescript
divergence: {
  macd: { type: 'bullish' | 'bearish' | null, strength: number };
  rsi: { type: 'bullish' | 'bearish' | null, strength: number };
}
```

---

## 3. Support/Resistance Detection

**Purpose**: Identify key price levels where price tends to bounce or break

### 3.1 Algorithm Design

**Method**: Swing High/Low Clustering

```
1. Find all swing highs and swing lows in last 100-200 candles
2. Cluster nearby levels (within 0.5% distance)
3. Count "touches" - how many times price visited this level
4. Calculate strength = touches × (1 / age_factor)
```

**Implementation**:
```typescript
function detectSupportResistance(
  candles: Candle[],
  window: number = 100,
  clusterThreshold: number = 0.005  // 0.5%
): SupportResistanceLevel[] {
  const swings = findSwingPoints(candles.map(c => c.close), 5);
  const levels: SupportResistanceLevel[] = [];

  // Cluster nearby swings
  for (const swing of swings) {
    let foundCluster = false;

    for (const level of levels) {
      const distance = Math.abs(swing.price - level.price) / level.price;

      if (distance < clusterThreshold) {
        // Add to existing cluster
        level.touches++;
        level.price = (level.price * (level.touches - 1) + swing.price) / level.touches;
        level.lastTested = Math.max(level.lastTested, swing.index);
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      // Create new level
      levels.push({
        price: swing.price,
        type: swing.type === 'high' ? 'resistance' : 'support',
        touches: 1,
        firstSeen: swing.index,
        lastTested: swing.index,
        strength: 1,
      });
    }
  }

  // Calculate strength (touches × recency factor)
  const currentIndex = candles.length - 1;
  for (const level of levels) {
    const age = currentIndex - level.lastTested;
    const recencyFactor = Math.exp(-age / 50);  // Decay over 50 candles
    level.strength = level.touches * recencyFactor;
  }

  // Return top 5 strongest levels
  return levels
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);
}
```

**Storage**: Add to market data
```typescript
supportResistance: {
  support: Array<{ price: number, strength: number, touches: number }>;
  resistance: Array<{ price: number, strength: number, touches: number }>;
  nearest: { type: 'support' | 'resistance', price: number, distance: number };
}
```

---

## 4. Integration Plan

### 4.1 Extended Cache Interface

```typescript
// src/utils/indicatorCache.ts
export interface CachedIndicators {
  // Existing
  ema20: number;
  ema50: number;
  macd: number;
  rsi7: number;
  rsi14: number;
  volume: number;
  avgVolume: number;
  atr3?: number;
  atr14?: number;
  priceChange20?: number;

  // Phase 2: New indicators
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercent: number;
  bbBandwidth: number;
  vwap: number;
  vwapDeviation: number;
  obv: number;
  obvEma20: number;
}
```

### 4.2 Confluence Scoring Updates

Add new scoring components (total becomes 0-80 instead of 0-50):

```typescript
export interface SignalScore {
  // Existing (5 components × 10 points = 50)
  priceVsEma20: number;
  priceVsEma50: number;
  macdStrength: number;
  rsiPosition: number;
  volumeConfirmation: number;

  // Phase 2 (3 components × 10 points = 30)
  bollingerPosition: number;   // 0-10: %B position
  vwapAlignment: number;        // 0-10: Distance from VWAP
  obvConfirmation: number;      // 0-10: OBV trend alignment

  totalScore: number;  // Now 0-80
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
}
```

**New Scoring Functions**:
```typescript
function calculateBollingerScore(bbPercent: number): number {
  // %B=0.5 (middle) → 0 points (neutral)
  // %B=0.0 or 1.0 (bands) → 5 points (moderate)
  // %B<0 or >1 (outside) → 10 points (extreme)
  const deviation = Math.abs(bbPercent - 0.5);
  return Math.min(deviation * 20, 10);
}

function calculateVwapScore(vwapDeviation: number): number {
  // Deviation < 0.5% → 2 points
  // Deviation 1% → 5 points
  // Deviation > 2% → 10 points
  return Math.min(Math.abs(vwapDeviation) * 5, 10);
}

function calculateObvScore(obv: number, obvEma: number): number {
  // OBV aligned with EMA → higher score
  const diff = Math.abs(obv - obvEma);
  const deviation = diff / Math.abs(obvEma);
  return Math.min(10 - deviation * 20, 10);
}
```

### 4.3 AI Prompt Updates

Add to `generateTradingPrompt()`:

```typescript
// After existing indicators
prompt += `    Bollinger Bands: Upper=${bb.upper}, Middle=${bb.middle}, Lower=${bb.lower}, %B=${bb.percent}\n`;
prompt += `    VWAP: ${vwap.value} (${vwap.deviation >= 0 ? '+' : ''}${vwap.deviation}%)\n`;
prompt += `    OBV: ${obv.value} (EMA20: ${obv.ema20})\n`;

// Add divergence section
if (divergence.macd || divergence.rsi) {
  prompt += `\n  [Divergence Signals]\n`;
  if (divergence.macd) {
    prompt += `    MACD: ${divergence.macd.type} divergence (strength: ${divergence.macd.strength}/10)\n`;
  }
  if (divergence.rsi) {
    prompt += `    RSI: ${divergence.rsi.type} divergence (strength: ${divergence.rsi.strength}/10)\n`;
  }
}

// Add support/resistance section
if (supportResistance.support.length > 0 || supportResistance.resistance.length > 0) {
  prompt += `\n  [Support/Resistance Levels]\n`;
  prompt += `    Nearest: ${sr.nearest.type} at ${sr.nearest.price} (${sr.nearest.distance}% away)\n`;
  prompt += `    Support: ${sr.support.map(s => `${s.price} (${s.touches} touches)`).join(', ')}\n`;
  prompt += `    Resistance: ${sr.resistance.map(r => `${r.price} (${r.touches} touches)`).join(', ')}\n`;
}
```

---

## 5. Implementation Order

### Week 1: Core Indicators
1. ✅ Design document (this file)
2. ✅ Implement Bollinger Bands calculation
3. ✅ Implement VWAP calculation
4. ✅ Implement OBV calculation
5. ✅ Add to cache interface and market data collection

### Week 2: Pattern Detection
6. ✅ Implement swing point detection
7. ✅ Implement MACD divergence detection
8. ✅ Implement RSI divergence detection
9. ✅ Implement support/resistance detection

### Week 3: Integration
10. ✅ Update confluence scoring system
11. ✅ Update AI trading prompt
12. ⏳ Add data validation (basic validation in place, comprehensive validation pending)
13. ✅ Add comprehensive testing (unit tests updated for Phase 2)

### Week 4: Optimization & Documentation
14. ✅ Add caching for new calculations (Phase 2 indicators use existing cache system)
15. ⏳ Performance benchmarking
16. ⏳ Update documentation
17. ⏳ Final testing and deployment

**Status Update** (2025-11-07):
- **Core Implementation**: ✅ COMPLETE
  - All Phase 2 indicators implemented and integrated
  - Bollinger Bands, VWAP, OBV calculations functional
  - Divergence detection (MACD and RSI) integrated
  - Support/Resistance level detection integrated

- **Integration**: ✅ COMPLETE
  - Confluence scoring updated to include Phase 2 indicators (now 0-80 points instead of 0-50)
  - AI trading prompt enhanced with Phase 2 data display
  - Market data collection includes all Phase 2 indicators

- **Testing**: ✅ COMPLETE
  - TypeScript compilation passes
  - Unit tests updated for new CachedIndicators interface

- **Remaining Tasks**:
  - Performance benchmarking on live/test data
  - Final documentation updates
  - Production deployment

---

## 6. Performance Considerations

**Calculation Complexity**:
- Bollinger Bands: O(n) for SMA + O(n) for StdDev = **O(n)**
- VWAP: O(n) cumulative sum = **O(n)**
- OBV: O(n) iteration = **O(n)**
- Divergence: O(n) swing detection + O(n) comparison = **O(n)**
- Support/Resistance: O(n) swing detection + O(n²) clustering = **O(n²)**

**Caching Strategy**:
- BB, VWAP, OBV: Cache per symbol+timeframe+timestamp (same as EMA/RSI)
- Divergence: Calculate per cycle (not cached, depends on recent pattern)
- S/R: Calculate once per symbol, cache for 5 minutes (levels don't change quickly)

**Expected Impact**:
- Additional calculation time: +15-20ms per symbol
- Cache hit rate: Expected 85%+ (same patterns as Phase 1)
- Memory usage: +50 bytes per cache entry (10 new fields)

---

## 7. Testing Strategy

### Unit Tests
- `calculateBollingerBands()` - Verify SMA, StdDev, %B calculations
- `calculateVWAP()` - Verify volume weighting
- `calculateOBV()` - Verify cumulative volume flow
- `detectDivergence()` - Test with known divergence patterns
- `detectSupportResistance()` - Test clustering algorithm

### Integration Tests
- Multi-timeframe indicator consistency
- Cache hit/miss rates
- End-to-end trading cycle with new indicators

### Historical Backtesting
- Compare signals before/after Phase 2
- Measure false positive reduction
- Validate divergence detection accuracy

---

## 8. Success Metrics

**Accuracy Goals**:
- Divergence detection: 70%+ accuracy (validated against manual analysis)
- Support/Resistance: 80%+ price reaction within 0.5% of identified levels
- False signal reduction: 30%+ fewer failed trades

**Performance Goals**:
- Total indicator calculation time: < 100ms per symbol (currently 85ms)
- Cache hit rate: > 85%
- No TypeScript compilation errors

**User Experience**:
- Clearer AI prompt with structured signal information
- More confident trading decisions with confluence + divergence + S/R
- Reduced drawdowns from better reversal detection

---

## Appendix: TypeScript Interfaces

```typescript
// New types for Phase 2
export interface DivergenceSignal {
  type: 'bullish' | 'bearish' | null;
  strength: number;  // 0-10
  pricePoints: [number, number];  // [first swing, second swing]
  indicatorPoints: [number, number];
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: number;  // Weighted by touches and recency
  firstSeen: number;  // Candle index
  lastTested: number;  // Candle index
}

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}
```
