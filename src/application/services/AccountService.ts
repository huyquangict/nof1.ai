/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Account Service
 *
 * Business logic for account management and balance tracking.
 */

import type { IExchangeClient } from '../../services/exchange/IExchangeClient';
import type { AccountRepository } from '../../infrastructure/database/repositories/account';
import type { PositionRepository } from '../../infrastructure/database/repositories/position';
import type { TradingLogger } from '../../infrastructure/logger';
import type { SystemConfig } from '../../types/config';
import type { AccountBalance, AccountSnapshot } from '../../types/services';
import type { AccountHistory } from '../../database/schema';

/**
 * Account Service
 *
 * Handles all account-related operations including:
 * - Balance retrieval
 * - Account snapshots
 * - Performance metrics
 * - Historical tracking
 */
export class AccountService {
  constructor(
    private readonly exchangeClient: IExchangeClient,
    private readonly accountRepo: AccountRepository,
    private readonly positionRepo: PositionRepository,
    private readonly logger: TradingLogger,
    private readonly config: SystemConfig
  ) {}

  /**
   * Get current account balance from exchange
   */
  async getBalance(): Promise<AccountBalance> {
    try {
      const account = await this.exchangeClient.getFuturesAccount();

      // Get unrealized PnL from positions
      const positions = await this.positionRepo.findAllPositions();
      const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

      // Calculate used margin
      const usedMargin = positions.reduce((sum, p) => {
        const positionValue = p.quantity * p.entry_price;
        return sum + positionValue / p.leverage;
      }, 0);

      const totalValue = account.totalBalance || 0;
      const freeMargin = Math.max(0, totalValue - usedMargin);

      this.logger.info('Retrieved account balance', {
        totalValue,
        availableCash: account.availableBalance,
        unrealizedPnl,
        usedMargin,
        freeMargin,
      });

      return {
        totalValue,
        availableCash: account.availableBalance || 0,
        unrealizedPnl,
        usedMargin,
        freeMargin,
      };
    } catch (error: any) {
      this.logger.error('Failed to get account balance', error);
      throw error;
    }
  }

  /**
   * Create an account snapshot
   */
  async createSnapshot(): Promise<AccountHistory> {
    try {
      const balance = await this.getBalance();

      // Get initial balance for return calculation
      const initialBalance = this.config.trading.initialBalance || 2000;

      // Calculate realized PnL (total value minus initial balance minus unrealized PnL)
      const realizedPnl = balance.totalValue - initialBalance - balance.unrealizedPnl;

      // Calculate return percentage
      const returnPercent = ((balance.totalValue - initialBalance) / initialBalance) * 100;

      // Get recent snapshots for Sharpe ratio calculation
      const recentSnapshots = await this.accountRepo.findRecent(30);
      const sharpeRatio = this.calculateSharpeRatio(recentSnapshots, returnPercent);

      const snapshot: Omit<AccountHistory, 'id'> = {
        timestamp: new Date().toISOString(),
        total_value: balance.totalValue,
        available_cash: balance.availableCash,
        unrealized_pnl: balance.unrealizedPnl,
        realized_pnl: realizedPnl,
        return_percent: returnPercent,
        sharpe_ratio: sharpeRatio ?? undefined,
      };

      const created = await this.accountRepo.create(snapshot);

      this.logger.info('Created account snapshot', {
        totalValue: balance.totalValue,
        realizedPnl,
        returnPercent,
      });

      return created;
    } catch (error: any) {
      this.logger.error('Failed to create account snapshot', error);
      throw error;
    }
  }

  /**
   * Get latest account snapshot
   */
  async getLatestSnapshot(): Promise<AccountSnapshot | null> {
    try {
      const snapshot = await this.accountRepo.findLatest();

      if (!snapshot) {
        return null;
      }

      return {
        timestamp: snapshot.timestamp,
        totalValue: snapshot.total_value,
        availableCash: snapshot.available_cash,
        unrealizedPnl: snapshot.unrealized_pnl,
        realizedPnl: snapshot.realized_pnl,
        returnPercent: snapshot.return_percent,
        sharpeRatio: snapshot.sharpe_ratio ?? undefined,
      };
    } catch (error: any) {
      this.logger.error('Failed to get latest snapshot', error);
      return null;
    }
  }

  /**
   * Get recent account snapshots
   */
  async getRecentSnapshots(limit: number = 100): Promise<AccountSnapshot[]> {
    try {
      const snapshots = await this.accountRepo.findRecent(limit);

      return snapshots.map((s) => ({
        timestamp: s.timestamp,
        totalValue: s.total_value,
        availableCash: s.available_cash,
        unrealizedPnl: s.unrealized_pnl,
        realizedPnl: s.realized_pnl,
        returnPercent: s.return_percent,
        sharpeRatio: s.sharpe_ratio ?? undefined,
      }));
    } catch (error: any) {
      this.logger.error('Failed to get recent snapshots', error);
      return [];
    }
  }

  /**
   * Get account performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    totalReturn: number;
    totalReturnPercent: number;
    realizedPnl: number;
    unrealizedPnl: number;
    sharpeRatio: number | null;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
  }> {
    try {
      const balance = await this.getBalance();
      const initialBalance = this.config.trading.initialBalance || 2000;

      const totalReturn = balance.totalValue - initialBalance;
      const totalReturnPercent = (totalReturn / initialBalance) * 100;
      const realizedPnl = totalReturn - balance.unrealizedPnl;

      // Get recent snapshots for metrics calculation
      const snapshots = await this.accountRepo.findRecent(1000);

      // Calculate max drawdown
      const maxDrawdown = this.calculateMaxDrawdown(snapshots);

      // Calculate Sharpe ratio
      const sharpeRatio = this.calculateSharpeRatio(snapshots, totalReturnPercent);

      // Calculate win rate and profit factor from trades
      // (This would require trade repository integration)
      const winRate = 0; // TODO: Implement from trade history
      const profitFactor = 0; // TODO: Implement from trade history

      this.logger.info('Calculated performance metrics', {
        totalReturn,
        totalReturnPercent,
        sharpeRatio,
        maxDrawdown,
      });

      return {
        totalReturn,
        totalReturnPercent,
        realizedPnl,
        unrealizedPnl: balance.unrealizedPnl,
        sharpeRatio,
        maxDrawdown,
        winRate,
        profitFactor,
      };
    } catch (error: any) {
      this.logger.error('Failed to get performance metrics', error);
      throw error;
    }
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(snapshots: AccountHistory[], currentReturnPercent: number): number | null {
    if (snapshots.length < 2) {
      return null;
    }

    // Calculate daily returns
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prevValue = snapshots[i].total_value;
      const currValue = snapshots[i - 1].total_value; // Reverse order (most recent first)
      const dailyReturn = ((currValue - prevValue) / prevValue) * 100;
      returns.push(dailyReturn);
    }

    if (returns.length === 0) {
      return null;
    }

    // Calculate mean and standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe ratio = (mean return - risk-free rate) / std dev
    // Assuming 0% risk-free rate for simplicity
    const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

    // Annualize the Sharpe ratio (assuming daily returns)
    return sharpeRatio * Math.sqrt(365);
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(snapshots: AccountHistory[]): number {
    if (snapshots.length === 0) {
      return 0;
    }

    let maxDrawdown = 0;
    let peak = snapshots[0].total_value;

    // Iterate through snapshots (newest to oldest)
    for (const snapshot of snapshots) {
      if (snapshot.total_value > peak) {
        peak = snapshot.total_value;
      }

      const drawdown = ((peak - snapshot.total_value) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Sync account data from exchange
   */
  async syncFromExchange(): Promise<void> {
    try {
      // Create a new snapshot
      await this.createSnapshot();

      this.logger.info('Synced account data from exchange');
    } catch (error: any) {
      this.logger.error('Failed to sync account from exchange', error);
      throw error;
    }
  }
}
