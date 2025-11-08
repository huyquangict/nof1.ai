/**
 * Risk Checker Module
 * Handles risk threshold checking and emergency actions
 */

import { createPinoLogger } from "@voltagent/logger";
import type { Client } from "@libsql/client";
import type { IExchangeClient } from "../../../services/exchange/IExchangeClient";
import { getQuantoMultiplier } from "../../../utils/contractUtils";
import { calculatePnL } from "../../../utils/pnlCalculator";

const logger = createPinoLogger({
  name: "risk-checker",
  level: "info",
});

export interface RiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
}

export interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealisedPnl: number;
  returnPercent: number;
  sharpeRatio: number;
}

/**
 * Risk checker class - handles all risk management logic
 */
export class RiskChecker {
  constructor(
    private exchangeClient: IExchangeClient,
    private database: Client,
    private config: RiskConfig
  ) {}

  /**
   * Check if account balance triggers stop loss or take profit
   * @returns true if exit condition triggered, false to continue running
   */
  async checkAccountThresholds(accountInfo: AccountInfo): Promise<boolean> {
    const totalBalance = accountInfo.totalBalance;

    // Check stop loss threshold
    if (totalBalance <= this.config.stopLossUsdt) {
      logger.error(
        `Stop loss triggered! Balance: ${totalBalance.toFixed(2)} USDT <= ${this.config.stopLossUsdt} USDT`
      );
      await this.closeAllPositions(
        `Account balance triggered stop loss (${totalBalance.toFixed(2)} USDT)`
      );
      return true;
    }

    // Check take profit threshold
    if (totalBalance >= this.config.takeProfitUsdt) {
      logger.warn(
        `Take profit triggered! Balance: ${totalBalance.toFixed(2)} USDT >= ${this.config.takeProfitUsdt} USDT`
      );
      await this.closeAllPositions(
        `Account balance triggered take profit (${totalBalance.toFixed(2)} USDT)`
      );
      return true;
    }

    return false;
  }

  /**
   * Close all positions (emergency action)
   */
  async closeAllPositions(reason: string): Promise<void> {
    try {
      logger.warn(`Closing all positions, reason: ${reason}`);

      const positions = await this.exchangeClient.getPositions();

      if (positions.length === 0) {
        return;
      }

      for (const pos of positions) {
        const symbol = pos.symbol;
        const quantity = pos.quantity;
        const side = pos.side;

        try {
          // Place opposite order to close the position
          await this.exchangeClient.placeOrder({
            symbol,
            side: side === 'long' ? 'short' : 'long',
            quantity,
            reduceOnly: true,
          });

          logger.info(`Position closed: ${symbol} ${quantity} units`);
        } catch (error) {
          logger.error(`Failed to close position: ${symbol}`, error as any);
        }
      }

      logger.warn(`All positions closed`);
    } catch (error) {
      logger.error("Failed to close all positions:", error as any);
      throw error;
    }
  }

  /**
   * Fix historical P&L records
   * Automatically called at the end of each cycle to ensure correct P&L calculations
   */
  async fixHistoricalPnlRecords(): Promise<void> {
    try {
      // Query recent closing trade records
      const result = await this.database.execute({
        sql: `SELECT * FROM trades WHERE type = 'close' ORDER BY timestamp DESC LIMIT 50`,
        args: [],
      });

      if (!result.rows || result.rows.length === 0) {
        return;
      }

      let fixedCount = 0;

      for (const closeTrade of result.rows) {
        const id = closeTrade.id;
        const symbol = closeTrade.symbol as string;
        const side = closeTrade.side as string;
        const closePrice = Number.parseFloat(closeTrade.price as string);
        const quantity = Number.parseFloat(closeTrade.quantity as string);
        const recordedPnl = Number.parseFloat(closeTrade.pnl as string || "0");
        const recordedFee = Number.parseFloat(closeTrade.fee as string || "0");
        const timestamp = closeTrade.timestamp as string;

        // Find corresponding opening trade record
        const openResult = await this.database.execute({
          sql: `SELECT * FROM trades WHERE symbol = ? AND type = 'open' AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
          args: [symbol, timestamp],
        });

        if (!openResult.rows || openResult.rows.length === 0) {
          continue;
        }

        const openTrade = openResult.rows[0];
        const openPrice = Number.parseFloat(openTrade.price as string);

        // Recalculate correct P&L using centralized calculator
        const leverage = Number.parseFloat(openTrade.leverage as string) || 1;
        const pnlResult = await calculatePnL({
          symbol,
          side: side as 'long' | 'short',
          entryPrice: openPrice,
          exitPrice: closePrice,
          quantity,
          leverage,
        }, undefined, false); // Use maker fee for historical accuracy
        const correctPnl = pnlResult.netPnl;
        const totalFee = pnlResult.totalFees;

        // Calculate difference
        const pnlDiff = Math.abs(recordedPnl - correctPnl);
        const feeDiff = Math.abs(recordedFee - totalFee);

        // If difference exceeds 0.5 USDT, fix it
        if (pnlDiff > 0.5 || feeDiff > 0.1) {
          logger.warn(`Fixing trade record ID=${id} (${symbol} ${side})`);
          logger.warn(
            `  P&L: ${recordedPnl.toFixed(2)} → ${correctPnl.toFixed(2)} USDT (difference: ${pnlDiff.toFixed(2)})`
          );

          // Update database
          await this.database.execute({
            sql: `UPDATE trades SET pnl = ?, fee = ? WHERE id = ?`,
            args: [correctPnl, totalFee, id],
          });

          fixedCount++;
        }
      }

      if (fixedCount > 0) {
        logger.info(`Fixed ${fixedCount} historical P&L records`);
      }
    } catch (error) {
      logger.error("Failed to fix historical P&L records:", error as any);
    }
  }
}

/**
 * Factory function to create risk checker
 */
export function createRiskChecker(
  exchangeClient: IExchangeClient,
  database: Client,
  config: RiskConfig
): RiskChecker {
  return new RiskChecker(exchangeClient, database, config);
}
