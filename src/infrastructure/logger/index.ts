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
 * Logger Factory
 *
 * Central module for creating and managing loggers throughout the system.
 *
 * @example Basic usage
 * ```typescript
 * import { createTradingLogger, createBaseLogger } from './infrastructure/logger';
 *
 * const logger = createTradingLogger('position-manager');
 * logger.positionOpened({ symbol: 'BTC', side: 'long', quantity: 0.1 });
 * ```
 *
 * @example With default context
 * ```typescript
 * const logger = createTradingLogger('trading-loop', {
 *   defaultContext: { module: 'scheduler' }
 * });
 * // All logs will automatically include { module: 'scheduler' }
 * ```
 */

import { BaseLogger, type LoggerOptions } from './base';
import { TradingLogger } from './trading';
import type { LogLevel, LogContext } from '../../types/logging';

/**
 * Logger registry for managing logger instances
 */
const loggerRegistry = new Map<string, BaseLogger | TradingLogger>();

/**
 * Create a base logger instance
 *
 * @param name - Logger name (e.g., 'database', 'api', 'utils')
 * @param options - Logger configuration options
 * @returns BaseLogger instance
 */
export function createBaseLogger(
  name: string,
  options?: {
    level?: LogLevel;
    defaultContext?: LogContext;
    singleton?: boolean;
  }
): BaseLogger {
  // Return cached instance if singleton is enabled
  if (options?.singleton && loggerRegistry.has(name)) {
    const cached = loggerRegistry.get(name);
    if (cached instanceof BaseLogger) {
      return cached;
    }
  }

  const logger = new BaseLogger({
    name,
    level: options?.level,
    defaultContext: options?.defaultContext,
  });

  if (options?.singleton) {
    loggerRegistry.set(name, logger);
  }

  return logger;
}

/**
 * Create a trading logger instance
 *
 * Trading loggers have domain-specific methods for common operations.
 *
 * @param name - Logger name (e.g., 'position-manager', 'order-executor')
 * @param options - Logger configuration options
 * @returns TradingLogger instance
 */
export function createTradingLogger(
  name?: string,
  options?: {
    level?: LogLevel;
    defaultContext?: LogContext;
    singleton?: boolean;
  }
): TradingLogger {
  const loggerName = name ?? 'trading';

  // Return cached instance if singleton is enabled
  if (options?.singleton && loggerRegistry.has(loggerName)) {
    const cached = loggerRegistry.get(loggerName);
    if (cached instanceof TradingLogger) {
      return cached;
    }
  }

  const logger = new TradingLogger({
    name: loggerName,
    level: options?.level,
    defaultContext: options?.defaultContext,
  });

  if (options?.singleton) {
    loggerRegistry.set(loggerName, logger);
  }

  return logger;
}

/**
 * Get a logger from the registry
 *
 * @param name - Logger name
 * @returns Logger instance or undefined if not found
 */
export function getLogger(name: string): BaseLogger | TradingLogger | undefined {
  return loggerRegistry.get(name);
}

/**
 * Clear all cached loggers
 *
 * Useful for testing or when reconfiguring the system.
 */
export function clearLoggerRegistry(): void {
  loggerRegistry.clear();
}

/**
 * Get the default trading logger
 *
 * This is a singleton instance used throughout the system.
 * Use this when you don't need module-specific logging.
 */
export function getDefaultTradingLogger(): TradingLogger {
  return createTradingLogger('trading', { singleton: true });
}

/**
 * Logger factory for common modules
 */
export const LoggerFactory = {
  /**
   * Create logger for database operations
   */
  forDatabase(moduleName?: string): BaseLogger {
    return createBaseLogger(moduleName ? `db:${moduleName}` : 'database');
  },

  /**
   * Create logger for API endpoints
   */
  forApi(routeName?: string): BaseLogger {
    return createBaseLogger(routeName ? `api:${routeName}` : 'api');
  },

  /**
   * Create logger for schedulers/background jobs
   */
  forScheduler(jobName?: string): TradingLogger {
    return createTradingLogger(jobName ? `scheduler:${jobName}` : 'scheduler');
  },

  /**
   * Create logger for trading tools
   */
  forTool(toolName: string): TradingLogger {
    return createTradingLogger(`tool:${toolName}`);
  },

  /**
   * Create logger for services
   */
  forService(serviceName: string): BaseLogger {
    return createBaseLogger(`service:${serviceName}`);
  },

  /**
   * Create logger for agents
   */
  forAgent(agentName?: string): TradingLogger {
    return createTradingLogger(agentName ? `agent:${agentName}` : 'agent');
  },
};

// Re-export types and classes
export { BaseLogger, TradingLogger };
export type { LoggerOptions } from './base';
export type {
  LogLevel,
  LogContext,
  TradingOperation,
  PerformanceMetrics,
  PositionLogContext,
  OrderLogContext,
  RiskLogContext,
  AccountLogContext,
  ExchangeApiLogContext,
} from '../../types/logging';
