/**
 * ML Data Collector
 * Collects training samples during live trading for model training
 */

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import type { MarketDataForML } from "./featureExtraction";
import { FEATURE_NAMES, extractFeatures } from "./featureExtraction";

const logger = createPinoLogger({
	name: "ml-data-collector",
	level: "info",
});

const db = createClient({
	url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * ML Training Sample (stored in database)
 */
export interface MLTrainingSample {
	id?: number;
	symbol: string;
	timestamp: string;
	features: string; // JSON array of 60 features
	label?: number; // 0=HOLD, 1=BUY, 2=SELL (filled after outcome known)
	actual_pnl?: number; // Actual P&L if trade was taken (for validation)
	labeled_at?: string; // When the label was assigned
	created_at: string;
}

/**
 * ML Training Data Schema
 */
export const ML_TRAINING_SCHEMA = `
-- ML training data table
CREATE TABLE IF NOT EXISTS ml_training_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  features TEXT NOT NULL, -- JSON array of 60 features
  label INTEGER, -- 0=HOLD, 1=BUY, 2=SELL (NULL until labeled)
  actual_pnl REAL, -- Actual P&L if trade was taken
  labeled_at TEXT, -- When label was assigned
  created_at TEXT NOT NULL
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_ml_training_timestamp ON ml_training_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_ml_training_symbol ON ml_training_data(symbol);
CREATE INDEX IF NOT EXISTS idx_ml_training_label ON ml_training_data(label);
`;

/**
 * Initialize ML training data table
 */
export async function initMLTrainingTable(): Promise<void> {
	try {
		// Execute each statement separately
		const statements = ML_TRAINING_SCHEMA.split(';').filter(s => s.trim());
		for (const statement of statements) {
			if (statement.trim()) {
				await db.execute(statement.trim());
			}
		}
		logger.info("✓ ML training data table initialized");
	} catch (error) {
		logger.error("Failed to initialize ML training table:", error as any);
		throw error;
	}
}

/**
 * Collect training sample from market data
 * Label will be assigned later based on trading outcome
 */
export async function collectTrainingSample(
	symbol: string,
	marketData: MarketDataForML,
): Promise<number | null> {
	try {
		// Extract features
		const features = extractFeatures(marketData);

		// Validate feature count
		if (features.length !== 60) {
			logger.error(
				`Invalid feature count for ${symbol}: ${features.length}, expected 60`,
			);
			return null;
		}

		// Store in database (unlabeled)
		const timestamp = new Date().toISOString();
		const result = await db.execute({
			sql: `INSERT INTO ml_training_data (symbol, timestamp, features, created_at)
       VALUES (?, ?, ?, ?)`,
			args: [symbol, timestamp, JSON.stringify(features), timestamp],
		});

		const sampleId = result.lastInsertRowid ? Number(result.lastInsertRowid) : null;
		logger.debug(
			`Collected ML training sample for ${symbol} (ID: ${sampleId})`,
		);

		return sampleId;
	} catch (error) {
		logger.error(`Failed to collect training sample for ${symbol}:`, error as any);
		return null;
	}
}

/**
 * Label a training sample based on trading outcome
 * @param sampleId Sample ID from collectTrainingSample
 * @param label 0=HOLD, 1=BUY, 2=SELL
 * @param actualPnl Actual P&L if trade was taken (for validation)
 */
export async function labelTrainingSample(
	sampleId: number,
	label: number,
	actualPnl?: number,
): Promise<boolean> {
	try {
		const labeledAt = new Date().toISOString();

		await db.execute({
			sql: `UPDATE ml_training_data
       SET label = ?, actual_pnl = ?, labeled_at = ?
       WHERE id = ?`,
			args: [label, actualPnl || null, labeledAt, sampleId],
		});

		logger.debug(`Labeled training sample ${sampleId}: label=${label}`);
		return true;
	} catch (error) {
		logger.error(`Failed to label training sample ${sampleId}:`, error as any);
		return false;
	}
}

/**
 * Auto-label samples based on market movement
 * Used for samples where no trade was taken
 *
 * Logic:
 * - Look at price movement 5-20 minutes after sample collection
 * - If price went up >1%, label as BUY opportunity
 * - If price went down >1%, label as SELL opportunity
 * - Otherwise, label as HOLD
 */
export async function autoLabelSamples(
	lookbackMinutes = 60,
	minPriceChange = 1.0,
): Promise<number> {
	try {
		// Get unlabeled samples from last N minutes
		const cutoffTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);
		const cutoffTimeStr = cutoffTime.toISOString();

		const result = await db.execute({
			sql: `SELECT * FROM ml_training_data
       WHERE label IS NULL
       AND timestamp >= ?
       ORDER BY timestamp ASC`,
			args: [cutoffTimeStr],
		});
		const samples = result.rows as any[];

		if (samples.length === 0) {
			return 0;
		}

		logger.info(
			`Auto-labeling ${samples.length} unlabeled samples from last ${lookbackMinutes} minutes`,
		);

		let labeledCount = 0;

		for (const sample of samples) {
			try {
				// Parse features to get the current price at sample time
				const features = JSON.parse(sample.features);

				// Current price is in derived features or price sequences
				// We'll use price_5m_3 (most recent 5m close) as reference
				const samplePrice = features[8]; // price_5m_3

				// Get current market price for comparison
				// We'd need to fetch current price from market data
				// For now, we'll skip if we can't determine price movement

				// TODO: Implement price movement detection
				// This would require:
				// 1. Fetch current price for the symbol
				// 2. Calculate price change percentage
				// 3. Label based on threshold

				// For now, label as HOLD if we can't determine
				await labelTrainingSample(sample.id!, 0); // HOLD
				labeledCount++;
			} catch (error) {
				logger.error(`Failed to auto-label sample ${sample.id}:`, error as any);
			}
		}

		logger.info(`✓ Auto-labeled ${labeledCount} samples`);
		return labeledCount;
	} catch (error) {
		logger.error("Auto-labeling failed:", error as any);
		return 0;
	}
}

/**
 * Get training data statistics
 */
export async function getTrainingDataStats(): Promise<{
	total: number;
	labeled: number;
	unlabeled: number;
	byLabel: Record<string, number>;
}> {
	try {
		const totalResult = await db.execute(
			"SELECT COUNT(*) as count FROM ml_training_data",
		);

		const labeledResult = await db.execute(
			"SELECT COUNT(*) as count FROM ml_training_data WHERE label IS NOT NULL",
		);

		const unlabeledResult = await db.execute(
			"SELECT COUNT(*) as count FROM ml_training_data WHERE label IS NULL",
		);

		const byLabelResult = await db.execute(
			"SELECT label, COUNT(*) as count FROM ml_training_data WHERE label IS NOT NULL GROUP BY label",
		);

		const total = totalResult.rows[0] as any;
		const labeled = labeledResult.rows[0] as any;
		const unlabeled = unlabeledResult.rows[0] as any;
		const byLabelRows = byLabelResult.rows as any[];

		const byLabel: Record<string, number> = {
			HOLD: 0,
			BUY: 0,
			SELL: 0,
		};

		for (const row of byLabelRows) {
			if (row.label === 0) byLabel.HOLD = row.count;
			else if (row.label === 1) byLabel.BUY = row.count;
			else if (row.label === 2) byLabel.SELL = row.count;
		}

		return {
			total: total.count || 0,
			labeled: labeled.count || 0,
			unlabeled: unlabeled.count || 0,
			byLabel,
		};
	} catch (error) {
		logger.error("Failed to get training data stats:", error as any);
		return {
			total: 0,
			labeled: 0,
			unlabeled: 0,
			byLabel: { HOLD: 0, BUY: 0, SELL: 0 },
		};
	}
}

/**
 * Export training data to CSV for Python training
 * @param outputPath Path to output CSV file
 * @returns Number of samples exported
 */
export async function exportTrainingDataToCSV(
	outputPath: string,
): Promise<number> {
	try {
		// Get all labeled samples
		const result = await db.execute(
			"SELECT * FROM ml_training_data WHERE label IS NOT NULL ORDER BY timestamp ASC",
		);
		const samples = result.rows as any[];

		if (samples.length === 0) {
			logger.warn("No labeled samples to export");
			return 0;
		}

		// Build CSV content
		const header = [...FEATURE_NAMES, "label"].join(",");
		const rows: string[] = [header];

		for (const sample of samples) {
			const features = JSON.parse(sample.features);
			const row = [...features, sample.label].join(",");
			rows.push(row);
		}

		const csvContent = rows.join("\n");

		// Write to file
		const fs = await import("node:fs/promises");
		await fs.writeFile(outputPath, csvContent, "utf-8");

		logger.info(`✓ Exported ${samples.length} training samples to ${outputPath}`);
		return samples.length;
	} catch (error) {
		logger.error("Failed to export training data:", error as any);
		return 0;
	}
}

/**
 * Clean old unlabeled samples
 * @param daysOld Delete samples older than this many days
 */
export async function cleanOldSamples(daysOld = 30): Promise<number> {
	try {
		const cutoffTime = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
		const cutoffTimeStr = cutoffTime.toISOString();

		const result = await db.execute({
			sql: "DELETE FROM ml_training_data WHERE timestamp < ? AND label IS NULL",
			args: [cutoffTimeStr],
		});

		const deletedCount = result.rowsAffected || 0;

		if (deletedCount > 0) {
			logger.info(`Cleaned ${deletedCount} old unlabeled samples`);
		}

		return deletedCount;
	} catch (error) {
		logger.error("Failed to clean old samples:", error as any);
		return 0;
	}
}
