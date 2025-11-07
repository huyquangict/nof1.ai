#!/usr/bin/env python3
"""
Standalone training script for XGBoost models
Can be run manually or via scheduler
"""

import sys
import argparse
import logging
from pathlib import Path
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def train_model(
    data_path: str = None,
    min_samples: int = 10000,
    ml_service_url: str = "http://127.0.0.1:8001"
):
    """
    Trigger model training via ML service API

    Args:
        data_path: Path to training data CSV (optional, uses default if None)
        min_samples: Minimum samples required for training
        ml_service_url: ML service URL
    """
    try:
        logger.info("=" * 60)
        logger.info("XGBoost Model Training")
        logger.info("=" * 60)

        # Check if ML service is running
        try:
            response = requests.get(f"{ml_service_url}/health", timeout=5)
            if response.status_code != 200:
                logger.error("ML service is not healthy")
                return False
        except requests.exceptions.RequestException:
            logger.error(f"ML service not reachable at {ml_service_url}")
            logger.error("Please start the ML service first:")
            logger.error("  cd src/ml && python ml_service.py")
            return False

        # Prepare training request
        payload = {
            "min_samples": min_samples
        }
        if data_path:
            payload["data_path"] = data_path

        logger.info(f"Sending training request to {ml_service_url}/train")
        if data_path:
            logger.info(f"  Data path: {data_path}")
        logger.info(f"  Min samples: {min_samples}")

        # Send training request
        response = requests.post(
            f"{ml_service_url}/train",
            json=payload,
            timeout=600  # 10 minutes timeout for training
        )

        if response.status_code == 200:
            result = response.json()
            logger.info("=" * 60)
            logger.info("✓ Training completed successfully!")
            logger.info("=" * 60)
            logger.info(f"Model version: {result['model_version']}")
            logger.info(f"Training samples: {result['training_samples']}")
            logger.info(f"Training time: {result['training_time_seconds']:.1f}s")

            if result.get('metrics'):
                metrics = result['metrics']
                logger.info("\nMetrics:")
                logger.info(f"  Accuracy:  {metrics['accuracy']:.2%}")
                logger.info(f"  Precision: {metrics['precision']:.2%}")
                logger.info(f"  Recall:    {metrics['recall']:.2%}")
                logger.info(f"  F1 Score:  {metrics['f1_score']:.2%}")

            logger.info("\n✓ Model is now active in ML service")
            return True
        else:
            error_detail = response.json().get('detail', 'Unknown error')
            logger.error(f"Training failed: {error_detail}")
            return False

    except Exception as e:
        logger.error(f"Training error: {e}", exc_info=True)
        return False

def main():
    parser = argparse.ArgumentParser(description="Train XGBoost trading model")
    parser.add_argument(
        "--data-path",
        type=str,
        help="Path to training data CSV file",
        default=None
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        help="Minimum samples required for training",
        default=10000
    )
    parser.add_argument(
        "--ml-service-url",
        type=str,
        help="ML service URL",
        default="http://127.0.0.1:8001"
    )

    args = parser.parse_args()

    success = train_model(
        data_path=args.data_path,
        min_samples=args.min_samples,
        ml_service_url=args.ml_service_url
    )

    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
