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
 * Trading-Specific Errors
 *
 * This module defines errors related to trading operations.
 */

import { AppError, ErrorSeverity, type ErrorContext } from './base';

/**
 * Insufficient funds error
 *
 * Thrown when account doesn't have enough balance for an operation
 */
export class InsufficientFundsError extends AppError {
  constructor(
    required: number,
    available: number,
    currency: string = 'USDT'
  ) {
    super(
      `Insufficient funds: required ${required} ${currency}, available ${available} ${currency}`,
      'INSUFFICIENT_FUNDS',
      {
        context: { required, available, currency, deficit: required - available },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    return 'Insufficient funds for this operation';
  }
}

/**
 * Invalid position error
 *
 * Thrown when a position operation is invalid (e.g., opening conflicting positions)
 */
export class InvalidPositionError extends AppError {
  constructor(
    symbol: string,
    reason: string,
    context?: ErrorContext
  ) {
    super(
      `Invalid position for ${symbol}: ${reason}`,
      'INVALID_POSITION',
      {
        context: { symbol, reason, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Position not found error
 *
 * Thrown when trying to access a non-existent position
 */
export class PositionNotFoundError extends AppError {
  constructor(symbol: string, context?: ErrorContext) {
    super(
      `Position not found for symbol: ${symbol}`,
      'POSITION_NOT_FOUND',
      {
        context: { symbol, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Order not found error
 *
 * Thrown when trying to access a non-existent order
 */
export class OrderNotFoundError extends AppError {
  constructor(
    orderId: string,
    symbol?: string,
    context?: ErrorContext
  ) {
    super(
      `Order not found: ${orderId}${symbol ? ` for symbol ${symbol}` : ''}`,
      'ORDER_NOT_FOUND',
      {
        context: { orderId, symbol, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Invalid leverage error
 *
 * Thrown when leverage is outside acceptable range
 */
export class InvalidLeverageError extends AppError {
  constructor(
    leverage: number,
    minLeverage: number,
    maxLeverage: number,
    symbol?: string
  ) {
    super(
      `Invalid leverage ${leverage}x for ${symbol ?? 'symbol'}. Must be between ${minLeverage}x and ${maxLeverage}x`,
      'INVALID_LEVERAGE',
      {
        context: { leverage, minLeverage, maxLeverage, symbol },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Invalid quantity error
 *
 * Thrown when order quantity is invalid (too small, too large, wrong precision)
 */
export class InvalidQuantityError extends AppError {
  constructor(
    quantity: number,
    reason: string,
    context?: ErrorContext
  ) {
    super(
      `Invalid quantity ${quantity}: ${reason}`,
      'INVALID_QUANTITY',
      {
        context: { quantity, reason, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Invalid price error
 *
 * Thrown when price is invalid (negative, zero, NaN, etc.)
 */
export class InvalidPriceError extends AppError {
  constructor(
    price: number | string,
    symbol?: string,
    context?: ErrorContext
  ) {
    super(
      `Invalid price: ${price}${symbol ? ` for ${symbol}` : ''}`,
      'INVALID_PRICE',
      {
        context: { price, symbol, ...context },
        severity: ErrorSeverity.ERROR,
        isOperational: true,
      }
    );
  }
}

/**
 * Risk limit exceeded error
 *
 * Thrown when an operation would exceed risk management limits
 */
export class RiskLimitExceededError extends AppError {
  constructor(
    limitType: string,
    currentValue: number,
    maxValue: number,
    context?: ErrorContext
  ) {
    super(
      `Risk limit exceeded: ${limitType} is ${currentValue}, max allowed is ${maxValue}`,
      'RISK_LIMIT_EXCEEDED',
      {
        context: { limitType, currentValue, maxValue, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    const limitType = (this.context?.limitType as string) ?? 'unknown';
    return `Risk management limit exceeded: ${limitType}`;
  }
}

/**
 * Max positions exceeded error
 *
 * Thrown when trying to open a position when max positions limit is reached
 */
export class MaxPositionsExceededError extends AppError {
  constructor(
    currentPositions: number,
    maxPositions: number
  ) {
    super(
      `Cannot open new position: already at max limit (${currentPositions}/${maxPositions})`,
      'MAX_POSITIONS_EXCEEDED',
      {
        context: { currentPositions, maxPositions },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    return 'Maximum number of positions reached';
  }
}

/**
 * Position conflict error
 *
 * Thrown when trying to open a position that conflicts with an existing one
 */
export class PositionConflictError extends AppError {
  constructor(
    symbol: string,
    existingSide: 'long' | 'short',
    requestedSide: 'long' | 'short'
  ) {
    super(
      `Cannot open ${requestedSide} position on ${symbol}: existing ${existingSide} position must be closed first`,
      'POSITION_CONFLICT',
      {
        context: { symbol, existingSide, requestedSide },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    const symbol = this.context?.symbol as string;
    const existingSide = this.context?.existingSide as string;
    return `Conflicting position on ${symbol}: close existing ${existingSide} position first`;
  }
}

/**
 * Drawdown limit exceeded error
 *
 * Thrown when account drawdown exceeds allowed threshold
 */
export class DrawdownLimitExceededError extends AppError {
  constructor(
    currentDrawdown: number,
    maxDrawdown: number,
    action: 'warning' | 'no_new_positions' | 'force_close'
  ) {
    super(
      `Account drawdown ${currentDrawdown.toFixed(2)}% exceeds ${action} threshold ${maxDrawdown}%`,
      'DRAWDOWN_LIMIT_EXCEEDED',
      {
        context: { currentDrawdown, maxDrawdown, action },
        severity: action === 'force_close' ? ErrorSeverity.CRITICAL : ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    const action = this.context?.action as string;
    const drawdown = this.context?.currentDrawdown as number;

    switch (action) {
      case 'warning':
        return `Warning: Account drawdown at ${drawdown.toFixed(2)}%`;
      case 'no_new_positions':
        return `Drawdown limit reached: No new positions allowed`;
      case 'force_close':
        return `Critical drawdown: Forcing closure of all positions`;
      default:
        return 'Drawdown limit exceeded';
    }
  }
}

/**
 * Stop-loss triggered error
 *
 * Thrown when a position hits its stop-loss level
 */
export class StopLossTriggeredError extends AppError {
  constructor(
    symbol: string,
    pnlPercent: number,
    stopLossPercent: number,
    context?: ErrorContext
  ) {
    super(
      `Stop-loss triggered for ${symbol}: PnL ${pnlPercent.toFixed(2)}% <= ${stopLossPercent.toFixed(2)}%`,
      'STOP_LOSS_TRIGGERED',
      {
        context: { symbol, pnlPercent, stopLossPercent, ...context },
        severity: ErrorSeverity.INFO,
        isOperational: true,
      }
    );
  }

  override getUserMessage(): string {
    const symbol = this.context?.symbol as string;
    return `Stop-loss triggered for ${symbol}`;
  }
}

/**
 * Market data unavailable error
 *
 * Thrown when required market data cannot be obtained
 */
export class MarketDataUnavailableError extends AppError {
  constructor(
    symbol: string,
    dataType: string,
    context?: ErrorContext
  ) {
    super(
      `Market data unavailable for ${symbol}: ${dataType}`,
      'MARKET_DATA_UNAVAILABLE',
      {
        context: { symbol, dataType, ...context },
        severity: ErrorSeverity.ERROR,
        isOperational: true,
      }
    );
  }
}

/**
 * Symbol not supported error
 *
 * Thrown when trying to trade a symbol that's not configured
 */
export class SymbolNotSupportedError extends AppError {
  constructor(
    symbol: string,
    supportedSymbols: string[]
  ) {
    super(
      `Symbol ${symbol} is not supported. Supported symbols: ${supportedSymbols.join(', ')}`,
      'SYMBOL_NOT_SUPPORTED',
      {
        context: { symbol, supportedSymbols },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Order execution failed error
 *
 * Thrown when an order fails to execute on the exchange
 */
export class OrderExecutionError extends AppError {
  constructor(
    symbol: string,
    side: 'long' | 'short',
    reason: string,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(
      `Order execution failed for ${symbol} ${side}: ${reason}`,
      'ORDER_EXECUTION_FAILED',
      {
        context: { symbol, side, reason, ...context },
        severity: ErrorSeverity.ERROR,
        isOperational: true,
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    return 'Failed to execute order on exchange';
  }
}
