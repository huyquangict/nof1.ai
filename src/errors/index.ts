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
 * Centralized Error Handling System
 *
 * This module exports all error classes and utilities for the trading system.
 *
 * @example Basic usage
 * ```typescript
 * import { InsufficientFundsError, wrapError } from './errors';
 *
 * throw new InsufficientFundsError(100, 50);
 * ```
 *
 * @example Error handling
 * ```typescript
 * import { isOperationalError, getUserFriendlyMessage } from './errors';
 *
 * try {
 *   // ... code
 * } catch (error) {
 *   if (isOperationalError(error)) {
 *     console.error(getUserFriendlyMessage(error));
 *   } else {
 *     // Programming error - log and alert
 *     console.error('Programming error:', error);
 *   }
 * }
 * ```
 */

// =============================================================================
// Base Errors
// =============================================================================
export {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  InternalError,
  ErrorSeverity,
  type ErrorContext,
} from './base';

// =============================================================================
// Trading Errors
// =============================================================================
export {
  InsufficientFundsError,
  InvalidPositionError,
  PositionNotFoundError,
  OrderNotFoundError,
  InvalidLeverageError,
  InvalidQuantityError,
  InvalidPriceError,
  RiskLimitExceededError,
  MaxPositionsExceededError,
  PositionConflictError,
  DrawdownLimitExceededError,
  StopLossTriggeredError,
  MarketDataUnavailableError,
  SymbolNotSupportedError,
  OrderExecutionError,
} from './trading';

// =============================================================================
// Exchange Errors
// =============================================================================
export {
  ExchangeApiError,
  ExchangeAuthError,
  ExchangeInsufficientMarginError,
  ExchangeMinimumNotionalError,
  ExchangeOrderNotFoundError,
  ExchangePositionNotFoundError,
  ExchangeMarketNotFoundError,
  ExchangeRateLimitError,
  ExchangeNetworkError,
  ExchangeTimeoutError,
  ExchangeMaintenanceError,
  ExchangeInvalidResponseError,
  ExchangeSymbolConfigError,
  ExchangeOrderRejectedError,
} from './exchange';

// =============================================================================
// Error Utilities
// =============================================================================
export {
  isOperationalError,
  isCriticalError,
  wrapError,
  getErrorMessage,
  formatErrorForLogging,
  getUserFriendlyMessage,
  getDetailedMessage,
  shouldShutdown,
  isRetryableError,
  getRetryDelay,
  createErrorHandler,
  retryWithBackoff,
} from './utils';

// =============================================================================
// Configuration Error (re-export from config module)
// =============================================================================
export { ConfigValidationError } from '../config/validation';
