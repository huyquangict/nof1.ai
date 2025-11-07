/**
 * Update Trading Reflection When Position Closes
 *
 * This function is called immediately when a position closes (for any reason).
 * It updates the reflection with:
 * - Actual PnL from the closed trade
 * - Close reason (manual, stop_loss, take_profit, etc.)
 * - Exact close price
 * - Technical indicators snapshot at close time
 * - Sets reviewed=0 to trigger feedback scheduler review
 */

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "reflection-close-update",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export interface CloseData {
  entryOrderId: string;      // Order ID of the entry trade
  closePrice: number;         // Exact price at close
  pnl: number;                // Actual PnL from the trade
  closeReason: string;        // manual, stop_loss, take_profit, etc.
  symbol: string;             // Trading symbol
}

/**
 * Update reflection when position closes
 *
 * @param closeData - Data from the closed position
 * @returns Success status
 */
export async function updateReflectionOnClose(
  closeData: CloseData
): Promise<{ success: boolean; message: string }> {
  try {
    // Check if learning is enabled
    const learningEnabled = await dbClient.execute({
      sql: "SELECT value FROM system_config WHERE key = 'learning_enabled'",
      args: [],
    });

    if (learningEnabled.rows.length === 0 || learningEnabled.rows[0].value !== '1') {
      logger.debug("AI Learning disabled, skipping reflection update");
      return { success: false, message: "Learning disabled" };
    }

    // Find the reflection for this order (regardless of reviewed status)
    const reflectionResult = await dbClient.execute({
      sql: "SELECT id, symbol FROM trading_reflections WHERE order_id = ? LIMIT 1",
      args: [closeData.entryOrderId],
    });

    if (reflectionResult.rows.length === 0) {
      logger.debug(`No pending reflection found for order ${closeData.entryOrderId}`);
      return { success: false, message: "No reflection found" };
    }

    const reflection = reflectionResult.rows[0] as any;
    const reflectionId = reflection.id;

    // Get latest technical indicators for this symbol at close time
    const indicatorsResult = await dbClient.execute({
      sql: `SELECT ema_20, ema_50, macd, rsi_7, rsi_14, volume, atr_14, funding_rate
            FROM trading_signals
            WHERE symbol = ?
            ORDER BY timestamp DESC
            LIMIT 1`,
      args: [closeData.symbol],
    });

    let closeIndicators: string | null = null;
    if (indicatorsResult.rows.length > 0) {
      const indicators = indicatorsResult.rows[0] as any;
      closeIndicators = JSON.stringify({
        ema_20: indicators.ema_20,
        ema_50: indicators.ema_50,
        macd: indicators.macd,
        rsi_7: indicators.rsi_7,
        rsi_14: indicators.rsi_14,
        volume: indicators.volume,
        atr_14: indicators.atr_14,
        funding_rate: indicators.funding_rate,
      });
    }

    // Update reflection with close data and set reviewed=0 for feedback processing
    await dbClient.execute({
      sql: `UPDATE trading_reflections SET
            close_price = ?,
            pnl_result = ?,
            close_reason = ?,
            close_indicators = ?,
            reviewed = 0
            WHERE id = ?`,
      args: [
        closeData.closePrice,
        closeData.pnl,
        closeData.closeReason,
        closeIndicators,
        reflectionId,
      ],
    });

    logger.info(
      `📊 Reflection #${reflectionId} updated: ${closeData.symbol} closed ` +
      `(${closeData.closeReason}) at $${closeData.closePrice.toFixed(2)}, ` +
      `PnL: ${closeData.pnl >= 0 ? '+' : ''}${closeData.pnl.toFixed(2)} USDT`
    );

    return {
      success: true,
      message: `Reflection updated for ${closeData.symbol}`,
    };

  } catch (error: any) {
    logger.error("Failed to update reflection on close:", error);
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}
