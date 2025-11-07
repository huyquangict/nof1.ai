# Phase 3B: Machine Learning Integration Guide

## Overview

Phase 3B adds **XGBoost-powered machine learning predictions** to the nof1.ai trading system. The ML model analyzes 60+ features from market data and provides BUY/SELL/HOLD signals with confidence scores to support AI agent decision-making.

**Key Features:**
- ✅ XGBoost classification model (CPU-optimized, no GPU required)
- ✅ 60-feature vector (price sequences, Phase 1/2 indicators, Phase 3A regime data)
- ✅ Python FastAPI service for training and inference
- ✅ TypeScript integration via HTTP client
- ✅ Automatic training data collection
- ✅ Scheduled model retraining
- ✅ Graceful fallback when ML service unavailable

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   nof1.ai Trading Bot (TypeScript)           │
│                                                               │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  Trading    │────>│   Feature   │────>│  ML Client   │  │
│  │  Loop       │     │  Extraction │     │  (HTTP)      │  │
│  └─────────────┘     └─────────────┘     └──────┬───────┘  │
│         │                                         │          │
│         │ Market Data                             │ HTTP     │
│         v                                         v          │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  Data       │────>│  SQLite     │<────│  Training    │  │
│  │  Collector  │     │  Database   │     │  Scheduler   │  │
│  └─────────────┘     └─────────────┘     └──────┬───────┘  │
│                                                   │          │
└───────────────────────────────────────────────────┼──────────┘
                                                    │
                    HTTP (prediction/training)     │
                                                    v
┌─────────────────────────────────────────────────────────────┐
│            ML Service (Python FastAPI)                       │
│                                                               │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  /predict   │────>│  XGBoost    │<────│   /train     │  │
│  │  endpoint   │     │  Model      │     │  endpoint    │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│                           │                                  │
│                           v                                  │
│                    ┌─────────────┐                          │
│                    │  models/    │                          │
│                    │  *.json     │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Setup Instructions

### 1. Install Python Dependencies

```bash
cd src/ml
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Dependencies:**
- FastAPI 0.115.0
- uvicorn[standard] 0.32.0
- xgboost 2.1.1
- scikit-learn 1.5.2
- numpy 1.26.4
- pandas 2.2.3

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Enable ML predictions
ML_ENABLED=true

# ML service URL (default: http://127.0.0.1:8001)
ML_SERVICE_URL=http://127.0.0.1:8001

# Collect training data during trading
ML_COLLECT_TRAINING_DATA=true

# Enable automatic training (daily at 2 AM)
ML_TRAINING_ENABLED=true
ML_TRAINING_SCHEDULE=0 2 * * *
ML_MIN_TRAINING_SAMPLES=10000
```

### 3. Start ML Service

**Option A: Manual Start (Development)**

```bash
cd src/ml
./start_ml_service.sh
```

**Option B: PM2 (Production)**

```bash
pm2 start src/ml/ecosystem.ml.config.js
pm2 logs nof1-ml-service
```

**Option C: Docker**

```bash
# Add to docker-compose.yml
services:
  ml-service:
    build: ./src/ml
    ports:
      - "8001:8001"
    volumes:
      - ./src/ml/models:/app/models
      - ./src/ml/data:/app/data
```

### 4. Verify Service is Running

```bash
curl http://127.0.0.1:8001/health
```

Expected response:
```json
{
  "status": "healthy",
  "model_loaded": false,
  "feature_count": 60,
  "uptime_seconds": 42.5
}
```

---

## Training Workflow

### Initial Training

**Step 1: Collect Training Data**

Enable data collection and let the bot run for a few days:

```bash
# In .env
ML_COLLECT_TRAINING_DATA=true
ML_ENABLED=false  # No predictions yet, just collect data
```

Run the trading bot normally. Market data will be collected into `ml_training_data` table.

**Step 2: Check Training Data**

```typescript
import { getTrainingDataStats } from "./src/ml/dataCollector";

const stats = await getTrainingDataStats();
console.log(stats);
// {
//   total: 15234,
//   labeled: 8942,
//   unlabeled: 6292,
//   byLabel: { HOLD: 4521, BUY: 2301, SELL: 2120 }
// }
```

**Step 3: Label Training Samples**

Samples are automatically labeled based on trading outcomes:
- When AI opens a position → `collectTrainingSample()` stores unlabeled sample
- When position closes → `labelTrainingSample()` labels it based on P&L:
  - Profit >2% → `BUY` (if long) or `SELL` (if short)
  - Loss <-2% → opposite label
  - Otherwise → `HOLD`

For samples without trades, use `autoLabelSamples()` based on future price movement.

**Step 4: Export Training Data**

```bash
# Automatic export during training
npm run ml:export-data

# Or manually via TypeScript
import { exportTrainingDataToCSV } from "./src/ml/dataCollector";
await exportTrainingDataToCSV("src/ml/data/training_data.csv");
```

**Step 5: Train Model**

```bash
# Option A: Via Python script
cd src/ml
python train.py

# Option B: Via HTTP API
curl -X POST http://127.0.0.1:8001/train \
  -H "Content-Type: application/json" \
  -d '{
    "min_samples": 10000
  }'

# Option C: Via TypeScript
import { trainMlModel } from "./src/ml/mlClient";
await trainMlModel();
```

Training output:
```
Starting XGBoost Model Training
Training with 12000 samples, 60 features
Label distribution: {0: 5200, 1: 3500, 2: 3300}

Training...
[0] train-mlogloss:0.98234  test-mlogloss:0.99012
[10] train-mlogloss:0.65421  test-mlogloss:0.68234
...
[100] train-mlogloss:0.42112  test-mlogloss:0.48765

✓ Training completed
  Accuracy:  68.4%
  Precision: 67.2%
  Recall:    66.8%
  F1 Score:  67.0%

✓ Model saved: xgboost_20250107_020045.json
```

**Step 6: Enable ML Predictions**

```bash
# In .env
ML_ENABLED=true
```

Restart trading bot. ML predictions will now be included in AI agent context.

---

## Feature Engineering

The ML model uses **60 features** organized into categories:

### 1. Price Sequences (15 features)

Recent price history from multiple timeframes:
- 1m: last 3 closes
- 3m: last 3 closes
- 5m: last 3 closes
- 15m: last 3 closes
- 30m: last 3 closes

**Rationale:** Captures short-term price momentum and patterns

### 2. Phase 1 Indicators (10 features)

- EMA 20/50
- MACD (line, signal, histogram)
- RSI 7/14
- Volume (current, SMA20, ratio)

**Rationale:** Core technical indicators for trend and momentum

### 3. Phase 2 Indicators (15 features)

- ATR 14 (volatility)
- Bollinger Bands (upper, middle, lower, bandwidth)
- VWAP
- OBV (On-Balance Volume, EMA20)
- Stochastic RSI (K, D)
- Keltner Channels (upper, lower)
- Support/Resistance levels
- Price-to-support ratio

**Rationale:** Advanced volatility, volume, and support/resistance analysis

### 4. Phase 3A Market Regime (10 features)

- Regime classification (one-hot encoded: TRENDING_BULL, TRENDING_BEAR, RANGING_VOLATILE, RANGING_CALM, BREAKOUT)
- Regime confidence
- ADX (trend strength)
- Volatility level (encoded: LOW=0.33, MEDIUM=0.67, HIGH=1.0)
- Trend strength
- Volume surge

**Rationale:** Market context helps model adapt to different regimes

### 5. Derived Features (10 features)

- Price change percentage
- EMA cross signal
- RSI momentum (RSI7 - RSI14)
- Bollinger Band position
- Volume trend
- Trend alignment (multi-indicator consensus)
- Volatility regime (ATR/price)
- Support distance
- Resistance distance
- Price momentum (multi-timeframe)

**Rationale:** Synthetic features capture complex relationships

---

## Model Performance

### Expected Metrics

Based on similar crypto trading ML models:

| Metric | Target | Good | Excellent |
|--------|--------|------|-----------|
| Accuracy | 60%+ | 65%+ | 70%+ |
| Precision | 55%+ | 60%+ | 65%+ |
| Recall | 55%+ | 60%+ | 65%+ |
| F1 Score | 55%+ | 60%+ | 65%+ |

**Note:** Crypto markets are inherently noisy. 60-65% accuracy is realistic and valuable when combined with technical analysis.

### Interpreting Predictions

The ML model outputs **3 class probabilities**:
- `HOLD` (0): No clear opportunity
- `BUY` (1): Bullish opportunity
- `SELL` (2): Bearish opportunity

**Confidence levels:**
- **High (≥70%)**: Strong ML signal, heavily consider in decision
- **Medium (50-70%)**: Moderate signal, use as supporting evidence
- **Low (<50%)**: Weak signal, prioritize technical analysis

**Example prediction:**
```json
{
  "prediction": 1,
  "confidence": 0.734,
  "probabilities": {
    "HOLD": 0.142,
    "BUY": 0.734,
    "SELL": 0.124
  },
  "modelVersion": "xgboost_20250107_020045"
}
```

**Interpretation:** Strong BUY signal (73.4% confidence). AI agent should:
1. Verify with technical indicators (price above EMA, positive MACD, RSI trending up)
2. Check market regime (is it TRENDING_BULL or BREAKOUT?)
3. Confirm volume support
4. If all align → consider opening long position

---

## Automatic Retraining

### Training Scheduler

The ML training scheduler (`src/scheduler/mlTraining.ts`) automatically:

1. **Triggers Training** (default: 2 AM daily)
2. **Checks Data Quality**
   - Minimum 10,000 labeled samples
   - All classes (HOLD/BUY/SELL) must have samples
   - Warns if label imbalance >10:1
3. **Exports Training Data** to CSV
4. **Calls ML Service** `/train` endpoint
5. **Validates New Model** (accuracy, F1 score)
6. **Deploys Model** if validation passes
7. **Cleans Old Data** (removes unlabeled samples >30 days old)

### Configuration

```bash
# Enable automatic training
ML_TRAINING_ENABLED=true

# Schedule (cron format)
ML_TRAINING_SCHEDULE=0 2 * * *  # Daily at 2 AM

# Minimum samples required
ML_MIN_TRAINING_SAMPLES=10000

# Train on startup (if data available)
ML_TRAIN_ON_STARTUP=false
```

### Manual Trigger

```typescript
import { triggerManualTraining } from "./src/scheduler/mlTraining";

const success = await triggerManualTraining();
```

---

## API Reference

### ML Service Endpoints

**Base URL:** `http://127.0.0.1:8001`

#### `GET /health`

Check service health and model status.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_version": "xgboost_20250107_020045",
  "feature_count": 60,
  "uptime_seconds": 3625.4
}
```

#### `POST /predict`

Get ML prediction from features.

**Request:**
```json
{
  "features": [/* array of 60 floats */],
  "symbol": "BTC_USDT"
}
```

**Response:**
```json
{
  "prediction": 1,
  "confidence": 0.734,
  "probabilities": {
    "HOLD": 0.142,
    "BUY": 0.734,
    "SELL": 0.124
  },
  "model_version": "xgboost_20250107_020045",
  "feature_count": 60
}
```

**Errors:**
- `503 Service Unavailable`: No trained model available
- `400 Bad Request`: Invalid feature count
- `500 Internal Server Error`: Prediction failed

#### `POST /train`

Trigger model training.

**Request:**
```json
{
  "data_path": "src/ml/data/training_data.csv",  // optional
  "min_samples": 10000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Model trained and deployed successfully",
  "metrics": {
    "accuracy": 0.684,
    "precision": 0.672,
    "recall": 0.668,
    "f1_score": 0.670
  },
  "model_version": "xgboost_20250107_020045",
  "training_samples": 12000,
  "training_time_seconds": 187.3
}
```

**Errors:**
- `404 Not Found`: Training data file not found
- `400 Bad Request`: Insufficient training samples
- `500 Internal Server Error`: Training failed

#### `GET /model/info`

Get current model information.

**Response:**
```json
{
  "status": "loaded",
  "metadata": {
    "version": "xgboost_20250107_020045",
    "created_at": "2025-01-07T02:00:45.123Z",
    "feature_count": 60,
    "training_samples": 12000,
    "accuracy": 0.684
  },
  "feature_names": [/* array of 60 feature names */]
}
```

---

## Integration with Trading Bot

### 1. Feature Extraction

In `tradingLoop.ts`, after collecting market data:

```typescript
// Prepare market data for ML
const mlMarketData: MarketDataForML = {
  currentPrice: data.price,
  price1m: data.timeframes?.["1m"]?.closes || [],
  // ... 55 more features
};

// Extract 60-feature vector
const features = extractFeatures(mlMarketData);
// [price_1m_1, price_1m_2, ..., price_momentum] (60 features)
```

### 2. Get ML Prediction

```typescript
// Get ML prediction
const mlPrediction = await getMlPrediction(features, symbol);

if (mlPrediction) {
  marketData[symbol].mlPrediction = {
    signal: "BUY",  // or "SELL", "HOLD"
    confidence: 0.734,
    probabilities: { HOLD: 0.142, BUY: 0.734, SELL: 0.124 },
    modelVersion: "xgboost_20250107_020045"
  };
}
```

### 3. AI Agent Context

ML prediction is automatically included in AI agent prompt:

```
[Phase 3B: ML Prediction from XGBoost Model]
ML Signal: BUY (confidence: 73.4%)
  Probabilities:
    HOLD: 14.2%
    BUY:  73.4%
    SELL: 12.4%
  Model: xgboost_20250107_020045

ML Interpretation:
  ✓ HIGH confidence (≥70%) - Strong ML signal, consider heavily in decision
  → ML suggests bullish opportunity. Check:
    • Does price action confirm? (above EMA, positive MACD)
    • Is momentum aligned? (RSI trending up)
    • Volume supporting? (increasing volume)

Important: ML is a supporting tool, NOT the sole decision maker.
Always combine with:
  1. Technical indicator confluence
  2. Market regime analysis
  3. Support/resistance levels
  4. Risk management rules
```

### 4. Data Collection for Training

```typescript
// Collect training sample (unlabeled)
if (process.env.ML_COLLECT_TRAINING_DATA === "true") {
  const sampleId = await collectTrainingSample(symbol, mlMarketData);

  // Later, when position closes, label the sample
  await labelTrainingSample(sampleId, label, actualPnl);
  // label: 0=HOLD, 1=BUY, 2=SELL
}
```

---

## Performance Considerations

### CPU-Only Training

XGBoost is highly optimized for CPU:
- **Training time:** 1-5 minutes for 10,000 samples
- **Inference time:** 1-5ms per prediction
- **Memory usage:** 2-4GB RAM during training

**Hardware recommendations:**
- Minimum: 4-core CPU, 4GB RAM
- Recommended: 8-core CPU, 8GB RAM
- No GPU required

### Service Latency

- **Health check:** <10ms
- **Prediction:** 20-50ms (HTTP + inference)
- **Training:** 2-5 minutes (10k samples)

**Impact on trading loop:**
- Total ML overhead: ~50ms per symbol
- For 6 symbols: ~300ms total
- Trading cycle: 5-20 minutes
- **Impact: <1% of cycle time**

### Graceful Degradation

If ML service is unavailable:
1. `mlClient.checkHealth()` returns `false`
2. `getMlPrediction()` returns `null`
3. `marketData[symbol].mlPrediction` set to `null`
4. AI agent prompt excludes ML section
5. **Trading continues normally without ML**

No errors, no crashes. ML is purely additive.

---

## Troubleshooting

### ML Service Not Starting

**Error:** `ModuleNotFoundError: No module named 'fastapi'`

**Solution:**
```bash
cd src/ml
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### No Model Loaded

**Error:** `503 Service Unavailable: No trained model available`

**Solution:**
1. Check if model files exist: `ls src/ml/models/`
2. Train a model: `python src/ml/train.py`
3. Verify model loads on service startup

### Training Fails: Insufficient Data

**Error:** `400 Bad Request: Insufficient training data: 2345 samples (minimum: 10000)`

**Solution:**
1. Let bot run longer to collect more data
2. Lower `ML_MIN_TRAINING_SAMPLES` (not recommended <5000)
3. Check if data collection is enabled: `ML_COLLECT_TRAINING_DATA=true`

### Prediction Accuracy Too Low

**Problem:** Model accuracy <55%

**Possible causes:**
1. **Insufficient training data** → Collect more (20k+ samples ideal)
2. **Label quality issues** → Review labeling logic in `dataCollector.ts`
3. **Feature engineering** → Add domain-specific features
4. **Market regime mismatch** → Train separate models per regime
5. **Overfitting** → Reduce `max_depth` in `ml_service.py`

**Solutions:**
1. Increase training data to 20,000+ samples
2. Improve label quality (review P&L thresholds)
3. Add more domain-specific features
4. Implement regime-specific models
5. Tune hyperparameters (`max_depth`, `learning_rate`, `subsample`)

### High Latency

**Problem:** ML predictions take >100ms

**Causes:**
1. Network latency between bot and ML service
2. Model too large (>1000 trees)
3. Too many concurrent requests

**Solutions:**
1. Run ML service on same machine as bot
2. Reduce `num_boost_round` in training (default: 100)
3. Implement request pooling/batching
4. Consider ONNX export for faster inference

---

## Best Practices

### 1. Start Small

- Begin with `ML_ENABLED=false`, just collect data
- Train first model after 10,000+ labeled samples
- Gradually enable predictions once confident in model

### 2. Monitor Performance

Track in production:
- Prediction accuracy vs actual outcomes
- Signal distribution (avoid >80% HOLD)
- Model update frequency
- Inference latency

### 3. Label Quality

Good labels = good model:
- Review P&L thresholds (current: ±2%)
- Consider regime-aware labeling
- Manual review of edge cases

### 4. Feature Engineering

Domain knowledge matters:
- Add crypto-specific features (funding rate, open interest)
- Experiment with derived features
- Feature importance analysis (XGBoost built-in)

### 5. Model Versioning

Keep track of models:
- Models auto-versioned by timestamp
- Metadata saved alongside (`.meta.json`)
- A/B test new models before deployment

### 6. Fallback Strategy

Always have fallback:
- Trading bot works without ML
- Retry logic for HTTP failures
- Health checks before predictions

---

## Future Enhancements

Potential Phase 3B improvements:

### 1. Multi-Model Ensemble
Train separate models per:
- Market regime (TRENDING, RANGING, BREAKOUT)
- Symbol (BTC, ETH, etc.)
- Timeframe (5m, 15m, 1h)

### 2. Deep Learning Models
Experiment with:
- LSTM for time-series prediction
- Transformer for multi-timeframe analysis
- Requires GPU for practical training

### 3. Online Learning
Update model in real-time:
- Incremental training on new data
- Adaptive learning rate
- Concept drift detection

### 4. Feature Selection
Optimize feature set:
- Feature importance analysis
- Remove low-importance features
- Add domain-specific features

### 5. Hyperparameter Optimization
Automated tuning:
- Grid search
- Bayesian optimization
- Cross-validation

### 6. Explainability
Understand model decisions:
- SHAP values for feature importance
- Partial dependence plots
- Decision tree visualization

---

## Conclusion

Phase 3B ML integration adds **intelligent prediction support** to the trading bot while maintaining system robustness. The XGBoost model learns from historical trading outcomes and provides probabilistic signals that complement technical analysis and market regime detection.

**Key takeaways:**
- ✅ CPU-only, no GPU required (1-5 minute training)
- ✅ 60+ features from all trading phases
- ✅ Graceful fallback if ML unavailable
- ✅ Automatic training data collection
- ✅ Scheduled model retraining
- ✅ Production-ready architecture

**Next steps:**
1. Start data collection (`ML_COLLECT_TRAINING_DATA=true`)
2. Let bot run for 1-2 weeks
3. Train initial model (10k+ samples)
4. Enable ML predictions (`ML_ENABLED=true`)
5. Monitor and iterate

For questions or issues, see:
- `PHASE_3_DESIGN.md` - Complete Phase 3 design
- `ML_HARDWARE_REQUIREMENTS.md` - Hardware requirements
- `CLAUDE.md` - Project overview and development guide
