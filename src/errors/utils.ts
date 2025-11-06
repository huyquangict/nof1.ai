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
 * Error Utilities
 *
 * This module provides helper functions for error handling.
 */

import { AppError, InternalError, ErrorSeverity } from './base';

/**
 * Check if an error is an operational error
 *
 * Operational errors are expected errors that can occur during normal operation
 * (e.g., network errors, validation errors, not found errors).
 *
 * Programming errors are bugs that should be fixed in the code
 * (e.g., null pointer exceptions, type errors).
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  // Non-AppError errors are assumed to be programming errors
  return false;
}

/**
 * Check if an error is critical and requires immediate attention
 */
export function isCriticalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.FATAL;
  }
  return false;
}

/**
 * Wrap an unknown error in an AppError
 *
 * Useful when catching errors from external libraries or unknown sources
 */
export function wrapError(
  error: unknown,
  message?: string,
  context?: Record<string, unknown>
): AppError {
  // Already an AppError, return as-is
  if (error instanceof AppError) {
    return error;
  }

  // Standard Error object
  if (error instanceof Error) {
    return new InternalError(
      message ?? error.message,
      context,
      error
    );
  }

  // Unknown error type (string, object, etc.)
  return new InternalError(
    message ?? 'An unknown error occurred',
    {
      ...context,
      originalError: error,
    }
  );
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'Unknown error';
}

/**
 * Format error for logging
 *
 * Returns a structured object suitable for JSON logging
 */
export function formatErrorForLogging(error: Error): Record<string, unknown> {
  if (error instanceof AppError) {
    return error.toJSON();
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Extract user-friendly message from error
 *
 * Returns a message safe to display to users (without sensitive details)
 */
export function getUserFriendlyMessage(error: Error): string {
  if (error instanceof AppError) {
    return error.getUserMessage();
  }

  // For non-AppError errors, return a generic message
  return 'An unexpected error occurred. Please try again later.';
}

/**
 * Extract detailed message from error for debugging
 *
 * Returns a detailed message with context (for internal logs only)
 */
export function getDetailedMessage(error: Error): string {
  if (error instanceof AppError) {
    return error.getDetailedMessage();
  }

  return `${error.name}: ${error.message}`;
}

/**
 * Check if error should trigger system shutdown
 */
export function shouldShutdown(error: Error): boolean {
  if (error instanceof AppError) {
    return error.severity === ErrorSeverity.FATAL;
  }
  return false;
}

/**
 * Check if error should be retried
 *
 * Network errors, rate limits, and timeouts are typically retryable
 */
export function isRetryableError(error: Error): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }

  // Check error codes that are typically retryable
  const retryableCodes = [
    'NETWORK_ERROR',
    'TIMEOUT',
    'RATE_LIMIT_EXCEEDED',
    'EXCHANGE_RATE_LIMIT',
    'EXCHANGE_TIMEOUT',
    'EXCHANGE_NETWORK_ERROR',
    'EXCHANGE_MAINTENANCE',
  ];

  return retryableCodes.includes(error.code);
}

/**
 * Get suggested retry delay in milliseconds
 *
 * Returns a suggested delay based on error type, or undefined if not retryable
 */
export function getRetryDelay(error: Error, attemptNumber: number): number | undefined {
  if (!isRetryableError(error)) {
    return undefined;
  }

  if (error instanceof AppError && error.context?.retryAfterMs) {
    return error.context.retryAfterMs as number;
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 30s)
  const baseDelay = 1000;
  const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), 30000);
  return delay;
}

/**
 * Create an error handler function with custom logic
 *
 * @example
 * ```typescript
 * const handleError = createErrorHandler({
 *   onOperational: (error) => console.error('Operational error:', error.message),
 *   onProgramming: (error) => console.error('Programming error:', error),
 * });
 *
 * try {
 *   // ... code
 * } catch (error) {
 *   handleError(error);
 * }
 * ```
 */
export function createErrorHandler(options: {
  onOperational?: (error: AppError) => void | Promise<void>;
  onProgramming?: (error: Error) => void | Promise<void>;
  onCritical?: (error: AppError) => void | Promise<void>;
  fallback?: (error: unknown) => void | Promise<void>;
}) {
  return async (error: unknown): Promise<void> => {
    const wrappedError = wrapError(error);

    // Critical errors
    if (isCriticalError(wrappedError) && options.onCritical) {
      await options.onCritical(wrappedError);
      return;
    }

    // Operational errors
    if (isOperationalError(wrappedError) && options.onOperational) {
      await options.onOperational(wrappedError);
      return;
    }

    // Programming errors
    if (!isOperationalError(wrappedError) && options.onProgramming) {
      await options.onProgramming(wrappedError);
      return;
    }

    // Fallback handler
    if (options.fallback) {
      await options.fallback(error);
    }
  };
}

/**
 * Async retry wrapper with error handling
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await exchangeClient.getBalance(),
 *   { maxAttempts: 3, baseDelay: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelay ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const wrappedError = wrapError(error);
      lastError = wrappedError;

      // Don't retry if not retryable or last attempt
      if (!isRetryableError(wrappedError) || attempt >= maxAttempts) {
        throw wrappedError;
      }

      // Calculate delay
      const delay = getRetryDelay(wrappedError, attempt) ?? baseDelay * Math.pow(2, attempt - 1);

      // Notify about retry
      if (options.onRetry) {
        options.onRetry(wrappedError, attempt);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new InternalError('Retry failed with no error');
}
