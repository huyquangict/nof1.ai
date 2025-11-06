/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Risk Service
 *
 * Business logic for risk management and position validation.
 */

import type { IExchangeClient } from '../../services/exchange/IExchangeClient';
import type { PositionRepository } from '../../infrastructure/database/repositories/position';
import type { AccountRepository } from '../../infrastructure/database/repositories/account';
import type { TradingLogger } from '../../infrastructure/logger';
import type { SystemConfig } from '../../types/config';
import type {
  RiskCheckParams,
  RiskCheckResult,
  PositionRiskMetrics,
  AccountRiskMetrics,
} from '../../types/services';
import type { Position } from '../../database/schema';

/**
 * Risk Service
 *
 * Handles all risk-related calculations and validations including:
 * - Pre-trade risk checks
 * - Position risk assessment
 * - Account risk metrics
 * - Drawdown monitoring
 */
export class RiskService {
  constructor(
    private readonly exchangeClient: IExchangeClient,
    private readonly positionRepo: PositionRepository,
    private readonly accountRepo: AccountRepository,
    private readonly logger: TradingLogger,
    private readonly config: SystemConfig
  ) {}

  /**
   * Perform risk check before opening a position
   */
  async checkRiskBeforeOpen(params: RiskCheckParams): Promise<RiskCheckResult> {
    const { symbol, side, quantity, leverage, entryPrice } = params;
    const reasons: string[] = [];

    try {
      // Get account balance
      const account = await this.exchangeClient.getFuturesAccount();
      const accountBalance = account.totalBalance || 0;

      // Get current positions
      const positions = await this.positionRepo.findAllPositions();
      const positionCount = positions.length;

      // Calculate position size in USDT
      const positionSizeUsd = quantity * entryPrice;

      // Calculate position size as percentage of account
      const positionSizePercent = (positionSizeUsd / accountBalance) * 100;

      // 1. Check maximum positions
      if (positionCount >= this.config.trading.maxPositions) {
        reasons.push(
          `Maximum positions reached (${positionCount}/${this.config.trading.maxPositions})`
        );
      }

      // 2. Check for conflicting position
      const existingPosition = positions.find((p) => p.symbol === symbol);
      if (existingPosition) {
        if (existingPosition.side === side) {
          reasons.push(`Already have a ${side} position for ${symbol}`);
        } else {
          reasons.push(
            `Cannot open ${side} position: opposite ${existingPosition.side} position exists for ${symbol}`
          );
        }
      }

      // 3. Check leverage limit
      if (leverage > this.config.trading.maxLeverage) {
        reasons.push(
          `Leverage ${leverage}x exceeds maximum ${this.config.trading.maxLeverage}x`
        );
      }

      // 4. Check account drawdown
      const accountMetrics = await this.getAccountRiskMetrics();
      const drawdownThreshold = this.config.risk.accountDrawdownNoNewPositionPercent;

      if (accountMetrics.drawdownPercent >= drawdownThreshold) {
        reasons.push(
          `Account drawdown ${accountMetrics.drawdownPercent.toFixed(2)}% exceeds limit ${drawdownThreshold}%`
        );
      }

      // 5. Check insufficient funds
      const requiredMargin = positionSizeUsd / leverage;
      if (requiredMargin > account.availableBalance) {
        reasons.push(
          `Insufficient funds: need ${requiredMargin.toFixed(2)} USDT, have ${account.availableBalance.toFixed(2)} USDT`
        );
      }

      // 6. Check position size limits (strategy-based)
      const maxPositionSizePercent = this.getMaxPositionSizePercent();
      if (positionSizePercent > maxPositionSizePercent) {
        reasons.push(
          `Position size ${positionSizePercent.toFixed(2)}% exceeds limit ${maxPositionSizePercent}%`
        );
      }

      const allowed = reasons.length === 0;

      if (!allowed) {
        this.logger.warn(`Risk check failed for ${symbol}`, {
          symbol,
          side,
          reasons,
        });
      }

      return {
        allowed,
        reasons,
        riskMetrics: {
          positionSizeUsd,
          accountBalance,
          positionSizePercent,
          maxLeverage: this.config.trading.maxLeverage,
          currentPositionCount: positionCount,
          maxPositions: this.config.trading.maxPositions,
          accountDrawdownPercent: accountMetrics.drawdownPercent,
        },
      };
    } catch (error: any) {
      this.logger.error(error, { symbol, side, operation: 'checkRiskBeforeOpen' });
      return {
        allowed: false,
        reasons: [`Risk check error: ${error.message}`],
        riskMetrics: {
          positionSizeUsd: 0,
          accountBalance: 0,
          positionSizePercent: 0,
          maxLeverage: this.config.trading.maxLeverage,
          currentPositionCount: 0,
          maxPositions: this.config.trading.maxPositions,
          accountDrawdownPercent: 0,
        },
      };
    }
  }

  /**
   * Get risk metrics for a specific position
   */
  async getPositionRiskMetrics(symbol: string): Promise<PositionRiskMetrics | null> {
    try {
      const position = await this.positionRepo.findBySymbol(symbol);
      if (!position) {
        return null;
      }

      // Get current price from exchange
      const ticker = await this.exchangeClient.getFuturesTicker(symbol);
      const currentPrice = ticker?.lastPrice || position.current_price;

      // Calculate PnL
      const priceChange = position.side === 'long'
        ? currentPrice - position.entry_price
        : position.entry_price - currentPrice;

      const unrealizedPnl = (priceChange / position.entry_price) * position.leverage * position.quantity * position.entry_price;
      const unrealizedPnlPercent = (priceChange / position.entry_price) * position.leverage * 100;

      // Calculate holding time
      const openedAt = new Date(position.opened_at).getTime();
      const now = Date.now();
      const holdingTimeHours = (now - openedAt) / (1000 * 60 * 60);

      // Determine risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
      let shouldClose = false;
      let closeReason: string | undefined;

      // Check 36-hour limit
      const maxHoldingHours = 36;
      if (holdingTimeHours >= maxHoldingHours) {
        riskLevel = 'critical';
        shouldClose = true;
        closeReason = `Exceeded ${maxHoldingHours}-hour holding limit`;
      }

      // Check stop-loss
      const slThreshold = this.config.risk.positionStopLossPnlPercent;
      if (unrealizedPnlPercent <= slThreshold) {
        riskLevel = 'critical';
        shouldClose = true;
        closeReason = `Stop-loss triggered at ${unrealizedPnlPercent.toFixed(2)}%`;
      }

      // Check peak drawdown (configurable via env)
      // Only activate after significant profit to avoid premature closures
      const peakPnl = position.peak_pnl_percent || 0;
      const minPeakForProtection = this.config.risk.peakDrawdownMinPeakPercent;
      const drawdownThreshold = this.config.risk.peakDrawdownThresholdPercent;

      if (peakPnl >= minPeakForProtection) {
        const drawdownFromPeak = peakPnl - unrealizedPnlPercent;
        const drawdownPercent = (drawdownFromPeak / peakPnl) * 100;

        if (drawdownPercent >= drawdownThreshold) {
          riskLevel = 'critical';
          shouldClose = true;
          closeReason = `Peak drawdown ${drawdownPercent.toFixed(2)}% from ${peakPnl.toFixed(2)}% peak exceeds ${drawdownThreshold}% limit`;
        }
      }

      // Check trailing stop levels
      if (unrealizedPnlPercent >= 25) {
        riskLevel = 'medium';
      } else if (unrealizedPnlPercent >= 15) {
        riskLevel = 'low';
      } else if (unrealizedPnlPercent >= 8) {
        riskLevel = 'low';
      } else if (unrealizedPnlPercent < 0) {
        riskLevel = 'medium';
      }

      return {
        symbol,
        unrealizedPnl,
        unrealizedPnlPercent,
        peakPnlPercent: peakPnl,
        currentPrice,
        entryPrice: position.entry_price,
        stopLossPrice: position.stop_loss || undefined,
        takeProfitPrice: position.profit_target || undefined,
        holdingTimeHours,
        riskLevel,
        shouldClose,
        closeReason,
      };
    } catch (error: any) {
      this.logger.error(error, { symbol, operation: 'getPositionRiskMetrics' });
      return null;
    }
  }

  /**
   * Get account-level risk metrics
   */
  async getAccountRiskMetrics(): Promise<AccountRiskMetrics> {
    try {
      // Get account balance
      const account = await this.exchangeClient.getFuturesAccount();
      const totalValue = account.totalBalance || 0;
      const availableCash = account.availableBalance || 0;

      // Get positions
      const positions = await this.positionRepo.findAllPositions();

      // Calculate unrealized PnL
      let unrealizedPnl = 0;
      for (const position of positions) {
        unrealizedPnl += position.unrealized_pnl || 0;
      }

      // Get latest account snapshot for realized PnL
      const latestSnapshot = await this.accountRepo.findLatest();
      const initialBalance = this.config.trading.initialBalance || 2000;
      const realizedPnl = (latestSnapshot?.total_value || totalValue) - initialBalance;

      // Calculate return percentage
      const returnPercent = ((totalValue - initialBalance) / initialBalance) * 100;

      // Calculate drawdown
      const peakValue = Math.max(totalValue, latestSnapshot?.total_value || initialBalance);
      const drawdownPercent = ((peakValue - totalValue) / peakValue) * 100;

      // Calculate leverage utilization
      const usedMargin = positions.reduce((sum, p) => {
        const positionValue = p.quantity * p.entry_price;
        const margin = positionValue / p.leverage;
        return sum + margin;
      }, 0);

      const leverageUtilization = totalValue > 0 ? (usedMargin / totalValue) * 100 : 0;

      // Determine risk level and warnings
      const warnings: string[] = [];
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

      // Check drawdown thresholds
      const warningThreshold = this.config.risk.accountDrawdownWarningPercent;
      const criticalThreshold = this.config.risk.accountDrawdownForceClosePercent;

      if (drawdownPercent >= criticalThreshold) {
        riskLevel = 'critical';
        warnings.push(`CRITICAL: Account drawdown ${drawdownPercent.toFixed(2)}% - forced liquidation required`);
      } else if (drawdownPercent >= this.config.risk.accountDrawdownNoNewPositionPercent) {
        riskLevel = 'high';
        warnings.push(`High drawdown ${drawdownPercent.toFixed(2)}% - no new positions allowed`);
      } else if (drawdownPercent >= warningThreshold) {
        riskLevel = 'medium';
        warnings.push(`Drawdown warning: ${drawdownPercent.toFixed(2)}%`);
      }

      // Check leverage utilization
      if (leverageUtilization > 80) {
        if (riskLevel === 'low') riskLevel = 'medium';
        warnings.push(`High leverage utilization: ${leverageUtilization.toFixed(2)}%`);
      }

      // Check stop-loss threshold
      const stopLossThreshold = this.config.risk.accountStopLossUsdt;
      if (stopLossThreshold > 0 && realizedPnl <= -stopLossThreshold) {
        riskLevel = 'critical';
        warnings.push(`Account stop-loss triggered: ${realizedPnl.toFixed(2)} USDT`);
      }

      return {
        totalValue,
        availableCash,
        unrealizedPnl,
        realizedPnl,
        returnPercent,
        drawdownPercent,
        positionCount: positions.length,
        leverageUtilization,
        riskLevel,
        warnings,
      };
    } catch (error: any) {
      this.logger.error(error, { operation: 'getAccountRiskMetrics' });
      return {
        totalValue: 0,
        availableCash: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        returnPercent: 0,
        drawdownPercent: 0,
        positionCount: 0,
        leverageUtilization: 0,
        riskLevel: 'critical',
        warnings: [`Error calculating risk metrics: ${error.message}`],
      };
    }
  }

  /**
   * Check all positions for risk violations
   */
  async checkAllPositions(): Promise<Array<{ symbol: string; shouldClose: boolean; reason?: string }>> {
    try {
      const positions = await this.positionRepo.findAllPositions();
      const results: Array<{ symbol: string; shouldClose: boolean; reason?: string }> = [];

      for (const position of positions) {
        const metrics = await this.getPositionRiskMetrics(position.symbol);
        if (metrics) {
          results.push({
            symbol: position.symbol,
            shouldClose: metrics.shouldClose,
            reason: metrics.closeReason,
          });
        }
      }

      return results;
    } catch (error: any) {
      this.logger.error(error, { operation: 'checkAllPositions' });
      return [];
    }
  }

  /**
   * Get maximum position size percentage based on strategy
   */
  private getMaxPositionSizePercent(): number {
    const strategy = this.config.trading.strategy;
    const maxLeverage = this.config.trading.maxLeverage;

    // Strategy-based position sizing
    switch (strategy) {
      case 'conservative':
        return 15 + (maxLeverage / 15) * 7; // 15-22%
      case 'balanced':
        return 20 + (maxLeverage / 15) * 7; // 20-27%
      case 'aggressive':
        return 25 + (maxLeverage / 15) * 7; // 25-32%
      default:
        return 20; // Default 20%
    }
  }
}
