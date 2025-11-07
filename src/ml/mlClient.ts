/**
 * ML Client for nof1.ai Trading Bot
 * Communicates with Python FastAPI ML service for predictions
 */

import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
	name: "ml-client",
	level: "info",
});

// ML service configuration
const ML_SERVICE_URL =
	process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
const ML_REQUEST_TIMEOUT = Number.parseInt(
	process.env.ML_REQUEST_TIMEOUT || "5000",
	10,
);
const ML_ENABLED = process.env.ML_ENABLED === "true";

// Prediction result
export interface MLPrediction {
	prediction: number; // 0=HOLD, 1=BUY, 2=SELL
	confidence: number; // 0-1
	probabilities: {
		HOLD: number;
		BUY: number;
		SELL: number;
	};
	modelVersion: string;
	featureCount: number;
}

// Service health status
export interface MLServiceHealth {
	status: string;
	modelLoaded: boolean;
	modelVersion: string | null;
	featureCount: number;
	uptimeSeconds: number;
}

// Training result
export interface MLTrainingResult {
	success: boolean;
	message: string;
	metrics: {
		accuracy: number;
		precision: number;
		recall: number;
		f1_score: number;
	} | null;
	modelVersion: string;
	trainingSamples: number;
	trainingTimeSeconds: number;
}

/**
 * ML Client class for interacting with Python ML service
 */
export class MLClient {
	private serviceUrl: string;
	private timeout: number;
	private isHealthy: boolean;
	private lastHealthCheck: number;
	private healthCheckInterval: number;

	constructor(serviceUrl?: string, timeout?: number) {
		this.serviceUrl = serviceUrl || ML_SERVICE_URL;
		this.timeout = timeout || ML_REQUEST_TIMEOUT;
		this.isHealthy = false;
		this.lastHealthCheck = 0;
		this.healthCheckInterval = 60000; // Check health every 60 seconds
	}

	/**
	 * Check if ML service is healthy
	 */
	async checkHealth(): Promise<boolean> {
		try {
			const now = Date.now();

			// Use cached health status if recently checked
			if (now - this.lastHealthCheck < this.healthCheckInterval) {
				return this.isHealthy;
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout for health check

			const response = await fetch(`${this.serviceUrl}/health`, {
				method: "GET",
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const health: MLServiceHealth = await response.json();
				this.isHealthy = health.modelLoaded;
				this.lastHealthCheck = now;

				if (!health.modelLoaded) {
					logger.warn("ML service is running but no model is loaded");
				}

				return this.isHealthy;
			}

			this.isHealthy = false;
			this.lastHealthCheck = now;
			return false;
		} catch (error) {
			// Service not reachable
			this.isHealthy = false;
			this.lastHealthCheck = Date.now();
			return false;
		}
	}

	/**
	 * Get ML prediction from features
	 * @param features Array of 60 feature values
	 * @param symbol Trading symbol (for logging)
	 * @returns ML prediction or null if service unavailable
	 */
	async getPrediction(
		features: number[],
		symbol: string,
	): Promise<MLPrediction | null> {
		if (!ML_ENABLED) {
			return null;
		}

		// Check if service is healthy
		const healthy = await this.checkHealth();
		if (!healthy) {
			logger.debug(
				`ML service not available - skipping ML prediction for ${symbol}`,
			);
			return null;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

			const response = await fetch(`${this.serviceUrl}/predict`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					features,
					symbol,
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const error = await response.json();
				logger.error(
					`ML prediction failed for ${symbol}: ${error.detail || "Unknown error"}`,
				);
				return null;
			}

			const result = await response.json();

			// Convert snake_case to camelCase
			const prediction: MLPrediction = {
				prediction: result.prediction,
				confidence: result.confidence,
				probabilities: result.probabilities,
				modelVersion: result.model_version,
				featureCount: result.feature_count,
			};

			logger.debug(
				`ML prediction for ${symbol}: ${this.getPredictionLabel(prediction.prediction)} ` +
					`(confidence: ${(prediction.confidence * 100).toFixed(1)}%)`,
			);

			return prediction;
		} catch (error) {
			if ((error as Error).name === "AbortError") {
				logger.warn(`ML prediction timeout for ${symbol}`);
			} else {
				logger.error(`ML prediction error for ${symbol}:`, error as any);
			}
			return null;
		}
	}

	/**
	 * Trigger model training
	 * @param dataPath Optional path to training data CSV
	 * @param minSamples Minimum samples required for training
	 * @returns Training result or null if failed
	 */
	async trainModel(
		dataPath?: string,
		minSamples = 10000,
	): Promise<MLTrainingResult | null> {
		try {
			logger.info("Triggering ML model training...");

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes for training

			const response = await fetch(`${this.serviceUrl}/train`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					data_path: dataPath,
					min_samples: minSamples,
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const error = await response.json();
				logger.error(
					`ML training failed: ${error.detail || "Unknown error"}`,
				);
				return null;
			}

			const result = await response.json();

			// Convert snake_case to camelCase
			const trainingResult: MLTrainingResult = {
				success: result.success,
				message: result.message,
				metrics: result.metrics,
				modelVersion: result.model_version,
				trainingSamples: result.training_samples,
				trainingTimeSeconds: result.training_time_seconds,
			};

			logger.info(`✓ ML training completed: ${trainingResult.message}`);
			logger.info(`  Model version: ${trainingResult.modelVersion}`);
			logger.info(`  Training samples: ${trainingResult.trainingSamples}`);
			logger.info(
				`  Training time: ${trainingResult.trainingTimeSeconds.toFixed(1)}s`,
			);

			if (trainingResult.metrics) {
				logger.info("  Metrics:");
				logger.info(
					`    Accuracy:  ${(trainingResult.metrics.accuracy * 100).toFixed(2)}%`,
				);
				logger.info(
					`    Precision: ${(trainingResult.metrics.precision * 100).toFixed(2)}%`,
				);
				logger.info(
					`    Recall:    ${(trainingResult.metrics.recall * 100).toFixed(2)}%`,
				);
				logger.info(
					`    F1 Score:  ${(trainingResult.metrics.f1_score * 100).toFixed(2)}%`,
				);
			}

			return trainingResult;
		} catch (error) {
			if ((error as Error).name === "AbortError") {
				logger.error("ML training timeout (10 minutes)");
			} else {
				logger.error("ML training error:", error as any);
			}
			return null;
		}
	}

	/**
	 * Get service health information
	 */
	async getHealth(): Promise<MLServiceHealth | null> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(`${this.serviceUrl}/health`, {
				method: "GET",
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				return null;
			}

			const health = await response.json();

			return {
				status: health.status,
				modelLoaded: health.model_loaded,
				modelVersion: health.model_version,
				featureCount: health.feature_count,
				uptimeSeconds: health.uptime_seconds,
			};
		} catch (error) {
			return null;
		}
	}

	/**
	 * Get human-readable prediction label
	 */
	private getPredictionLabel(prediction: number): string {
		switch (prediction) {
			case 0:
				return "HOLD";
			case 1:
				return "BUY";
			case 2:
				return "SELL";
			default:
				return "UNKNOWN";
		}
	}

	/**
	 * Get singleton instance
	 */
	private static instance: MLClient | null = null;

	static getInstance(): MLClient {
		if (!MLClient.instance) {
			MLClient.instance = new MLClient();
		}
		return MLClient.instance;
	}
}

// Export singleton instance
export const mlClient = MLClient.getInstance();

// Export helper functions
export async function getMlPrediction(
	features: number[],
	symbol: string,
): Promise<MLPrediction | null> {
	return mlClient.getPrediction(features, symbol);
}

export async function checkMlServiceHealth(): Promise<boolean> {
	return mlClient.checkHealth();
}

export async function trainMlModel(
	dataPath?: string,
	minSamples = 10000,
): Promise<MLTrainingResult | null> {
	return mlClient.trainModel(dataPath, minSamples);
}
