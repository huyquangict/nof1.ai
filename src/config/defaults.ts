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
 * Default Configuration Values
 *
 * These defaults are used when environment variables are not set.
 * Production systems should always explicitly configure critical values.
 */

import type { SystemConfig } from '../types/config';

/**
 * Default system configuration
 * WARNING: These are development defaults. Override in production!
 */
export const DEFAULT_CONFIG: Partial<SystemConfig> = {
  exchange: {
    name: 'binance',
    apiKey: '',
    apiSecret: '',
    testnet: true, // Default to testnet for safety
    marginMode: 'isolated',
  },

  trading: {
    symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'BCH', 'DOGE', 'LTC', 'HBAR', 'ASTER'],
    intervalMinutes: 5,
    maxLeverage: 15,
    maxPositions: 5,
    maxHoldingHours: 36,
    strategy: 'balanced',
    enableReverseTrading: false,
    showSymbolHistory: true,
    initialBalance: 1000,
  },

  risk: {
    positionStopLossPnlPercent: -15,
    positionTp1PnlPercent: 15,
    positionTp2PnlPercent: 25,
    positionTp3PnlPercent: 40,
    peakDrawdownMinPeakPercent: 10,  // Only protect after 10% peak profit
    peakDrawdownThresholdPercent: 30, // Close if drops 30% from peak
    accountStopLossUsdt: 50,
    accountTakeProfitUsdt: 20000,
    accountDrawdownWarningPercent: 20,
    accountDrawdownNoNewPositionPercent: 30,
    accountDrawdownForceClosePercent: 50,
  },

  database: {
    url: 'file:./.voltagent/trading.db',
    syncOnStartup: true,
  },

  ai: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelName: 'deepseek/deepseek-v3.2-exp',
    maxSteps: 10,
  },

  server: {
    port: 3100,
    jwtSecret: 'change-this-secret-in-production',
    jwtExpiresIn: '7d',
    adminUsername: 'admin',
    adminPassword: 'change-this-password',
  },
};

/**
 * Minimum required configuration values
 * These must be set explicitly via environment variables
 */
export const REQUIRED_ENV_VARS = [
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'OPENAI_API_KEY',
] as const;

/**
 * Configuration value constraints
 */
export const CONFIG_CONSTRAINTS = {
  trading: {
    intervalMinutes: { min: 1, max: 60 },
    maxLeverage: { min: 1, max: 125 },
    maxPositions: { min: 1, max: 20 },
    maxHoldingHours: { min: 1, max: 168 }, // Max 1 week
    initialBalance: { min: 10, max: 1000000 },
  },
  risk: {
    positionStopLossPnlPercent: { min: -50, max: -1 },
    positionTp1PnlPercent: { min: 1, max: 100 },
    positionTp2PnlPercent: { min: 1, max: 200 },
    positionTp3PnlPercent: { min: 1, max: 500 },
    accountStopLossUsdt: { min: 0.1, max: 100000 },
    accountTakeProfitUsdt: { min: 1, max: 10000000 },
    accountDrawdownWarningPercent: { min: 1, max: 100 },
    accountDrawdownNoNewPositionPercent: { min: 1, max: 100 },
    accountDrawdownForceClosePercent: { min: 1, max: 100 },
  },
  server: {
    port: { min: 1, max: 65535 },
  },
  ai: {
    maxSteps: { min: 1, max: 200 },
  },
} as const;
