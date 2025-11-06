/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Account Manager Module
 *
 * Manages account information fetching and performance metrics calculation.
 * Provides Sharpe ratio calculation for portfolio performance analysis.
 */

import { Client } from '@libsql/client';
import { IExchangeClient } from '../../../services/exchange/IExchangeClient';
import { createPinoLogger } from '@voltagent/logger';

const logger = createPinoLogger({
  name: 'account-manager',
  level: 'info',
});

/**
 * Account information response
 */
export interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealisedPnl: number;
  returnPercent: number;
  sharpeRatio: number;
}

/**
 * Account Manager
 *
 * Fetches account information and calculates performance metrics
 */
export class AccountManager {
  constructor(
    private exchangeClient: IExchangeClient,
    private database: Client
  ) {}

  /**
   * Get account information
   *
   * Exchange account.total does not include unrealized P&L
   * Total assets (excluding unrealized P&L) = account.total = available + positionMargin
   *
   * Therefore:
   * - totalBalance does not include unrealized P&L
   * - returnPercent reflects realized P&L
   * - unrealizedPnl needs to be added when displaying on the frontend
   */
  async getAccountInfo(): Promise<AccountInfo> {
    try {
      const account = await this.exchangeClient.getFuturesAccount();

      // Get initial balance from database
      const initialResult = await this.database.execute(
        'SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1'
      );
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : 100;

      // Extract fields from exchange API response
      const accountTotal = account.totalBalance;
      const availableBalance = account.availableBalance;
      const unrealisedPnl = account.unrealisedPnl;

      // Exchange's totalBalance does not include unrealized P&L
      const totalBalance = accountTotal;

      // Real-time return rate = (total assets - initial balance) / initial balance * 100
      // Total assets do not include unrealized P&L, return rate reflects realized P&L
      const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;

      // Calculate Sharpe Ratio
      const sharpeRatio = await this.calculateSharpeRatio();

      return {
        totalBalance, // Total assets (excluding unrealized P&L)
        availableBalance, // Available balance
        unrealisedPnl, // Unrealized P&L
        returnPercent, // Return rate (excluding unrealized P&L)
        sharpeRatio, // Sharpe ratio
      };
    } catch (error) {
      logger.error('Failed to get account information:', error as any);
      return {
        totalBalance: 0,
        availableBalance: 0,
        unrealisedPnl: 0,
        returnPercent: 0,
        sharpeRatio: 0,
      };
    }
  }

  /**
   * Calculate Sharpe Ratio
   * Uses all account history data
   *
   * Sharpe Ratio = (average return - risk-free rate) / standard deviation
   * Higher values indicate better risk-adjusted returns
   */
  async calculateSharpeRatio(): Promise<number> {
    try {
      // Fetch all account history data
      const result = await this.database.execute({
        sql: `SELECT total_value, timestamp FROM account_history
              ORDER BY timestamp ASC`,
        args: [],
      });

      if (!result.rows || result.rows.length < 2) {
        return 0; // Insufficient data, return 0
      }

      // Calculate return rate for each trade (not daily)
      const returns: number[] = [];
      for (let i = 1; i < result.rows.length; i++) {
        const prevValue = Number.parseFloat(result.rows[i - 1].total_value as string);
        const currentValue = Number.parseFloat(result.rows[i].total_value as string);

        if (prevValue > 0) {
          const returnRate = (currentValue - prevValue) / prevValue;
          returns.push(returnRate);
        }
      }

      if (returns.length < 2) {
        return 0;
      }

      // Calculate average return rate
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

      // Calculate standard deviation of returns
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) {
        return avgReturn > 0 ? 10 : 0; // No volatility but has gains, return high value
      }

      // Sharpe Ratio = (average return - risk-free rate) / standard deviation
      // Assume risk-free rate is 0
      const sharpeRatio = avgReturn / stdDev;

      return Number.isFinite(sharpeRatio) ? sharpeRatio : 0;
    } catch (error) {
      logger.error('Failed to calculate Sharpe Ratio:', error as any);
      return 0;
    }
  }
}

/**
 * Create an account manager instance
 *
 * @param exchangeClient - Exchange client for fetching account data
 * @param database - Database client for historical data
 * @returns Account manager instance
 */
export function createAccountManager(
  exchangeClient: IExchangeClient,
  database: Client
): AccountManager {
  return new AccountManager(exchangeClient, database);
}
