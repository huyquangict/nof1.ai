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
 * Centralized Configuration System
 *
 * This module provides a single source of truth for all system configuration.
 * Configuration is loaded from environment variables, validated, and cached.
 *
 * Usage:
 *   import { getConfig } from './config';
 *   const config = getConfig();
 *   console.log(config.trading.maxLeverage);
 */

import type { SystemConfig, TradingStrategy } from '../types/config';
import { DEFAULT_CONFIG } from './defaults';
import { validateConfig, validateRequiredEnvVars } from './validation';

/**
 * Cached configuration instance
 */
let cachedConfig: SystemConfig | null = null;

/**
 * Parse a comma-separated string into an array
 */
function parseCommaSeparated(value: string | undefined, defaultValue: string[]): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parse an integer from environment variable
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a float from environment variable
 */
function parseFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Load configuration from environment variables
 *
 * This function reads all configuration from process.env and applies defaults.
 * It does NOT validate the configuration - use validateConfig() for that.
 */
function loadConfigFromEnv(): SystemConfig {
  return {
    exchange: {
      name: 'binance',
      apiKey: process.env.BINANCE_API_KEY || DEFAULT_CONFIG.exchange!.apiKey,
      apiSecret: process.env.BINANCE_API_SECRET || DEFAULT_CONFIG.exchange!.apiSecret,
      testnet: parseBoolean(process.env.USE_TESTNET, DEFAULT_CONFIG.exchange!.testnet),
      marginMode: (process.env.BINANCE_MARGIN_MODE as 'isolated' | 'crossed') || DEFAULT_CONFIG.exchange!.marginMode,
    },

    trading: {
      symbols: parseCommaSeparated(
        process.env.TRADING_SYMBOLS,
        DEFAULT_CONFIG.trading!.symbols
      ),
      intervalMinutes: parseInteger(
        process.env.TRADING_INTERVAL_MINUTES,
        DEFAULT_CONFIG.trading!.intervalMinutes
      ),
      maxLeverage: parseInteger(
        process.env.MAX_LEVERAGE,
        DEFAULT_CONFIG.trading!.maxLeverage
      ),
      maxPositions: parseInteger(
        process.env.MAX_POSITIONS,
        DEFAULT_CONFIG.trading!.maxPositions
      ),
      maxHoldingHours: parseInteger(
        process.env.MAX_HOLDING_HOURS,
        DEFAULT_CONFIG.trading!.maxHoldingHours
      ),
      strategy: (process.env.TRADING_STRATEGY as TradingStrategy) || DEFAULT_CONFIG.trading!.strategy,
      enableReverseTrading: parseBoolean(
        process.env.ENABLE_REVERSE_TRADING,
        DEFAULT_CONFIG.trading!.enableReverseTrading
      ),
      showSymbolHistory: parseBoolean(
        process.env.SHOW_SYMBOL_HISTORY,
        DEFAULT_CONFIG.trading!.showSymbolHistory
      ),
      initialBalance: parseFloat(
        process.env.INITIAL_BALANCE,
        DEFAULT_CONFIG.trading!.initialBalance
      ),
    },

    risk: {
      // Auto-convert stop-loss to negative if user provides positive value
      positionStopLossPnlPercent: -Math.abs(parseFloat(
        process.env.POSITION_STOP_LOSS_PNL_PERCENT,
        DEFAULT_CONFIG.risk!.positionStopLossPnlPercent
      )),
      positionTp1PnlPercent: parseFloat(
        process.env.POSITION_TP1_PNL_PERCENT,
        DEFAULT_CONFIG.risk!.positionTp1PnlPercent
      ),
      positionTp2PnlPercent: parseFloat(
        process.env.POSITION_TP2_PNL_PERCENT,
        DEFAULT_CONFIG.risk!.positionTp2PnlPercent
      ),
      positionTp3PnlPercent: parseFloat(
        process.env.POSITION_TP3_PNL_PERCENT,
        DEFAULT_CONFIG.risk!.positionTp3PnlPercent
      ),
      peakDrawdownMinPeakPercent: parseFloat(
        process.env.PEAK_DRAWDOWN_MIN_PEAK_PERCENT,
        DEFAULT_CONFIG.risk!.peakDrawdownMinPeakPercent
      ),
      peakDrawdownThresholdPercent: parseFloat(
        process.env.PEAK_DRAWDOWN_THRESHOLD_PERCENT,
        DEFAULT_CONFIG.risk!.peakDrawdownThresholdPercent
      ),
      accountStopLossUsdt: parseFloat(
        process.env.ACCOUNT_STOP_LOSS_USDT,
        DEFAULT_CONFIG.risk!.accountStopLossUsdt
      ),
      accountTakeProfitUsdt: parseFloat(
        process.env.ACCOUNT_TAKE_PROFIT_USDT,
        DEFAULT_CONFIG.risk!.accountTakeProfitUsdt
      ),
      accountDrawdownWarningPercent: parseInteger(
        process.env.ACCOUNT_DRAWDOWN_WARNING_PERCENT,
        DEFAULT_CONFIG.risk!.accountDrawdownWarningPercent
      ),
      accountDrawdownNoNewPositionPercent: parseInteger(
        process.env.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT,
        DEFAULT_CONFIG.risk!.accountDrawdownNoNewPositionPercent
      ),
      accountDrawdownForceClosePercent: parseInteger(
        process.env.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT,
        DEFAULT_CONFIG.risk!.accountDrawdownForceClosePercent
      ),
    },

    database: {
      url: process.env.DATABASE_URL || DEFAULT_CONFIG.database!.url,
      syncOnStartup: parseBoolean(
        process.env.SYNC_CONFIG_ON_STARTUP,
        DEFAULT_CONFIG.database!.syncOnStartup
      ),
    },

    ai: {
      apiKey: process.env.OPENAI_API_KEY || DEFAULT_CONFIG.ai!.apiKey,
      baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_CONFIG.ai!.baseUrl,
      modelName: process.env.AI_MODEL_NAME || DEFAULT_CONFIG.ai!.modelName,
      maxSteps: parseInteger(
        process.env.MAX_STEPS,
        DEFAULT_CONFIG.ai!.maxSteps
      ),
    },

    server: {
      port: parseInteger(
        process.env.PORT,
        DEFAULT_CONFIG.server!.port
      ),
      jwtSecret: process.env.JWT_SECRET || DEFAULT_CONFIG.server!.jwtSecret,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_CONFIG.server!.jwtExpiresIn,
      adminUsername: process.env.ADMIN_USERNAME || DEFAULT_CONFIG.server!.adminUsername,
      adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_CONFIG.server!.adminPassword,
    },
  };
}

/**
 * Get the current system configuration
 *
 * Configuration is loaded once and cached. On first call, it validates
 * required environment variables and the complete configuration.
 *
 * @returns The validated system configuration
 * @throws ConfigValidationError if configuration is invalid
 *
 * @example
 * ```typescript
 * import { getConfig } from './config';
 *
 * const config = getConfig();
 * console.log(`Max leverage: ${config.trading.maxLeverage}x`);
 * console.log(`Trading symbols: ${config.trading.symbols.join(', ')}`);
 * ```
 */
export function getConfig(): SystemConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Validate required environment variables first
  validateRequiredEnvVars();

  // Load configuration from environment
  const config = loadConfigFromEnv();

  // Validate the loaded configuration
  validateConfig(config);

  // Cache and return
  cachedConfig = config;
  return cachedConfig;
}

/**
 * Reset the cached configuration
 *
 * This forces the next call to getConfig() to reload from environment.
 * Useful for testing or when environment variables change at runtime.
 */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Get a specific configuration section
 *
 * These are convenience functions to access specific parts of the config.
 */
export function getExchangeConfig() {
  return getConfig().exchange;
}

export function getTradingConfig() {
  return getConfig().trading;
}

export function getRiskConfig() {
  return getConfig().risk;
}

export function getDatabaseConfig() {
  return getConfig().database;
}

export function getAIConfig() {
  return getConfig().ai;
}

export function getServerConfig() {
  return getConfig().server;
}

// Re-export types and validation for convenience
export type { SystemConfig, TradingStrategy } from '../types/config';
export { ConfigValidationError } from './validation';
