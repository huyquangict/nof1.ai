/**
 * ML Training Scheduler
 * Periodically triggers model retraining and exports training data
 */

import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { trainMlModel } from "../ml/mlClient";
import {
	exportTrainingDataToCSV,
	getTrainingDataStats,
	cleanOldSamples,
} from "../ml/dataCollector";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const logger = createPinoLogger({
	name: "ml-training-scheduler",
	level: "info",
});

// Configuration
const ML_TRAINING_ENABLED =
	process.env.ML_TRAINING_ENABLED === "true";
const ML_TRAINING_SCHEDULE =
	process.env.ML_TRAINING_SCHEDULE || "0 2 * * *"; // Default: 2 AM daily
const ML_MIN_TRAINING_SAMPLES = Number.parseInt(
	process.env.ML_MIN_TRAINING_SAMPLES || "10000",
	10,
);
const ML_DATA_PATH = resolve(
	process.cwd(),
	"src/ml/data/training_data.csv",
);

/**
 * Execute model training
 */
async function executeTraining(): Promise<boolean> {
	try {
		logger.info("=" .repeat(60));
		logger.info("Starting ML Model Training");
		logger.info("=".repeat(60));

		// 1. Get training data statistics
		const stats = await getTrainingDataStats();

		logger.info("Training Data Statistics:");
		logger.info(`  Total samples: ${stats.total}`);
		logger.info(`  Labeled samples: ${stats.labeled}`);
		logger.info(`  Unlabeled samples: ${stats.unlabeled}`);
		logger.info(`  Label distribution:`);
		logger.info(`    HOLD: ${stats.byLabel.HOLD}`);
		logger.info(`    BUY:  ${stats.byLabel.BUY}`);
		logger.info(`    SELL: ${stats.byLabel.SELL}`);

		// 2. Check if we have enough data
		if (stats.labeled < ML_MIN_TRAINING_SAMPLES) {
			logger.warn(
				`Insufficient labeled samples: ${stats.labeled} < ${ML_MIN_TRAINING_SAMPLES}`,
			);
			logger.warn("Training skipped - collect more data first");
			return false;
		}

		// 3. Check label distribution balance
		const minLabelCount = Math.min(
			stats.byLabel.HOLD,
			stats.byLabel.BUY,
			stats.byLabel.SELL,
		);
		const maxLabelCount = Math.max(
			stats.byLabel.HOLD,
			stats.byLabel.BUY,
			stats.byLabel.SELL,
		);

		if (minLabelCount === 0) {
			logger.warn("Label distribution is imbalanced - some classes have 0 samples");
			logger.warn("Training skipped - need samples for all classes (HOLD, BUY, SELL)");
			return false;
		}

		const imbalanceRatio = maxLabelCount / minLabelCount;
		if (imbalanceRatio > 10) {
			logger.warn(
				`Severe label imbalance detected: ${imbalanceRatio.toFixed(1)}:1 ratio`,
			);
			logger.warn("Training may produce biased model");
		}

		// 4. Export training data to CSV
		logger.info(`Exporting training data to ${ML_DATA_PATH}...`);
		const exportedCount = await exportTrainingDataToCSV(ML_DATA_PATH);

		if (exportedCount === 0) {
			logger.error("Failed to export training data");
			return false;
		}

		logger.info(`✓ Exported ${exportedCount} samples to CSV`);

		// 5. Trigger training via ML service
		logger.info("Triggering model training via ML service...");
		const result = await trainMlModel(ML_DATA_PATH, ML_MIN_TRAINING_SAMPLES);

		if (!result) {
			logger.error("Model training failed");
			return false;
		}

		logger.info("=" .repeat(60));
		logger.info("✓ ML Model Training Completed Successfully");
		logger.info("=".repeat(60));

		// 6. Clean old unlabeled samples (keep last 30 days)
		logger.info("Cleaning old unlabeled samples...");
		const cleanedCount = await cleanOldSamples(30);
		if (cleanedCount > 0) {
			logger.info(`✓ Cleaned ${cleanedCount} old samples`);
		}

		return true;
	} catch (error) {
		logger.error("ML training execution failed:", error as any);
		return false;
	}
}

/**
 * Start ML training scheduler
 */
export function startMLTrainingScheduler(): void {
	if (!ML_TRAINING_ENABLED) {
		logger.info("ML training scheduler is disabled (ML_TRAINING_ENABLED=false)");
		return;
	}

	logger.info("Starting ML training scheduler...");
	logger.info(`Schedule: ${ML_TRAINING_SCHEDULE}`);
	logger.info(`Min training samples: ${ML_MIN_TRAINING_SAMPLES}`);

	// Validate cron schedule
	if (!cron.validate(ML_TRAINING_SCHEDULE)) {
		logger.error(`Invalid cron schedule: ${ML_TRAINING_SCHEDULE}`);
		logger.error("ML training scheduler will not start");
		return;
	}

	// Schedule training
	cron.schedule(ML_TRAINING_SCHEDULE, async () => {
		logger.info("ML training scheduler triggered");
		await executeTraining();
	});

	logger.info("✓ ML training scheduler started");

	// Optional: Run training immediately on startup if data exists
	if (process.env.ML_TRAIN_ON_STARTUP === "true") {
		logger.info("ML_TRAIN_ON_STARTUP=true, running training now...");
		setTimeout(async () => {
			await executeTraining();
		}, 10000); // Wait 10 seconds after startup
	}
}

/**
 * Manual training trigger (can be called via API or CLI)
 */
export async function triggerManualTraining(): Promise<boolean> {
	logger.info("Manual training triggered");
	return await executeTraining();
}
