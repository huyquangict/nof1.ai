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
 * Configuration Validation
 *
 * Validates the loaded configuration against constraints and business rules.
 * Throws descriptive errors if configuration is invalid.
 */

import type { SystemConfig, TradingStrategy } from '../types/config';
import { CONFIG_CONSTRAINTS, REQUIRED_ENV_VARS } from './defaults';

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate that a number is within a specified range
 */
function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): void {
  if (value < min || value > max) {
    throw new ConfigValidationError(
      `${fieldName} must be between ${min} and ${max}, got ${value}`,
      fieldName
    );
  }
}

/**
 * Validate that a string is not empty
 */
function validateNotEmpty(value: string, fieldName: string): void {
  if (!value || value.trim().length === 0) {
    throw new ConfigValidationError(
      `${fieldName} is required and cannot be empty`,
      fieldName
    );
  }
}

/**
 * Validate trading strategy value
 */
function validateStrategy(strategy: string): asserts strategy is TradingStrategy {
  const validStrategies: TradingStrategy[] = ['conservative', 'balanced', 'aggressive'];
  if (!validStrategies.includes(strategy as TradingStrategy)) {
    throw new ConfigValidationError(
      `Invalid trading strategy: ${strategy}. Must be one of: ${validStrategies.join(', ')}`,
      'trading.strategy'
    );
  }
}

/**
 * Validate margin mode value
 */
function validateMarginMode(mode: string): asserts mode is 'isolated' | 'crossed' {
  const validModes = ['isolated', 'crossed'];
  if (!validModes.includes(mode)) {
    throw new ConfigValidationError(
      `Invalid margin mode: ${mode}. Must be one of: ${validModes.join(', ')}`,
      'exchange.marginMode'
    );
  }
}

/**
 * Validate trading symbols
 */
function validateTradingSymbols(symbols: string[]): void {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new ConfigValidationError(
      'At least one trading symbol is required',
      'trading.symbols'
    );
  }

  for (const symbol of symbols) {
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      throw new ConfigValidationError(
        `Invalid trading symbol: ${symbol}`,
        'trading.symbols'
      );
    }
  }
}

/**
 * Validate database URL format
 */
function validateDatabaseUrl(url: string): void {
  if (!url.startsWith('file:') && !url.startsWith('libsql:')) {
    throw new ConfigValidationError(
      `Database URL must start with 'file:' or 'libsql:', got: ${url}`,
      'database.url'
    );
  }
}

/**
 * Validate AI base URL format
 */
function validateAIBaseUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new ConfigValidationError(
      `Invalid AI base URL: ${url}. Must be a valid HTTP/HTTPS URL`,
      'ai.baseUrl'
    );
  }
}

/**
 * Validate risk parameters consistency
 */
function validateRiskConsistency(config: SystemConfig): void {
  const { risk } = config;

  // Ensure drawdown thresholds are ordered correctly
  if (risk.accountDrawdownWarningPercent >= risk.accountDrawdownNoNewPositionPercent) {
    throw new ConfigValidationError(
      `Warning threshold (${risk.accountDrawdownWarningPercent}%) must be less than no-new-position threshold (${risk.accountDrawdownNoNewPositionPercent}%)`,
      'risk.accountDrawdownWarningPercent'
    );
  }

  if (risk.accountDrawdownNoNewPositionPercent >= risk.accountDrawdownForceClosePercent) {
    throw new ConfigValidationError(
      `No-new-position threshold (${risk.accountDrawdownNoNewPositionPercent}%) must be less than force-close threshold (${risk.accountDrawdownForceClosePercent}%)`,
      'risk.accountDrawdownNoNewPositionPercent'
    );
  }

  // Ensure TP levels are ordered correctly
  if (risk.positionTp1PnlPercent >= risk.positionTp2PnlPercent) {
    throw new ConfigValidationError(
      `TP1 (${risk.positionTp1PnlPercent}%) must be less than TP2 (${risk.positionTp2PnlPercent}%)`,
      'risk.positionTp1PnlPercent'
    );
  }

  if (risk.positionTp2PnlPercent >= risk.positionTp3PnlPercent) {
    throw new ConfigValidationError(
      `TP2 (${risk.positionTp2PnlPercent}%) must be less than TP3 (${risk.positionTp3PnlPercent}%)`,
      'risk.positionTp2PnlPercent'
    );
  }

  // Ensure stop-loss is negative
  if (risk.positionStopLossPnlPercent >= 0) {
    throw new ConfigValidationError(
      `Stop-loss must be negative, got ${risk.positionStopLossPnlPercent}%`,
      'risk.positionStopLossPnlPercent'
    );
  }
}

/**
 * Validate complete system configuration
 *
 * @param config - The configuration object to validate
 * @throws ConfigValidationError if configuration is invalid
 */
export function validateConfig(config: SystemConfig): void {
  // Exchange configuration
  validateNotEmpty(config.exchange.apiKey, 'BINANCE_API_KEY');
  validateNotEmpty(config.exchange.apiSecret, 'BINANCE_API_SECRET');
  validateMarginMode(config.exchange.marginMode);

  // Trading configuration
  validateTradingSymbols(config.trading.symbols);
  validateStrategy(config.trading.strategy);
  validateRange(
    config.trading.intervalMinutes,
    CONFIG_CONSTRAINTS.trading.intervalMinutes.min,
    CONFIG_CONSTRAINTS.trading.intervalMinutes.max,
    'TRADING_INTERVAL_MINUTES'
  );
  validateRange(
    config.trading.maxLeverage,
    CONFIG_CONSTRAINTS.trading.maxLeverage.min,
    CONFIG_CONSTRAINTS.trading.maxLeverage.max,
    'MAX_LEVERAGE'
  );
  validateRange(
    config.trading.maxPositions,
    CONFIG_CONSTRAINTS.trading.maxPositions.min,
    CONFIG_CONSTRAINTS.trading.maxPositions.max,
    'MAX_POSITIONS'
  );
  validateRange(
    config.trading.maxHoldingHours,
    CONFIG_CONSTRAINTS.trading.maxHoldingHours.min,
    CONFIG_CONSTRAINTS.trading.maxHoldingHours.max,
    'MAX_HOLDING_HOURS'
  );
  validateRange(
    config.trading.initialBalance,
    CONFIG_CONSTRAINTS.trading.initialBalance.min,
    CONFIG_CONSTRAINTS.trading.initialBalance.max,
    'INITIAL_BALANCE'
  );

  // Risk configuration
  validateRange(
    config.risk.positionStopLossPnlPercent,
    CONFIG_CONSTRAINTS.risk.positionStopLossPnlPercent.min,
    CONFIG_CONSTRAINTS.risk.positionStopLossPnlPercent.max,
    'POSITION_STOP_LOSS_PNL_PERCENT'
  );
  validateRange(
    config.risk.positionTp1PnlPercent,
    CONFIG_CONSTRAINTS.risk.positionTp1PnlPercent.min,
    CONFIG_CONSTRAINTS.risk.positionTp1PnlPercent.max,
    'POSITION_TP1_PNL_PERCENT'
  );
  validateRange(
    config.risk.positionTp2PnlPercent,
    CONFIG_CONSTRAINTS.risk.positionTp2PnlPercent.min,
    CONFIG_CONSTRAINTS.risk.positionTp2PnlPercent.max,
    'POSITION_TP2_PNL_PERCENT'
  );
  validateRange(
    config.risk.positionTp3PnlPercent,
    CONFIG_CONSTRAINTS.risk.positionTp3PnlPercent.min,
    CONFIG_CONSTRAINTS.risk.positionTp3PnlPercent.max,
    'POSITION_TP3_PNL_PERCENT'
  );
  validateRange(
    config.risk.accountStopLossUsdt,
    CONFIG_CONSTRAINTS.risk.accountStopLossUsdt.min,
    CONFIG_CONSTRAINTS.risk.accountStopLossUsdt.max,
    'ACCOUNT_STOP_LOSS_USDT'
  );
  validateRange(
    config.risk.accountTakeProfitUsdt,
    CONFIG_CONSTRAINTS.risk.accountTakeProfitUsdt.min,
    CONFIG_CONSTRAINTS.risk.accountTakeProfitUsdt.max,
    'ACCOUNT_TAKE_PROFIT_USDT'
  );
  validateRange(
    config.risk.accountDrawdownWarningPercent,
    CONFIG_CONSTRAINTS.risk.accountDrawdownWarningPercent.min,
    CONFIG_CONSTRAINTS.risk.accountDrawdownWarningPercent.max,
    'ACCOUNT_DRAWDOWN_WARNING_PERCENT'
  );
  validateRange(
    config.risk.accountDrawdownNoNewPositionPercent,
    CONFIG_CONSTRAINTS.risk.accountDrawdownNoNewPositionPercent.min,
    CONFIG_CONSTRAINTS.risk.accountDrawdownNoNewPositionPercent.max,
    'ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT'
  );
  validateRange(
    config.risk.accountDrawdownForceClosePercent,
    CONFIG_CONSTRAINTS.risk.accountDrawdownForceClosePercent.min,
    CONFIG_CONSTRAINTS.risk.accountDrawdownForceClosePercent.max,
    'ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT'
  );

  // Risk consistency checks
  validateRiskConsistency(config);

  // Database configuration
  validateDatabaseUrl(config.database.url);

  // AI configuration
  validateNotEmpty(config.ai.apiKey, 'OPENAI_API_KEY');
  validateAIBaseUrl(config.ai.baseUrl);
  validateNotEmpty(config.ai.modelName, 'AI_MODEL_NAME');
  validateRange(
    config.ai.maxSteps,
    CONFIG_CONSTRAINTS.ai.maxSteps.min,
    CONFIG_CONSTRAINTS.ai.maxSteps.max,
    'MAX_STEPS'
  );

  // Server configuration
  validateRange(
    config.server.port,
    CONFIG_CONSTRAINTS.server.port.min,
    CONFIG_CONSTRAINTS.server.port.max,
    'PORT'
  );
  validateNotEmpty(config.server.jwtSecret, 'JWT_SECRET');
  validateNotEmpty(config.server.adminUsername, 'ADMIN_USERNAME');
  validateNotEmpty(config.server.adminPassword, 'ADMIN_PASSWORD');

  // Warn about insecure defaults in production
  if (process.env.NODE_ENV === 'production') {
    if (config.server.jwtSecret === 'change-this-secret-in-production') {
      console.warn('⚠️  WARNING: Using default JWT secret in production! This is insecure!');
    }
    if (config.server.adminPassword === 'change-this-password') {
      console.warn('⚠️  WARNING: Using default admin password in production! This is insecure!');
    }
    if (config.exchange.testnet) {
      console.warn('⚠️  WARNING: Testnet is enabled in production environment!');
    }
  }
}

/**
 * Check that all required environment variables are set
 *
 * @throws ConfigValidationError if required variables are missing
 */
export function validateRequiredEnvVars(): void {
  const missing: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new ConfigValidationError(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set these variables in your .env file or environment.'
    );
  }
}
