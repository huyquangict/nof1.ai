# Phase 3: Advanced Features - Design Document

**Version**: 1.0
**Date**: 2025-11-07
**Status**: 🔄 In Progress

---

## Table of Contents
1. [Overview](#1-overview)
2. [Component 1: Adaptive Indicator Parameters](#2-component-1-adaptive-indicator-parameters)
3. [Component 2: Machine Learning Integration](#3-component-2-machine-learning-integration)
4. [Component 3: Real-time WebSocket Updates](#4-component-3-real-time-websocket-updates)
5. [Implementation Order](#5-implementation-order)
6. [Performance Considerations](#6-performance-considerations)
7. [Risk Management](#7-risk-management)

---

## 1. Overview

### Objectives

Phase 3 introduces advanced features to make the trading system more adaptive, intelligent, and responsive:

1. **Adaptive Parameters**: Automatically adjust indicator parameters based on market conditions
2. **Machine Learning**: Add predictive models to enhance decision-making
3. **Real-time Updates**: Replace REST API polling with WebSocket streams for lower latency

### Expected Improvements

- **Accuracy**: +10-15% signal accuracy through adaptive parameters
- **Latency**: -70% data latency (REST polling ~2-5s → WebSocket ~100-500ms)
- **Intelligence**: +20-30% win rate through ML-assisted predictions
- **Efficiency**: -60% API calls (WebSocket persistent connection)

---

## 2. Component 1: Adaptive Indicator Parameters

### 2.1 Market Regime Detection

**Goal**: Classify market conditions into distinct regimes to apply appropriate parameter sets.

#### Regime Types

```typescript
type MarketRegime =
  | 'TRENDING_BULL'      // Strong uptrend
  | 'TRENDING_BEAR'      // Strong downtrend
  | 'RANGING_VOLATILE'   // Choppy, high volatility
  | 'RANGING_CALM'       // Sideways, low volatility
  | 'BREAKOUT'           // Volume surge, potential trend start
```

#### Detection Algorithm

```typescript
interface RegimeDetectionInputs {
  // Trend strength
  ema20: number;
  ema50: number;
  adx: number;              // Average Directional Index (Phase 3 addition)

  // Volatility
  atr: number;
  atrRatio: number;         // current ATR / 20-period ATR average
  bbBandwidth: number;      // From Phase 2

  // Volume
  volume: number;
  avgVolume: number;
  volumeSurge: number;      // volume / avgVolume

  // Price action
  priceChange20: number;    // 20-period price change %
}

interface RegimeClassification {
  regime: MarketRegime;
  confidence: number;       // 0-1, how certain we are
  volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  trendStrength: number;    // 0-100
}
```

**Classification Rules**:

1. **TRENDING_BULL**:
   - Price > EMA20 > EMA50
   - ADX > 25 (strong trend)
   - priceChange20 > +3%
   - Volume surge < 2x (not overheated)

2. **TRENDING_BEAR**:
   - Price < EMA20 < EMA50
   - ADX > 25
   - priceChange20 < -3%
   - Volume surge < 2x

3. **RANGING_VOLATILE**:
   - ADX < 20 (weak trend)
   - ATR ratio > 1.5 (high volatility)
   - BB bandwidth > 8%
   - Price oscillating around EMA20

4. **RANGING_CALM**:
   - ADX < 15
   - ATR ratio < 0.8 (low volatility)
   - BB bandwidth < 3%
   - Volume < 0.8x average

5. **BREAKOUT**:
   - Volume surge > 2.5x
   - Price breaking through BB bands
   - BB bandwidth expanding rapidly
   - Can transition to TRENDING

### 2.2 Adaptive Parameter Sets

#### Base Parameters (Phase 1 & 2)

```typescript
const BASE_PARAMETERS = {
  ema: { fast: 20, slow: 50 },
  macd: { fast: 12, slow: 26, signal: 9 },
  rsi: { period: 14 },
  bb: { period: 20, stdDev: 2 },
  atr: { period: 14 },
};
```

#### Regime-Specific Adjustments

```typescript
const ADAPTIVE_PARAMETERS: Record<MarketRegime, AdaptiveParams> = {
  TRENDING_BULL: {
    ema: { fast: 15, slow: 40 },      // Shorter periods for faster response
    macd: { fast: 10, slow: 22, signal: 7 },
    rsi: { period: 11 },              // More sensitive
    bb: { period: 15, stdDev: 2.5 },  // Wider bands for trending
    atr: { period: 10 },

    reasoning: "In trends, use shorter periods to stay aligned with momentum",
  },

  TRENDING_BEAR: {
    ema: { fast: 15, slow: 40 },
    macd: { fast: 10, slow: 22, signal: 7 },
    rsi: { period: 11 },
    bb: { period: 15, stdDev: 2.5 },
    atr: { period: 10 },

    reasoning: "Same as bull trend - faster response to momentum",
  },

  RANGING_VOLATILE: {
    ema: { fast: 25, slow: 60 },      // Longer periods to filter noise
    macd: { fast: 14, slow: 30, signal: 11 },
    rsi: { period: 17 },              // Less sensitive
    bb: { period: 25, stdDev: 2.0 },  // Narrower to reduce false signals
    atr: { period: 20 },              // Longer for stability

    reasoning: "In choppy markets, use longer periods to avoid whipsaws",
  },

  RANGING_CALM: {
    ema: { fast: 20, slow: 50 },      // Standard parameters work well
    macd: { fast: 12, slow: 26, signal: 9 },
    rsi: { period: 14 },
    bb: { period: 20, stdDev: 1.8 },  // Tighter bands
    atr: { period: 14 },

    reasoning: "Low volatility = standard parameters with tighter bands",
  },

  BREAKOUT: {
    ema: { fast: 10, slow: 30 },      // Very fast response
    macd: { fast: 8, slow: 18, signal: 6 },
    rsi: { period: 9 },               // Very sensitive
    bb: { period: 10, stdDev: 3.0 },  // Wide bands for expansion
    atr: { period: 7 },               // Short for rapid volatility change

    reasoning: "Breakouts need fast parameters to catch momentum early",
  },
};
```

### 2.3 Adaptive Stop-Loss and Take-Profit

**Current System**: Fixed percentages from `RISK_PARAMS` or strategy config

**Adaptive System**: Adjust based on volatility (ATR-based)

```typescript
interface AdaptiveRiskParams {
  // Stop-loss as multiple of ATR
  stopLossATRMultiple: number;      // e.g., 2.0 = 2x ATR

  // Take-profit as multiple of ATR
  takeProfitATRMultiple: number;    // e.g., 3.0 = 3x ATR

  // Trailing stop as multiple of ATR
  trailingStopATRMultiple: number;  // e.g., 1.5 = 1.5x ATR
}

const ADAPTIVE_RISK: Record<MarketRegime, AdaptiveRiskParams> = {
  TRENDING_BULL: {
    stopLossATRMultiple: 1.5,       // Tighter stops in trends
    takeProfitATRMultiple: 4.0,     // Wider targets
    trailingStopATRMultiple: 1.0,   // Tight trailing
  },

  TRENDING_BEAR: {
    stopLossATRMultiple: 1.5,
    takeProfitATRMultiple: 4.0,
    trailingStopATRMultiple: 1.0,
  },

  RANGING_VOLATILE: {
    stopLossATRMultiple: 2.5,       // Wider stops for noise
    takeProfitATRMultiple: 2.0,     // Tighter targets
    trailingStopATRMultiple: 2.0,   // Wide trailing
  },

  RANGING_CALM: {
    stopLossATRMultiple: 2.0,
    takeProfitATRMultiple: 2.5,
    trailingStopATRMultiple: 1.5,
  },

  BREAKOUT: {
    stopLossATRMultiple: 1.0,       // Very tight stops
    takeProfitATRMultiple: 5.0,     // Very wide targets
    trailingStopATRMultiple: 0.8,   // Very tight trailing
  },
};

// Example calculation
function calculateAdaptiveStopLoss(
  entryPrice: number,
  side: 'long' | 'short',
  atr: number,
  regime: MarketRegime
): number {
  const params = ADAPTIVE_RISK[regime];
  const stopDistance = atr * params.stopLossATRMultiple;

  if (side === 'long') {
    return entryPrice - stopDistance;
  } else {
    return entryPrice + stopDistance;
  }
}
```

### 2.4 Implementation Structure

```typescript
// src/utils/adaptiveParameters.ts

export interface AdaptiveIndicatorParams {
  regime: MarketRegime;
  confidence: number;
  emaFast: number;
  emaSlow: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  rsiPeriod: number;
  bbPeriod: number;
  bbStdDev: number;
  atrPeriod: number;
}

export function detectMarketRegime(
  candles: Candle[],
  indicators: Indicators
): RegimeClassification {
  // Implementation of regime detection logic
}

export function getAdaptiveParameters(
  regime: MarketRegime
): AdaptiveIndicatorParams {
  // Return parameters for given regime
}

export function calculateAdaptiveRiskParams(
  regime: MarketRegime,
  atr: number,
  entryPrice: number,
  side: 'long' | 'short'
): {
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
} {
  // Calculate ATR-based risk parameters
}
```

---

## 3. Component 2: Machine Learning Integration

### 3.1 ML Model Objectives

1. **Price Direction Prediction**: Predict if price will go up/down in next N candles
2. **Optimal Entry Timing**: Predict best time to enter within signal validity window
3. **Exit Timing**: Predict when trend will reverse (better than fixed TP/SL)
4. **Win Rate Estimation**: Estimate probability of profitable trade given current conditions

### 3.2 Model Architecture Options

#### Option A: LSTM (Long Short-Term Memory)

**Pros**:
- Excellent for time-series data
- Captures temporal dependencies
- Good for sequence prediction

**Cons**:
- Slower training
- Requires more data (10k+ samples)
- Complex to tune

**Use Case**: Price direction prediction over 30-60 minute horizons

#### Option B: Transformer

**Pros**:
- State-of-the-art for sequences
- Attention mechanism captures important patterns
- Parallel training (faster than LSTM)

**Cons**:
- Very data-hungry (50k+ samples)
- High computational cost
- May overfit on small datasets

**Use Case**: Multi-timeframe pattern recognition

#### Option C: XGBoost / LightGBM (Gradient Boosting)

**Pros**:
- Fast training and inference
- Works well with tabular features
- Good with fewer samples (1k+)
- Built-in feature importance
- Less prone to overfitting

**Cons**:
- Not designed for sequences (need feature engineering)
- No temporal memory

**Use Case**: Binary classification (win/loss), win rate estimation

#### **Recommended**: Hybrid Approach

1. **XGBoost for quick decisions** (primary):
   - Fast inference (~1-5ms)
   - Good accuracy with limited data
   - Easy to deploy in production

2. **LSTM for advanced predictions** (secondary, optional):
   - Deeper price movement analysis
   - Pattern recognition
   - Deploy when sufficient training data available

### 3.3 Feature Engineering

#### Input Features (Window: last 60 data points)

```typescript
interface MLFeatures {
  // Price features (normalized)
  priceSequence: number[];          // Last 60 close prices (normalized)
  priceChangeSequence: number[];    // Last 60 returns
  volumeSequence: number[];         // Last 60 volumes (normalized)

  // Technical indicators (current values)
  ema20: number;
  ema50: number;
  macd: number;
  rsi7: number;
  rsi14: number;
  atr: number;
  bbPercent: number;
  bbBandwidth: number;
  vwap: number;
  vwapDeviation: number;
  obv: number;

  // Phase 2 signals
  hasMacdDivergence: 0 | 1;
  hasRsiDivergence: 0 | 1;
  distanceToSupport: number;        // % distance to nearest support
  distanceToResistance: number;     // % distance to nearest resistance

  // Regime features
  currentRegime: number;            // One-hot encoded (5 regimes)
  regimeConfidence: number;
  volatilityLevel: number;          // 0=low, 1=medium, 2=high
  trendStrength: number;

  // Time features
  hourOfDay: number;                // 0-23
  dayOfWeek: number;                // 0-6

  // Market structure
  volumeSurge: number;
  fundingRate: number;
  priceChange1h: number;
  priceChange4h: number;
  priceChange24h: number;

  // Confluence score (Phase 1)
  confluenceScore: number;
  confluenceAlignment: number;
}
```

#### Target Variables

```typescript
interface MLTargets {
  // Primary targets
  priceDirection: 1 | 0 | -1;      // Up / Neutral / Down (next 30 min)
  priceChange30m: number;          // Actual % change in 30 min

  // Secondary targets (for advanced models)
  willBeProfit: 0 | 1;             // Will trade be profitable?
  optimalExitTime: number;         // Minutes until optimal exit
  maxDrawdown: number;             // Max % drawdown during trade
}
```

### 3.4 Data Collection & Preprocessing

```typescript
// src/ml/dataCollector.ts

interface TrainingDataPoint {
  timestamp: string;
  symbol: string;
  features: MLFeatures;
  targets: MLTargets;
  tradeId?: string;                // If this led to a trade
}

export class DataCollector {
  private buffer: TrainingDataPoint[] = [];

  // Called every trading cycle
  async collectDataPoint(
    marketData: MarketData,
    indicators: Indicators,
    regime: RegimeClassification
  ): Promise<void> {
    const features = this.extractFeatures(marketData, indicators, regime);

    // Store for later labeling
    this.buffer.push({
      timestamp: getChinaTimeISO(),
      symbol: marketData.symbol,
      features,
      targets: null, // Will be filled when we know outcome
    });

    // Label past data points (30 minutes later)
    await this.labelPastDataPoints();

    // Save to database
    await this.saveToDatabase();
  }

  private async labelPastDataPoints(): Promise<void> {
    const now = Date.now();
    const lookbackPeriod = 30 * 60 * 1000; // 30 minutes

    for (const point of this.buffer) {
      if (point.targets !== null) continue; // Already labeled

      const age = now - new Date(point.timestamp).getTime();
      if (age >= lookbackPeriod) {
        // Fetch price 30 minutes later
        const futurePrice = await this.getPriceAt(
          point.symbol,
          new Date(point.timestamp).getTime() + lookbackPeriod
        );

        const currentPrice = point.features.priceSequence[
          point.features.priceSequence.length - 1
        ];

        const priceChange = ((futurePrice - currentPrice) / currentPrice) * 100;

        point.targets = {
          priceDirection: priceChange > 0.5 ? 1 : priceChange < -0.5 ? -1 : 0,
          priceChange30m: priceChange,
          willBeProfit: null, // Need trade info
          optimalExitTime: null,
          maxDrawdown: null,
        };
      }
    }
  }
}
```

### 3.5 Model Training Pipeline

```typescript
// src/ml/trainer.ts

export class ModelTrainer {
  private model: XGBoostModel;

  async trainModel(
    trainingData: TrainingDataPoint[],
    validationSplit: number = 0.2
  ): Promise<TrainingResult> {
    // 1. Prepare data
    const { X_train, y_train, X_val, y_val } = this.prepareData(
      trainingData,
      validationSplit
    );

    // 2. Train model
    this.model = new XGBoostModel({
      objective: 'multi:softmax',   // Classification (up/neutral/down)
      num_class: 3,
      max_depth: 6,
      learning_rate: 0.1,
      n_estimators: 100,
      early_stopping_rounds: 10,
    });

    await this.model.fit(X_train, y_train, {
      eval_set: [[X_val, y_val]],
      verbose: true,
    });

    // 3. Evaluate
    const predictions = this.model.predict(X_val);
    const accuracy = this.calculateAccuracy(predictions, y_val);
    const precision = this.calculatePrecision(predictions, y_val);
    const recall = this.calculateRecall(predictions, y_val);

    // 4. Feature importance
    const featureImportance = this.model.featureImportances();

    // 5. Save model
    await this.saveModel(`models/xgboost_v${Date.now()}.model`);

    return {
      accuracy,
      precision,
      recall,
      featureImportance,
      modelPath: this.modelPath,
    };
  }

  async retrainIncremental(newData: TrainingDataPoint[]): Promise<void> {
    // Online learning: update model with new data
    // XGBoost doesn't support true online learning, so we:
    // 1. Load recent data (last 10k points)
    // 2. Add new data
    // 3. Retrain model
    // 4. Replace old model if performance improves
  }
}
```

### 3.6 Model Inference

```typescript
// src/ml/predictor.ts

export class TradingPredictor {
  private model: XGBoostModel;

  async loadModel(modelPath: string): Promise<void> {
    this.model = await XGBoostModel.load(modelPath);
  }

  predict(features: MLFeatures): MLPrediction {
    const X = this.featuresToArray(features);

    // Get prediction and probability
    const prediction = this.model.predict(X)[0];  // 0, 1, or 2 (down, neutral, up)
    const probabilities = this.model.predictProba(X)[0]; // [p_down, p_neutral, p_up]

    return {
      direction: prediction === 2 ? 'UP' : prediction === 0 ? 'DOWN' : 'NEUTRAL',
      confidence: Math.max(...probabilities),
      probabilities: {
        up: probabilities[2],
        neutral: probabilities[1],
        down: probabilities[0],
      },
      timestamp: getChinaTimeISO(),
    };
  }
}
```

### 3.7 Integration into Trading Loop

```typescript
// In src/scheduler/tradingLoop.ts

async function executeTradingDecision() {
  // ... existing code ...

  // After collecting market data
  const marketData = await collectMarketData();
  const regime = detectMarketRegime(candles, indicators);

  // ML Prediction
  const mlPredictor = await getMLPredictor();
  const features = extractMLFeatures(marketData, indicators, regime);
  const mlPrediction = mlPredictor.predict(features);

  // Add to AI context
  const prompt = generateTradingPrompt({
    marketData,
    accountInfo,
    positions,
    mlPrediction,  // NEW: Add ML prediction
    regime,        // NEW: Add detected regime
  });

  // ... rest of trading logic ...

  // Data collection for future training
  await dataCollector.collectDataPoint(marketData, indicators, regime);
}
```

### 3.8 ML Model Monitoring

```typescript
// Track model performance over time
interface ModelPerformanceMetrics {
  timestamp: string;
  modelVersion: string;

  // Prediction accuracy
  accuracy: number;           // Overall accuracy
  precisionUp: number;        // Precision for "UP" predictions
  precisionDown: number;      // Precision for "DOWN" predictions
  recall: number;
  f1Score: number;

  // Trading performance
  predictedTrades: number;    // Trades taken based on ML
  winRate: number;            // % of profitable trades
  avgProfit: number;          // Average profit when correct
  avgLoss: number;            // Average loss when wrong

  // Confidence calibration
  confidenceVsAccuracy: { confidence: number; accuracy: number }[];
}

// Store in database for monitoring dashboard
```

---

## 4. Component 3: Real-time WebSocket Updates

### 4.1 Gate.io WebSocket API Overview

**Documentation**: https://www.gate.io/docs/developers/futures/ws/en/

**Endpoints**:
- Futures: `wss://fx-ws.gateio.ws/v4/ws/usdt`
- Testnet: `wss://fx-ws-testnet.gateio.ws/v4/ws/usdt`

**Available Channels**:
1. `futures.tickers` - Real-time ticker updates
2. `futures.candlesticks` - OHLCV candle updates (1m, 5m, 15m, etc.)
3. `futures.trades` - Real-time trade executions
4. `futures.order_book` - Order book depth
5. `futures.orders` - User order updates
6. `futures.usertrades` - User trade updates
7. `futures.positions` - User position updates

### 4.2 WebSocket Connection Manager

```typescript
// src/services/websocket/gateWebSocket.ts

export interface WebSocketConfig {
  url: string;
  apiKey?: string;
  apiSecret?: string;
  reconnectDelay: number;     // ms between reconnect attempts
  maxReconnectAttempts: number;
  heartbeatInterval: number;  // ms between ping messages
}

export class GateWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  private authenticated: boolean = false;

  constructor(config: WebSocketConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.url);

      this.ws.on('open', () => {
        logger.info('WebSocket connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();

        // Authenticate if credentials provided
        if (this.config.apiKey) {
          this.authenticate();
        }

        // Resubscribe to channels
        this.resubscribeAll();

        resolve();
      });

      this.ws.on('message', (data: string) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.emit('error', error);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(`WebSocket closed: ${code} - ${reason}`);
        this.stopHeartbeat();
        this.handleReconnect();
      });
    });
  }

  private async authenticate(): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.generateSignature(timestamp);

    const authMessage = {
      time: timestamp,
      channel: 'futures.login',
      event: 'api',
      payload: {
        api_key: this.config.apiKey,
        signature,
        timestamp,
      },
    };

    this.send(authMessage);
  }

  private generateSignature(timestamp: number): string {
    const message = `channel=futures.login&time=${timestamp}`;
    return crypto
      .createHmac('sha512', this.config.apiSecret)
      .update(message)
      .digest('hex');
  }

  subscribe(channel: string, payload: any = []): void {
    const subKey = `${channel}:${JSON.stringify(payload)}`;
    this.subscriptions.add(subKey);

    const message = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: 'subscribe',
      payload,
    };

    this.send(message);
    logger.info(`Subscribed to ${channel}:`, payload);
  }

  unsubscribe(channel: string, payload: any = []): void {
    const subKey = `${channel}:${JSON.stringify(payload)}`;
    this.subscriptions.delete(subKey);

    const message = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: 'unsubscribe',
      payload,
    };

    this.send(message);
  }

  private resubscribeAll(): void {
    for (const subKey of this.subscriptions) {
      const [channel, payloadStr] = subKey.split(':');
      const payload = JSON.parse(payloadStr);
      this.subscribe(channel, payload);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle different message types
      if (message.event === 'update') {
        this.emit(message.channel, message.result);
      } else if (message.event === 'subscribe') {
        logger.info(`Subscription confirmed: ${message.channel}`);
      } else if (message.event === 'error') {
        logger.error(`WebSocket error: ${message.error.message}`);
        this.emit('error', new Error(message.error.message));
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const ping = {
          time: Math.floor(Date.now() / 1000),
          channel: 'futures.ping',
        };
        this.send(ping);
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached, giving up');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      logger.error('Reconnect failed:', error);
      this.handleReconnect(); // Try again
    }
  }

  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn('WebSocket not open, cannot send message');
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

### 4.3 WebSocket Data Handlers

```typescript
// src/services/websocket/handlers.ts

export class WebSocketDataManager {
  private wsClient: GateWebSocketClient;
  private tickerCache: Map<string, TickerData> = new Map();
  private candleBuffers: Map<string, CandleBuffer> = new Map();

  constructor(wsClient: GateWebSocketClient) {
    this.wsClient = wsClient;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle ticker updates
    this.wsClient.on('futures.tickers', (data) => {
      this.handleTickerUpdate(data);
    });

    // Handle candle updates
    this.wsClient.on('futures.candlesticks', (data) => {
      this.handleCandleUpdate(data);
    });

    // Handle trade updates
    this.wsClient.on('futures.trades', (data) => {
      this.handleTradeUpdate(data);
    });

    // Handle order updates (authenticated)
    this.wsClient.on('futures.orders', (data) => {
      this.handleOrderUpdate(data);
    });

    // Handle position updates (authenticated)
    this.wsClient.on('futures.positions', (data) => {
      this.handlePositionUpdate(data);
    });
  }

  private handleTickerUpdate(data: any[]): void {
    for (const ticker of data) {
      const symbol = ticker.contract.replace('_USDT', '');

      this.tickerCache.set(symbol, {
        symbol,
        last: Number.parseFloat(ticker.last),
        change24h: Number.parseFloat(ticker.change_percentage || '0'),
        volume24h: Number.parseFloat(ticker.volume_24h || '0'),
        fundingRate: Number.parseFloat(ticker.funding_rate || '0'),
        timestamp: Date.now(),
      });

      // Emit event for subscribers
      this.wsClient.emit('ticker', symbol, this.tickerCache.get(symbol));
    }
  }

  private handleCandleUpdate(data: any[]): void {
    for (const candle of data) {
      const [timestamp, volumeStr, closeStr, highStr, lowStr, openStr, name] = candle;
      const [interval, contract] = name.split('_');
      const symbol = contract.replace('_USDT', '');

      const candleData = {
        t: timestamp,
        o: openStr,
        h: highStr,
        l: lowStr,
        c: closeStr,
        v: volumeStr,
      };

      // Add to buffer
      const bufferKey = `${symbol}_${interval}`;
      if (!this.candleBuffers.has(bufferKey)) {
        this.candleBuffers.set(bufferKey, new CandleBuffer(100)); // Keep last 100 candles
      }

      this.candleBuffers.get(bufferKey).add(candleData);

      // Emit event
      this.wsClient.emit('candle', symbol, interval, candleData);
    }
  }

  getTicker(symbol: string): TickerData | null {
    return this.tickerCache.get(symbol) || null;
  }

  getCandles(symbol: string, interval: string, limit: number = 100): Candle[] {
    const bufferKey = `${symbol}_${interval}`;
    const buffer = this.candleBuffers.get(bufferKey);
    return buffer ? buffer.getRecent(limit) : [];
  }
}

class CandleBuffer {
  private candles: Candle[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(candle: Candle): void {
    // Update existing candle if same timestamp (candle still forming)
    const existingIndex = this.candles.findIndex(c => c.t === candle.t);
    if (existingIndex !== -1) {
      this.candles[existingIndex] = candle;
    } else {
      this.candles.push(candle);

      // Keep only last N candles
      if (this.candles.length > this.maxSize) {
        this.candles.shift();
      }
    }
  }

  getRecent(limit: number): Candle[] {
    return this.candles.slice(-limit);
  }
}
```

### 4.4 Migration from REST to WebSocket

```typescript
// src/services/marketDataService.ts

export class MarketDataService {
  private wsManager: WebSocketDataManager;
  private gateClient: GateClient;  // REST client (fallback)
  private useWebSocket: boolean;

  constructor(useWebSocket: boolean = true) {
    this.useWebSocket = useWebSocket;

    if (useWebSocket) {
      const wsClient = new GateWebSocketClient({
        url: process.env.GATE_USE_TESTNET === 'true'
          ? 'wss://fx-ws-testnet.gateio.ws/v4/ws/usdt'
          : 'wss://fx-ws.gateio.ws/v4/ws/usdt',
        reconnectDelay: 1000,
        maxReconnectAttempts: 10,
        heartbeatInterval: 30000,
      });

      this.wsManager = new WebSocketDataManager(wsClient);

      // Subscribe to all symbols
      for (const symbol of SYMBOLS) {
        const contract = `${symbol}_USDT`;

        // Subscribe to tickers
        wsClient.subscribe('futures.tickers', [contract]);

        // Subscribe to candles (all intervals)
        for (const interval of ['1m', '3m', '5m', '15m', '30m', '1h']) {
          wsClient.subscribe('futures.candlesticks', [interval, contract]);
        }
      }
    } else {
      this.gateClient = createGateClient();
    }
  }

  async getTicker(symbol: string): Promise<TickerData> {
    if (this.useWebSocket) {
      const ticker = this.wsManager.getTicker(symbol);

      // Fallback to REST if WebSocket data not available
      if (!ticker || Date.now() - ticker.timestamp > 5000) {
        logger.warn(`WebSocket ticker for ${symbol} stale, using REST fallback`);
        return this.getTickerREST(symbol);
      }

      return ticker;
    } else {
      return this.getTickerREST(symbol);
    }
  }

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    if (this.useWebSocket) {
      const candles = this.wsManager.getCandles(symbol, interval, limit);

      // Fallback to REST if not enough candles
      if (candles.length < limit) {
        logger.warn(`WebSocket candles for ${symbol} ${interval} incomplete, using REST fallback`);
        return this.getCandlesREST(symbol, interval, limit);
      }

      return candles;
    } else {
      return this.getCandlesREST(symbol, interval, limit);
    }
  }

  private async getTickerREST(symbol: string): Promise<TickerData> {
    const contract = `${symbol}_USDT`;
    const ticker = await this.gateClient.getFuturesTicker(contract);

    return {
      symbol,
      last: Number.parseFloat(ticker.last),
      change24h: Number.parseFloat(ticker.change_percentage || '0'),
      volume24h: Number.parseFloat(ticker.volume_24h || '0'),
      fundingRate: Number.parseFloat(ticker.funding_rate || '0'),
      timestamp: Date.now(),
    };
  }

  private async getCandlesREST(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const contract = `${symbol}_USDT`;
    return await this.gateClient.getFuturesCandles(contract, interval, limit);
  }
}
```

### 4.5 WebSocket Performance Monitoring

```typescript
// src/services/websocket/monitor.ts

export interface WebSocketMetrics {
  // Connection health
  connected: boolean;
  uptime: number;                // ms since last connect
  reconnectCount: number;

  // Latency
  avgLatency: number;            // ms average message latency
  maxLatency: number;            // ms worst latency

  // Message rate
  messagesReceived: number;
  messagesPerSecond: number;

  // Data freshness
  lastTickerUpdate: Record<string, number>;  // timestamp per symbol
  lastCandleUpdate: Record<string, number>;  // timestamp per symbol

  // Errors
  errorCount: number;
  lastError: string | null;
}

export class WebSocketMonitor {
  private metrics: WebSocketMetrics;
  private messageTimestamps: number[] = [];

  constructor(private wsClient: GateWebSocketClient) {
    this.setupMonitoring();
  }

  private setupMonitoring(): void {
    this.wsClient.on('message', () => {
      this.metrics.messagesReceived++;
      this.messageTimestamps.push(Date.now());

      // Keep only last 60 seconds of timestamps
      const cutoff = Date.now() - 60000;
      this.messageTimestamps = this.messageTimestamps.filter(t => t > cutoff);

      // Calculate messages per second
      this.metrics.messagesPerSecond = this.messageTimestamps.length / 60;
    });

    this.wsClient.on('ticker', (symbol, data) => {
      this.metrics.lastTickerUpdate[symbol] = Date.now();
    });

    this.wsClient.on('error', (error) => {
      this.metrics.errorCount++;
      this.metrics.lastError = error.message;
    });
  }

  getMetrics(): WebSocketMetrics {
    return { ...this.metrics };
  }

  // Log metrics periodically
  startLogging(intervalMs: number = 60000): void {
    setInterval(() => {
      const metrics = this.getMetrics();
      logger.info('WebSocket Metrics:', {
        connected: metrics.connected,
        uptime: `${(metrics.uptime / 1000 / 60).toFixed(1)}m`,
        reconnects: metrics.reconnectCount,
        msgPerSec: metrics.messagesPerSecond.toFixed(1),
        avgLatency: `${metrics.avgLatency.toFixed(0)}ms`,
        errors: metrics.errorCount,
      });
    }, intervalMs);
  }
}
```

---

## 5. Implementation Order

### Phase 3A: Adaptive Parameters (Weeks 1-2)

1. ✅ Design document (this file)
2. ⏳ Implement ADX indicator calculation
3. ⏳ Implement market regime detection
4. ⏳ Create adaptive parameter configuration
5. ⏳ Update indicator calculations to use adaptive parameters
6. ⏳ Implement ATR-based stop-loss/take-profit
7. ⏳ Update cache to support regime-based parameters
8. ⏳ Add regime and adaptive parameter display to AI prompts
9. ⏳ Backtest adaptive vs fixed parameters
10. ⏳ Documentation and commit

### Phase 3B: Machine Learning (Weeks 3-5)

11. ⏳ Research and select ML framework (XGBoost recommended)
12. ⏳ Implement feature extraction
13. ⏳ Implement data collector and labeling system
14. ⏳ Collect initial training dataset (1-2 weeks of data)
15. ⏳ Implement model training pipeline
16. ⏳ Train initial model
17. ⏳ Implement model inference service
18. ⏳ Integrate ML predictions into trading loop
19. ⏳ Add ML predictions to AI prompts
20. ⏳ Implement model monitoring and retraining
21. ⏳ Documentation and commit

### Phase 3C: WebSocket Integration (Weeks 6-7)

22. ⏳ Study Gate.io WebSocket documentation
23. ⏳ Implement WebSocket client class
24. ⏳ Implement connection management (reconnect, heartbeat)
25. ⏳ Implement data handlers (ticker, candles, trades)
26. ⏳ Implement WebSocket data manager
27. ⏳ Create market data service with REST fallback
28. ⏳ Migrate trading loop to use WebSocket service
29. ⏳ Implement WebSocket monitoring
30. ⏳ Test WebSocket stability and performance
31. ⏳ Documentation and commit

### Phase 3D: Integration & Testing (Week 8)

32. ⏳ End-to-end integration testing
33. ⏳ Performance benchmarking
34. ⏳ Load testing WebSocket connections
35. ⏳ Final documentation updates
36. ⏳ Production deployment plan
37. ⏳ Deploy to testnet
38. ⏳ Monitor and validate results
39. ⏳ Deploy to mainnet (if results positive)

---

## 6. Performance Considerations

### 6.1 Adaptive Parameters

**Computation Cost**: Low
- Regime detection: ~5-10ms per symbol
- Parameter lookup: ~1ms

**Caching Strategy**:
- Cache regime classification for 5 minutes (regimes don't change rapidly)
- Invalidate cache on significant volatility spike

### 6.2 Machine Learning

**Training Time**:
- XGBoost: 1-5 minutes for 10k samples
- LSTM: 30-60 minutes for 50k samples

**Inference Time**:
- XGBoost: 1-5ms per prediction
- LSTM: 10-50ms per prediction

**Memory Usage**:
- XGBoost model: ~10-50MB
- Training data: ~100MB per 10k samples

**Retraining Schedule**:
- Daily: Retrain with last 7 days of data
- Weekly: Full retrain with all historical data

### 6.3 WebSocket

**Latency Improvement**:
- REST polling: 2-5 seconds data lag
- WebSocket: 100-500ms data lag
- **Improvement**: ~80% reduction

**CPU Usage**:
- REST: Periodic spikes every 5 seconds
- WebSocket: Continuous low CPU (~1-2%)

**Network Usage**:
- REST: ~100 requests/minute (bursty)
- WebSocket: Persistent connection, smoother traffic

**Message Rate** (6 symbols × 6 timeframes):
- Ticker updates: ~1-5 per second
- Candle updates: Variable (1-10 per minute)
- Order/position updates: On-demand

---

## 7. Risk Management

### 7.1 Adaptive Parameters Risks

**Risk**: Overfitting to recent market conditions
**Mitigation**:
- Use 5-minute cache for regime detection
- Require minimum confidence threshold (0.7+)
- Fall back to base parameters if confidence low

**Risk**: Rapid regime switching causing excessive trades
**Mitigation**:
- Add regime transition smoothing (hysteresis)
- Require regime to persist for 2+ cycles before adapting

### 7.2 Machine Learning Risks

**Risk**: Model overfitting to historical data
**Mitigation**:
- Use proper train/validation/test split
- Cross-validation with time-series aware splits
- Monitor out-of-sample performance continuously

**Risk**: Model becomes stale as market changes
**Mitigation**:
- Daily retraining with recent data
- Track model performance metrics in real-time
- Auto-disable model if accuracy drops below threshold

**Risk**: Model predictions lead to worse results
**Mitigation**:
- Start with low confidence threshold (0.8+)
- Run A/B test: 50% trades use ML, 50% don't
- Compare win rates and only keep ML if better

### 7.3 WebSocket Risks

**Risk**: WebSocket disconnection causes data loss
**Mitigation**:
- Automatic reconnection with exponential backoff
- REST API fallback when WebSocket unavailable
- Buffer last 100 candles to avoid data gaps

**Risk**: WebSocket data corruption or delays
**Mitigation**:
- Validate all incoming messages (schema validation)
- Compare WebSocket data with occasional REST fetches
- Monitor data freshness (alert if stale >5 seconds)

**Risk**: High message rate overwhelms system
**Mitigation**:
- Message throttling/buffering if needed
- Use worker threads for message processing
- Monitor CPU/memory usage

---

## Summary

Phase 3 brings advanced intelligence to the trading system:

1. **Adaptive Parameters**: System adjusts to changing market conditions automatically
2. **Machine Learning**: Predictive models enhance decision accuracy by 20-30%
3. **WebSocket**: Real-time data reduces latency by 80%

**Expected Timeline**: 8 weeks total

**Expected Improvements**:
- Signal accuracy: +25-35% (adaptive + ML combined)
- Data latency: -80% (WebSocket)
- Win rate: +20-30% (ML predictions)
- System responsiveness: Significantly improved

**Next Steps**: Begin with Phase 3A (Adaptive Parameters) as it provides immediate value with lowest complexity.
