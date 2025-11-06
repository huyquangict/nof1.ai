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
 * Base Error Classes
 *
 * This module defines the base error hierarchy for the trading system.
 * All custom errors should extend from these base classes.
 */

/**
 * Error context for additional debugging information
 */
export interface ErrorContext {
  [key: string]: unknown;
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Informational - system can continue normally */
  INFO = 'info',
  /** Warning - system can continue but with degraded functionality */
  WARNING = 'warning',
  /** Error - operation failed but system can recover */
  ERROR = 'error',
  /** Critical - operation failed and requires immediate attention */
  CRITICAL = 'critical',
  /** Fatal - system cannot continue and must shut down */
  FATAL = 'fatal',
}

/**
 * Base application error class
 *
 * All custom errors in the system should extend from this class.
 * Provides structured error information with context and error codes.
 */
export class AppError extends Error {
  /**
   * Error code for programmatic error handling
   */
  public readonly code: string;

  /**
   * Additional context information about the error
   */
  public readonly context?: ErrorContext;

  /**
   * Error severity level
   */
  public readonly severity: ErrorSeverity;

  /**
   * Whether this error is operational (expected) or programming error
   */
  public readonly isOperational: boolean;

  /**
   * Timestamp when the error occurred
   */
  public readonly timestamp: Date;

  /**
   * Original error if this wraps another error
   */
  public readonly originalError?: Error;

  constructor(
    message: string,
    code: string,
    options?: {
      context?: ErrorContext;
      severity?: ErrorSeverity;
      isOperational?: boolean;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = options?.context;
    this.severity = options?.severity ?? ErrorSeverity.ERROR;
    this.isOperational = options?.isOperational ?? true;
    this.timestamp = new Date();
    this.originalError = options?.originalError;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      isOperational: this.isOperational,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
            stack: this.originalError.stack,
          }
        : undefined,
    };
  }

  /**
   * Get a user-friendly error message (without sensitive details)
   */
  getUserMessage(): string {
    return this.message;
  }

  /**
   * Get a detailed error message (for logging)
   */
  getDetailedMessage(): string {
    let message = `[${this.code}] ${this.message}`;

    if (this.context) {
      const contextStr = JSON.stringify(this.context);
      message += ` | Context: ${contextStr}`;
    }

    if (this.originalError) {
      message += ` | Original: ${this.originalError.message}`;
    }

    return message;
  }
}

/**
 * Validation error base class
 *
 * Used for input validation errors (invalid parameters, constraints, etc.)
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    options?: {
      field?: string;
      context?: ErrorContext;
    }
  ) {
    super(message, 'VALIDATION_ERROR', {
      context: options?.field ? { field: options.field, ...options?.context } : options?.context,
      severity: ErrorSeverity.WARNING,
      isOperational: true,
    });
  }
}

/**
 * Not found error base class
 *
 * Used when a requested resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    identifier: string | number,
    context?: ErrorContext
  ) {
    super(
      `${resource} not found: ${identifier}`,
      'NOT_FOUND',
      {
        context: { resource, identifier, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Conflict error base class
 *
 * Used when an operation conflicts with current state
 */
export class ConflictError extends AppError {
  constructor(
    message: string,
    context?: ErrorContext
  ) {
    super(message, 'CONFLICT', {
      context,
      severity: ErrorSeverity.WARNING,
      isOperational: true,
    });
  }
}

/**
 * Timeout error base class
 *
 * Used when an operation exceeds its time limit
 */
export class TimeoutError extends AppError {
  constructor(
    operation: string,
    timeoutMs: number,
    context?: ErrorContext
  ) {
    super(
      `Operation timed out after ${timeoutMs}ms: ${operation}`,
      'TIMEOUT',
      {
        context: { operation, timeoutMs, ...context },
        severity: ErrorSeverity.ERROR,
        isOperational: true,
      }
    );
  }
}

/**
 * Rate limit error base class
 *
 * Used when an API rate limit is exceeded
 */
export class RateLimitError extends AppError {
  constructor(
    service: string,
    retryAfterMs?: number,
    context?: ErrorContext
  ) {
    super(
      `Rate limit exceeded for ${service}${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ''}`,
      'RATE_LIMIT_EXCEEDED',
      {
        context: { service, retryAfterMs, ...context },
        severity: ErrorSeverity.WARNING,
        isOperational: true,
      }
    );
  }
}

/**
 * Network error base class
 *
 * Used for network-related failures
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    options?: {
      url?: string;
      statusCode?: number;
      context?: ErrorContext;
      originalError?: Error;
    }
  ) {
    super(message, 'NETWORK_ERROR', {
      context: {
        url: options?.url,
        statusCode: options?.statusCode,
        ...options?.context,
      },
      severity: ErrorSeverity.ERROR,
      isOperational: true,
      originalError: options?.originalError,
    });
  }
}

/**
 * Internal error base class
 *
 * Used for unexpected programming errors that shouldn't happen
 */
export class InternalError extends AppError {
  constructor(
    message: string,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message, 'INTERNAL_ERROR', {
      context,
      severity: ErrorSeverity.CRITICAL,
      isOperational: false, // Programming errors are not operational
      originalError,
    });
  }
}
