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
 * Exchange-Specific Errors
 *
 * This module defines errors related to exchange API operations.
 */

import { AppError, NetworkError, ErrorSeverity, type ErrorContext } from './base';

/**
 * Exchange API error
 *
 * Base class for all exchange API-related errors
 */
export class ExchangeApiError extends AppError {
  constructor(
    exchange: string,
    message: string,
    options?: {
      statusCode?: number;
      errorCode?: string;
      context?: ErrorContext;
      originalError?: Error;
    }
  ) {
    super(
      `${exchange} API error: ${message}`,
      options?.errorCode ?? 'EXCHANGE_API_ERROR',
      {
        context: {
          exchange,
          statusCode: options?.statusCode,
          errorCode: options?.errorCode,
          ...options?.context,
        },
        severity: ErrorSeverity.ERROR,
        isOperational: true,
        originalError: options?.originalError,
      }
    );
  }

  override getUserMessage(): string {
    const exchange = this.context?.exchange as string;
    return `Exchange API error (${exchange})`;
  }
}

/**
 * Exchange authentication error
 *
 * Thrown when API credentials are invalid or expired
 */
export class ExchangeAuthError extends AppError {
  constructor(
    exchange: string,
    reason?: string,
    originalError?: Error
  ) {
    super(
      `${exchange} API error: Authentication failed${reason ? `: ${reason}` : ''}`,
      'EXCHANGE_AUTH_ERROR',
      {
        context: { exchange, reason },
        severity: ErrorSeverity.CRITICAL,
        isOperational: true,
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    return 'Exchange authentication failed. Check API keys.';
  }
}

/**
 * Exchange insufficient margin error
 *
 * Thrown when account doesn't have enough margin for a futures operation
 */
export class ExchangeInsufficientMarginError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string,
    required: number,
    available: number
  ) {
    super(
      exchange,
      `Insufficient margin for ${symbol}: required ${required}, available ${available}`,
      {
        errorCode: 'INSUFFICIENT_MARGIN',
        context: { symbol, required, available },
      }
    );
  }

  override getUserMessage(): string {
    return 'Insufficient margin for this operation';
  }
}

/**
 * Exchange minimum notional error
 *
 * Thrown when order value is below exchange minimum requirement
 */
export class ExchangeMinimumNotionalError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string,
    orderValue: number,
    minimumValue: number,
    originalError?: Error
  ) {
    super(
      exchange,
      `Order value ${orderValue} USDT below minimum ${minimumValue} USDT for ${symbol}`,
      {
        errorCode: 'MINIMUM_NOTIONAL_NOT_MET',
        context: { symbol, orderValue, minimumValue },
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    const minValue = this.context?.minimumValue as number;
    return `Order value too small (minimum ~${minValue} USDT required)`;
  }
}

/**
 * Exchange order not found error
 *
 * Thrown when an order doesn't exist on the exchange
 */
export class ExchangeOrderNotFoundError extends ExchangeApiError {
  constructor(
    exchange: string,
    orderId: string,
    symbol?: string
  ) {
    super(
      exchange,
      `Order ${orderId} not found${symbol ? ` for ${symbol}` : ''}`,
      {
        errorCode: 'EXCHANGE_ORDER_NOT_FOUND',
        context: { orderId, symbol },
      }
    );
  }
}

/**
 * Exchange position not found error
 *
 * Thrown when a position doesn't exist on the exchange
 */
export class ExchangePositionNotFoundError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string
  ) {
    super(
      exchange,
      `Position not found for ${symbol}`,
      {
        errorCode: 'EXCHANGE_POSITION_NOT_FOUND',
        context: { symbol },
      }
    );
  }
}

/**
 * Exchange market not found error
 *
 * Thrown when a trading symbol/market doesn't exist on the exchange
 */
export class ExchangeMarketNotFoundError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string
  ) {
    super(
      exchange,
      `Market not found for symbol: ${symbol}`,
      {
        errorCode: 'EXCHANGE_MARKET_NOT_FOUND',
        context: { symbol },
      }
    );
  }

  override getUserMessage(): string {
    const symbol = this.context?.symbol as string;
    return `Symbol ${symbol} is not available on the exchange`;
  }
}

/**
 * Exchange rate limit error
 *
 * Thrown when API rate limit is exceeded
 */
export class ExchangeRateLimitError extends ExchangeApiError {
  constructor(
    exchange: string,
    retryAfterMs?: number,
    originalError?: Error
  ) {
    super(
      exchange,
      `Rate limit exceeded${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ''}`,
      {
        errorCode: 'EXCHANGE_RATE_LIMIT',
        context: { retryAfterMs },
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    return 'Exchange rate limit exceeded. Please wait.';
  }
}

/**
 * Exchange network error
 *
 * Thrown when there's a network issue connecting to the exchange
 */
export class ExchangeNetworkError extends NetworkError {
  constructor(
    exchange: string,
    message: string,
    options?: {
      url?: string;
      statusCode?: number;
      originalError?: Error;
    }
  ) {
    super(
      `${exchange} network error: ${message}`,
      {
        url: options?.url,
        statusCode: options?.statusCode,
        context: { exchange },
        originalError: options?.originalError,
      }
    );
  }

  override getUserMessage(): string {
    return 'Network error connecting to exchange';
  }
}

/**
 * Exchange timeout error
 *
 * Thrown when an exchange API request times out
 */
export class ExchangeTimeoutError extends ExchangeApiError {
  constructor(
    exchange: string,
    operation: string,
    timeoutMs: number
  ) {
    super(
      exchange,
      `${operation} timed out after ${timeoutMs}ms`,
      {
        errorCode: 'EXCHANGE_TIMEOUT',
        context: { operation, timeoutMs },
      }
    );
  }

  override getUserMessage(): string {
    return 'Exchange request timed out';
  }
}

/**
 * Exchange maintenance error
 *
 * Thrown when the exchange is under maintenance
 */
export class ExchangeMaintenanceError extends ExchangeApiError {
  constructor(
    exchange: string,
    estimatedEndTime?: Date
  ) {
    super(
      exchange,
      `Exchange is under maintenance${estimatedEndTime ? `. Expected to resume at ${estimatedEndTime.toISOString()}` : ''}`,
      {
        errorCode: 'EXCHANGE_MAINTENANCE',
        context: { estimatedEndTime: estimatedEndTime?.toISOString() },
      }
    );
  }

  override getUserMessage(): string {
    return 'Exchange is currently under maintenance';
  }
}

/**
 * Exchange invalid response error
 *
 * Thrown when the exchange returns an unexpected or invalid response
 */
export class ExchangeInvalidResponseError extends ExchangeApiError {
  constructor(
    exchange: string,
    reason: string,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(
      exchange,
      `Invalid response from exchange: ${reason}`,
      {
        errorCode: 'EXCHANGE_INVALID_RESPONSE',
        context,
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    return 'Received invalid response from exchange';
  }
}

/**
 * Exchange symbol configuration error
 *
 * Thrown when there's an issue with symbol configuration (precision, limits, etc.)
 */
export class ExchangeSymbolConfigError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string,
    reason: string,
    context?: ErrorContext
  ) {
    super(
      exchange,
      `Symbol configuration error for ${symbol}: ${reason}`,
      {
        errorCode: 'EXCHANGE_SYMBOL_CONFIG_ERROR',
        context: { symbol, reason, ...context },
      }
    );
  }
}

/**
 * Exchange order rejected error
 *
 * Thrown when the exchange rejects an order
 */
export class ExchangeOrderRejectedError extends ExchangeApiError {
  constructor(
    exchange: string,
    symbol: string,
    reason: string,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(
      exchange,
      `Order rejected for ${symbol}: ${reason}`,
      {
        errorCode: 'EXCHANGE_ORDER_REJECTED',
        context: { symbol, reason, ...context },
        originalError,
      }
    );
  }

  override getUserMessage(): string {
    const reason = this.context?.reason as string;
    return `Order rejected: ${reason}`;
  }
}
