#!/usr/bin/env python3
"""
ML Service for nof1.ai Trading Bot
FastAPI service providing XGBoost predictions and training endpoints
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ConfigDict
import joblib

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).parent
MODEL_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR / "data"
MODEL_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

# Global model cache
current_model: Optional[xgb.Booster] = None
model_metadata: Dict[str, Any] = {}

# Lifespan context manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan events for startup and shutdown"""
    # Startup
    logger.info("=" * 60)
    logger.info("Starting nof1.ai ML Service")
    logger.info("=" * 60)
    logger.info(f"Feature count: {NUM_FEATURES}")
    logger.info(f"Model directory: {MODEL_DIR}")
    logger.info(f"Data directory: {DATA_DIR}")

    # Try to load existing model
    if load_latest_model():
        logger.info("✓ Service ready with trained model")
    else:
        logger.warning("⚠ Service started without trained model - predictions will fail until training")

    yield

    # Shutdown (if needed)
    logger.info("Shutting down ML service...")

# Initialize FastAPI with lifespan
app = FastAPI(
    title="nof1.ai ML Service",
    description="XGBoost-powered trading signal prediction service",
    version="1.0.0",
    lifespan=lifespan
)

# Feature configuration (60+ features as designed in Phase 3)
FEATURE_NAMES = [
    # Price sequences (5 timeframes × 3 = 15 features)
    'price_1m_1', 'price_1m_2', 'price_1m_3',
    'price_3m_1', 'price_3m_2', 'price_3m_3',
    'price_5m_1', 'price_5m_2', 'price_5m_3',
    'price_15m_1', 'price_15m_2', 'price_15m_3',
    'price_30m_1', 'price_30m_2', 'price_30m_3',

    # Technical indicators - Phase 1 (10 features)
    'ema20', 'ema50', 'macd', 'macd_signal', 'macd_histogram',
    'rsi7', 'rsi14', 'volume', 'volume_sma20', 'volume_ratio',

    # Technical indicators - Phase 2 (15 features)
    'atr14', 'bb_upper', 'bb_middle', 'bb_lower', 'bb_bandwidth',
    'vwap', 'obv', 'obv_ema20', 'srsi_k', 'srsi_d',
    'kc_upper', 'kc_lower', 'support', 'resistance', 'price_to_support_ratio',

    # Market regime - Phase 3A (10 features)
    'regime_trending_bull', 'regime_trending_bear', 'regime_ranging_volatile',
    'regime_ranging_calm', 'regime_breakout', 'regime_confidence',
    'adx', 'volatility_level', 'trend_strength', 'volume_surge',

    # Derived features (10 features)
    'price_change_pct', 'ema_cross', 'rsi_momentum', 'bb_position',
    'volume_trend', 'trend_alignment', 'volatility_regime',
    'support_distance', 'resistance_distance', 'price_momentum',
]

NUM_FEATURES = len(FEATURE_NAMES)  # 60 features

# Request/Response models
class PredictionRequest(BaseModel):
    """Request model for prediction endpoint"""
    features: List[float] = Field(..., min_length=NUM_FEATURES, max_length=NUM_FEATURES)
    symbol: str = Field(..., description="Trading symbol (e.g., BTC_USDT)")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "features": [0.0] * NUM_FEATURES,
                "symbol": "BTC_USDT"
            }
        }
    )

class PredictionResponse(BaseModel):
    """Response model for prediction endpoint"""
    prediction: int = Field(..., description="Predicted signal: 0=HOLD, 1=BUY, 2=SELL")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Prediction confidence (0-1)")
    probabilities: Dict[str, float] = Field(..., description="Class probabilities")
    model_version: str = Field(..., description="Model version used")
    feature_count: int = Field(..., description="Number of features processed")

class TrainingRequest(BaseModel):
    """Request model for training endpoint"""
    data_path: Optional[str] = Field(None, description="Path to training data CSV")
    min_samples: int = Field(10000, description="Minimum samples required for training")

class TrainingResponse(BaseModel):
    """Response model for training endpoint"""
    success: bool
    message: str
    metrics: Optional[Dict[str, float]] = None
    model_version: str
    training_samples: int
    training_time_seconds: float

class HealthResponse(BaseModel):
    """Response model for health check"""
    status: str
    model_loaded: bool
    model_version: Optional[str] = None
    feature_count: int
    uptime_seconds: float

# Service start time
service_start_time = datetime.now()

def load_latest_model() -> bool:
    """Load the latest trained model from disk"""
    global current_model, model_metadata

    try:
        model_files = list(MODEL_DIR.glob("xgboost_*.json"))
        if not model_files:
            logger.warning("No trained models found in models directory")
            return False

        # Get latest model by filename (contains timestamp)
        latest_model_path = sorted(model_files)[-1]
        metadata_path = latest_model_path.with_suffix('.meta.json')

        # Load model
        current_model = xgb.Booster()
        current_model.load_model(str(latest_model_path))

        # Load metadata if exists
        if metadata_path.exists():
            with open(metadata_path, 'r') as f:
                model_metadata = json.load(f)
        else:
            model_metadata = {
                'version': latest_model_path.stem,
                'created_at': datetime.now().isoformat(),
                'feature_count': NUM_FEATURES,
            }

        logger.info(f"✓ Loaded model: {latest_model_path.name}")
        logger.info(f"  Version: {model_metadata.get('version', 'unknown')}")
        logger.info(f"  Accuracy: {model_metadata.get('accuracy', 'N/A')}")

        return True

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return False

@app.get("/")
async def root():
    """Root endpoint with service info"""
    return {
        "service": "nof1.ai ML Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "predict": "/predict (POST)",
            "train": "/train (POST)",
        }
    }

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    uptime = (datetime.now() - service_start_time).total_seconds()

    return HealthResponse(
        status="healthy" if current_model is not None else "no_model",
        model_loaded=current_model is not None,
        model_version=model_metadata.get('version') if current_model else None,
        feature_count=NUM_FEATURES,
        uptime_seconds=uptime,
    )

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """
    Predict trading signal from features

    Returns:
        - prediction: 0=HOLD, 1=BUY, 2=SELL
        - confidence: probability of predicted class
        - probabilities: all class probabilities
    """
    if current_model is None:
        raise HTTPException(
            status_code=503,
            detail="No trained model available. Please train a model first via /train endpoint"
        )

    try:
        # Validate feature count
        if len(request.features) != NUM_FEATURES:
            raise HTTPException(
                status_code=400,
                detail=f"Expected {NUM_FEATURES} features, got {len(request.features)}"
            )

        # Convert features to numpy array
        X = np.array([request.features], dtype=np.float32)

        # Create DMatrix for XGBoost
        dmatrix = xgb.DMatrix(X, feature_names=FEATURE_NAMES)

        # Get predictions (probabilities for each class)
        probabilities = current_model.predict(dmatrix)[0]  # Shape: (3,) for 3 classes

        # Get predicted class (0=HOLD, 1=BUY, 2=SELL)
        prediction = int(np.argmax(probabilities))
        confidence = float(probabilities[prediction])

        # Build response
        response = PredictionResponse(
            prediction=prediction,
            confidence=confidence,
            probabilities={
                'HOLD': float(probabilities[0]),
                'BUY': float(probabilities[1]),
                'SELL': float(probabilities[2]),
            },
            model_version=model_metadata.get('version', 'unknown'),
            feature_count=NUM_FEATURES,
        )

        logger.debug(
            f"Prediction for {request.symbol}: "
            f"{'HOLD' if prediction == 0 else 'BUY' if prediction == 1 else 'SELL'} "
            f"(confidence: {confidence:.2%})"
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@app.post("/train", response_model=TrainingResponse)
async def train_model(request: TrainingRequest):
    """
    Train new XGBoost model from collected data

    Expects CSV file with columns: features (60 cols) + label (0/1/2)
    """
    global current_model, model_metadata

    start_time = datetime.now()

    try:
        # Determine data path
        if request.data_path:
            data_path = Path(request.data_path)
        else:
            # Use default path
            data_path = DATA_DIR / "training_data.csv"

        if not data_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Training data not found at {data_path}"
            )

        # Load training data
        logger.info(f"Loading training data from {data_path}")
        df = pd.read_csv(data_path)

        # Validate data
        if len(df) < request.min_samples:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient training data: {len(df)} samples (minimum: {request.min_samples})"
            )

        # Check columns
        if 'label' not in df.columns:
            raise HTTPException(
                status_code=400,
                detail="Training data missing 'label' column"
            )

        # Separate features and labels
        X = df[FEATURE_NAMES].values
        y = df['label'].values

        logger.info(f"Training with {len(X)} samples, {X.shape[1]} features")
        logger.info(f"Label distribution: {dict(pd.Series(y).value_counts())}")

        # Split train/test (80/20)
        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        # Create DMatrix
        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=FEATURE_NAMES)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=FEATURE_NAMES)

        # XGBoost parameters (optimized for CPU)
        params = {
            'objective': 'multi:softprob',  # Multi-class classification
            'num_class': 3,                  # 3 classes: HOLD, BUY, SELL
            'max_depth': 6,
            'learning_rate': 0.1,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_weight': 1,
            'eval_metric': 'mlogloss',
            'seed': 42,
            'tree_method': 'hist',           # Fastest on CPU
            'nthread': -1,                   # Use all CPU cores
        }

        # Train model
        logger.info("Starting training...")
        evals = [(dtrain, 'train'), (dtest, 'test')]
        model = xgb.train(
            params,
            dtrain,
            num_boost_round=100,
            evals=evals,
            early_stopping_rounds=10,
            verbose_eval=10,
        )

        # Evaluate
        y_pred = model.predict(dtest)
        y_pred_labels = np.argmax(y_pred, axis=1)

        from sklearn.metrics import accuracy_score, precision_recall_fscore_support
        accuracy = accuracy_score(y_test, y_pred_labels)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_test, y_pred_labels, average='weighted', zero_division=0
        )

        logger.info(f"✓ Training completed")
        logger.info(f"  Accuracy: {accuracy:.2%}")
        logger.info(f"  Precision: {precision:.2%}")
        logger.info(f"  Recall: {recall:.2%}")
        logger.info(f"  F1 Score: {f1:.2%}")

        # Save model
        version = datetime.now().strftime("%Y%m%d_%H%M%S")
        model_path = MODEL_DIR / f"xgboost_{version}.json"
        metadata_path = MODEL_DIR / f"xgboost_{version}.meta.json"

        model.save_model(str(model_path))

        # Save metadata
        metadata = {
            'version': version,
            'created_at': datetime.now().isoformat(),
            'feature_count': NUM_FEATURES,
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'accuracy': float(accuracy),
            'precision': float(precision),
            'recall': float(recall),
            'f1_score': float(f1),
            'params': params,
        }

        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        logger.info(f"✓ Model saved: {model_path.name}")

        # Load new model into service
        current_model = model
        model_metadata = metadata

        training_time = (datetime.now() - start_time).total_seconds()

        return TrainingResponse(
            success=True,
            message="Model trained and deployed successfully",
            metrics={
                'accuracy': float(accuracy),
                'precision': float(precision),
                'recall': float(recall),
                'f1_score': float(f1),
            },
            model_version=version,
            training_samples=len(X_train),
            training_time_seconds=training_time,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Training error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@app.get("/model/info")
async def model_info():
    """Get current model information"""
    if current_model is None:
        return {"status": "no_model", "message": "No model loaded"}

    return {
        "status": "loaded",
        "metadata": model_metadata,
        "feature_names": FEATURE_NAMES,
        "feature_count": NUM_FEATURES,
    }

if __name__ == "__main__":
    import uvicorn

    # Run server
    uvicorn.run(
        "ml_service:app",
        host="127.0.0.1",
        port=8001,
        reload=True,
        log_level="info",
    )
