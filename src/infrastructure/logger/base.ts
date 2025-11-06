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
 * Base Logger Wrapper
 *
 * Wraps Pino logger with structured logging utilities and consistent formatting.
 */

import { createPinoLogger } from '@voltagent/logger';
import type { LogContext, LogLevel, PerformanceMetrics } from '../../types/logging';
import { formatErrorForLogging, type AppError } from '../../errors';

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Logger name/module */
  name: string;
  /** Log level (default: info) */
  level?: LogLevel;
  /** Additional context to include in all logs */
  defaultContext?: LogContext;
}

/**
 * Base structured logger class
 *
 * Provides structured logging with consistent formatting and utilities.
 */
export class BaseLogger {
  private logger: any; // Use 'any' to avoid Pino type complications
  private defaultContext: LogContext;
  private loggerName: string;
  private loggerLevel: LogLevel;

  constructor(options: LoggerOptions) {
    this.logger = createPinoLogger({
      name: options.name,
      level: options.level ?? 'info',
    });
    this.loggerName = options.name;
    this.loggerLevel = (options.level ?? 'info') as LogLevel;
    this.defaultContext = options.defaultContext ?? {};
  }

  /**
   * Merge context with default context
   */
  private mergeContext(context?: LogContext): LogContext {
    return {
      ...this.defaultContext,
      ...context,
    };
  }

  /**
   * Trace level log
   */
  trace(message: string, context?: LogContext): void {
    this.logger.trace(this.mergeContext(context), message);
  }

  /**
   * Debug level log
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(this.mergeContext(context), message);
  }

  /**
   * Info level log
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(this.mergeContext(context), message);
  }

  /**
   * Warning level log
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(this.mergeContext(context), message);
  }

  /**
   * Error level log
   *
   * Accepts either an Error object or a message string.
   */
  error(messageOrError: string | Error, context?: LogContext): void {
    if (messageOrError instanceof Error) {
      const errorContext = {
        ...this.mergeContext(context),
        ...formatErrorForLogging(messageOrError),
      };
      this.logger.error(errorContext, messageOrError.message);
    } else {
      this.logger.error(this.mergeContext(context), messageOrError);
    }
  }

  /**
   * Fatal level log
   */
  fatal(message: string, context?: LogContext): void {
    this.logger.fatal(this.mergeContext(context), message);
  }

  /**
   * Log with custom level
   */
  log(level: LogLevel, message: string, context?: LogContext): void {
    this.logger[level](this.mergeContext(context), message);
  }

  /**
   * Time an operation and log performance metrics
   *
   * @example
   * ```typescript
   * const result = await logger.timeOperation('fetch_balance', async () => {
   *   return await exchangeClient.getBalance();
   * });
   * // Result is returned as-is, metrics are logged
   * ```
   */
  async timeOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = new Date();
    const startMs = Date.now();

    try {
      const result = await operation();
      const endTime = new Date();
      const durationMs = Date.now() - startMs;

      this.debug(`Operation completed: ${operationName}`, {
        ...this.mergeContext(context),
        durationMs,
        operation: operationName,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const durationMs = Date.now() - startMs;

      this.error(`Operation failed: ${operationName}`, {
        ...this.mergeContext(context),
        durationMs,
        operation: operationName,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Create a child logger with additional default context
   *
   * Useful for scoping logs to a specific operation or request.
   *
   * @example
   * ```typescript
   * const positionLogger = logger.child({ symbol: 'BTC', side: 'long' });
   * positionLogger.info('Opening position'); // Automatically includes symbol and side
   * ```
   */
  child(additionalContext: LogContext): BaseLogger {
    return new BaseLogger({
      name: this.loggerName,
      level: this.loggerLevel,
      defaultContext: {
        ...this.defaultContext,
        ...additionalContext,
      },
    });
  }

  /**
   * Log an operation start
   */
  operationStart(operationName: string, context?: LogContext): void {
    this.debug(`Starting: ${operationName}`, {
      ...this.mergeContext(context),
      operation: operationName,
      phase: 'start',
    });
  }

  /**
   * Log an operation success
   */
  operationSuccess(operationName: string, context?: LogContext): void {
    this.info(`Success: ${operationName}`, {
      ...this.mergeContext(context),
      operation: operationName,
      phase: 'success',
    });
  }

  /**
   * Log an operation failure
   */
  operationFailure(operationName: string, error: Error, context?: LogContext): void {
    this.error(error, {
      ...this.mergeContext(context),
      operation: operationName,
      phase: 'failure',
    });
  }

  /**
   * Get the underlying Pino logger instance
   *
   * Use this sparingly - prefer the structured methods above.
   */
  getPinoLogger(): any {
    return this.logger;
  }
}
