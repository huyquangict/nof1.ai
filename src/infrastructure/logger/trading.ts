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
 * Trading Logger
 *
 * Specialized logger for trading operations with domain-specific methods.
 */

import { BaseLogger, type LoggerOptions } from './base';
import {
  TradingOperation,
  type PositionLogContext,
  type OrderLogContext,
  type RiskLogContext,
  type AccountLogContext,
  type ExchangeApiLogContext,
  type LogContext,
} from '../../types/logging';

/**
 * Trading-specific logger with structured methods for common operations
 */
export class TradingLogger extends BaseLogger {
  constructor(options: Omit<LoggerOptions, 'name'> & { name?: string }) {
    super({
      ...options,
      name: options.name ?? 'trading',
    });
  }

  // =============================================================================
  // Position Operations
  // =============================================================================

  /**
   * Log position opened
   */
  positionOpened(context: PositionLogContext): void {
    this.info(`Position opened: ${context.side.toUpperCase()} ${context.symbol}`, {
      ...context,
      operation: TradingOperation.POSITION_OPEN,
    });
  }

  /**
   * Log position closed
   */
  positionClosed(context: PositionLogContext & { reason?: string }): void {
    const pnlEmoji = (context.pnlPercent ?? 0) >= 0 ? '📈' : '📉';
    this.info(
      `${pnlEmoji} Position closed: ${context.symbol} | PnL: ${context.pnlPercent?.toFixed(2)}%${context.reason ? ` | ${context.reason}` : ''}`,
      {
        ...context,
        operation: TradingOperation.POSITION_CLOSE,
      }
    );
  }

  /**
   * Log position updated
   */
  positionUpdated(context: PositionLogContext & { updateType?: string }): void {
    this.debug(`Position updated: ${context.symbol} ${context.updateType ?? ''}`, {
      ...context,
      operation: TradingOperation.POSITION_UPDATE,
    });
  }

  // =============================================================================
  // Order Operations
  // =============================================================================

  /**
   * Log order placed
   */
  orderPlaced(context: OrderLogContext): void {
    this.info(`Order placed: ${context.orderType ?? 'market'} ${context.side.toUpperCase()} ${context.symbol}`, {
      ...context,
      operation: TradingOperation.ORDER_PLACE,
    });
  }

  /**
   * Log order cancelled
   */
  orderCancelled(context: OrderLogContext & { reason?: string }): void {
    this.info(`Order cancelled: ${context.orderId} | ${context.reason ?? 'manual'}`, {
      ...context,
      operation: TradingOperation.ORDER_CANCEL,
    });
  }

  /**
   * Log order updated
   */
  orderUpdated(context: OrderLogContext): void {
    this.debug(`Order updated: ${context.orderId} | Status: ${context.status ?? 'unknown'}`, {
      ...context,
      operation: TradingOperation.ORDER_UPDATE,
    });
  }

  // =============================================================================
  // Risk Management
  // =============================================================================

  /**
   * Log stop-loss set
   */
  stopLossSet(context: PositionLogContext & { stopLossPrice?: number }): void {
    this.info(`Stop-loss set: ${context.symbol} @ ${context.stopLossPrice ?? 'calculated'}`, {
      ...context,
      operation: TradingOperation.STOP_LOSS_SET,
    });
  }

  /**
   * Log stop-loss triggered
   */
  stopLossTriggered(context: PositionLogContext): void {
    this.warn(`⚠️  Stop-loss triggered: ${context.symbol} | PnL: ${context.pnlPercent?.toFixed(2)}%`, {
      ...context,
      operation: TradingOperation.STOP_LOSS_TRIGGER,
    });
  }

  /**
   * Log take-profit set
   */
  takeProfitSet(context: PositionLogContext & { takeProfitPrice?: number; level?: number }): void {
    this.info(
      `Take-profit set: ${context.symbol} @ ${context.takeProfitPrice ?? 'calculated'}${context.level ? ` (TP${context.level})` : ''}`,
      {
        ...context,
        operation: TradingOperation.TAKE_PROFIT_SET,
      }
    );
  }

  /**
   * Log take-profit triggered
   */
  takeProfitTriggered(context: PositionLogContext & { level?: number }): void {
    this.info(
      `✅ Take-profit triggered: ${context.symbol}${context.level ? ` (TP${context.level})` : ''} | PnL: ${context.pnlPercent?.toFixed(2)}%`,
      {
        ...context,
        operation: TradingOperation.TAKE_PROFIT_TRIGGER,
      }
    );
  }

  /**
   * Log take-profit adjusted
   */
  takeProfitAdjusted(context: PositionLogContext & { oldPrice?: number; newPrice?: number }): void {
    this.info(`Take-profit adjusted: ${context.symbol} | ${context.oldPrice} → ${context.newPrice}`, {
      ...context,
      operation: TradingOperation.TAKE_PROFIT_ADJUST,
    });
  }

  /**
   * Log risk check
   */
  riskCheck(context: RiskLogContext): void {
    const emoji = context.passed ? '✅' : '❌';
    const level = context.passed ? 'debug' : 'warn';

    this.log(
      level,
      `${emoji} Risk check: ${context.checkType} | ${context.passed ? 'PASSED' : 'FAILED'}${context.reason ? ` | ${context.reason}` : ''}`,
      {
        ...context,
        operation: TradingOperation.RISK_CHECK,
      }
    );
  }

  // =============================================================================
  // Account Operations
  // =============================================================================

  /**
   * Log account balance update
   */
  balanceUpdate(context: AccountLogContext): void {
    this.info(`Balance: ${context.balance.toFixed(2)} USDT | Equity: ${context.equity?.toFixed(2) ?? 'N/A'} USDT`, {
      ...context,
      operation: TradingOperation.BALANCE_UPDATE,
    });
  }

  /**
   * Log account snapshot
   */
  accountSnapshot(context: AccountLogContext): void {
    this.debug('Account snapshot', {
      ...context,
      operation: TradingOperation.BALANCE_UPDATE,
    });
  }

  // =============================================================================
  // Market Data Operations
  // =============================================================================

  /**
   * Log market data fetch
   */
  marketDataFetched(context: LogContext & { dataType: string; symbolCount?: number }): void {
    this.debug(`Market data fetched: ${context.dataType}${context.symbolCount ? ` (${context.symbolCount} symbols)` : ''}`, {
      ...context,
      operation: TradingOperation.MARKET_DATA_FETCH,
    });
  }

  // =============================================================================
  // Exchange API Operations
  // =============================================================================

  /**
   * Log exchange API call
   */
  exchangeApiCall(context: ExchangeApiLogContext): void {
    const statusEmoji = context.statusCode && context.statusCode < 400 ? '✅' : '❌';
    this.debug(
      `${statusEmoji} API call: ${context.method} ${context.endpoint} | ${context.statusCode ?? 'N/A'} | ${context.durationMs ?? 0}ms`,
      {
        ...context,
        operation: TradingOperation.EXCHANGE_API_CALL,
      }
    );
  }

  /**
   * Log exchange API error
   */
  exchangeApiError(context: ExchangeApiLogContext & { error: string }): void {
    this.error(`API error: ${context.method} ${context.endpoint} | ${context.error}`, {
      ...context,
      operation: TradingOperation.EXCHANGE_API_CALL,
    });
  }

  // =============================================================================
  // System Operations
  // =============================================================================

  /**
   * Log system startup
   */
  systemStartup(context?: LogContext): void {
    this.info('🚀 Trading system starting...', {
      ...context,
      operation: TradingOperation.SYSTEM_STARTUP,
    });
  }

  /**
   * Log system shutdown
   */
  systemShutdown(context?: LogContext & { reason?: string }): void {
    this.info(`🛑 Trading system shutting down${context?.reason ? `: ${context.reason}` : ''}`, {
      ...context,
      operation: TradingOperation.SYSTEM_SHUTDOWN,
    });
  }

  /**
   * Log trading cycle start
   */
  tradingCycleStart(context?: LogContext & { cycleNumber?: number }): void {
    this.info(`📊 Trading cycle ${context?.cycleNumber ? `#${context.cycleNumber}` : 'started'}`, {
      ...context,
      operation: TradingOperation.TRADING_CYCLE,
    });
  }

  /**
   * Log trading cycle complete
   */
  tradingCycleComplete(context?: LogContext & { cycleNumber?: number; durationMs?: number }): void {
    this.info(
      `✅ Trading cycle ${context?.cycleNumber ? `#${context.cycleNumber}` : ''} complete${context?.durationMs ? ` (${context.durationMs}ms)` : ''}`,
      {
        ...context,
        operation: TradingOperation.TRADING_CYCLE,
      }
    );
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  /**
   * Create a position-scoped child logger
   */
  forPosition(symbol: string, side: 'long' | 'short'): TradingLogger {
    const childLogger = this.child({ symbol, side });
    // Convert BaseLogger to TradingLogger
    return Object.setPrototypeOf(childLogger, TradingLogger.prototype);
  }

  /**
   * Create a symbol-scoped child logger
   */
  forSymbol(symbol: string): TradingLogger {
    const childLogger = this.child({ symbol });
    return Object.setPrototypeOf(childLogger, TradingLogger.prototype);
  }
}
