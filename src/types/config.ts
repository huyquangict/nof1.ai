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
 * Centralized Configuration Types
 *
 * This file defines the complete system configuration structure.
 * All configuration is loaded from environment variables and validated on startup.
 */

/**
 * Trading strategy types
 */
export type TradingStrategy = 'conservative' | 'balanced' | 'aggressive';

/**
 * Exchange configuration
 */
export interface ExchangeConfig {
  /** Exchange name (always 'binance' for current implementation) */
  name: 'binance';
  /** Binance API key */
  apiKey: string;
  /** Binance API secret */
  apiSecret: string;
  /** Whether to use testnet (true) or mainnet (false) */
  testnet: boolean;
  /** Margin mode: isolated or crossed */
  marginMode: 'isolated' | 'crossed';
}

/**
 * Trading configuration
 */
export interface TradingConfig {
  /** Trading symbols (e.g., ['BTC', 'ETH', 'SOL']) */
  symbols: string[];
  /** Trading loop interval in minutes */
  intervalMinutes: number;
  /** Maximum leverage multiplier */
  maxLeverage: number;
  /** Maximum simultaneous positions */
  maxPositions: number;
  /** Maximum holding hours before auto-close */
  maxHoldingHours: number;
  /** Trading strategy */
  strategy: TradingStrategy;
  /** Enable reverse (contrarian) trading mode */
  enableReverseTrading: boolean;
  /** Show symbol trading history to AI */
  showSymbolHistory: boolean;
  /** Initial balance (USDT) */
  initialBalance: number;
}

/**
 * Risk management configuration
 */
export interface RiskConfig {
  /** Position stop-loss PnL percentage (leverage-adjusted) */
  positionStopLossPnlPercent: number;
  /** Position take-profit target 1 PnL percentage */
  positionTp1PnlPercent: number;
  /** Position take-profit target 2 PnL percentage */
  positionTp2PnlPercent: number;
  /** Position take-profit target 3 PnL percentage */
  positionTp3PnlPercent: number;
  /** Minimum peak profit before activating drawdown protection (%) */
  peakDrawdownMinPeakPercent: number;
  /** Peak drawdown threshold - close if drops by this % from peak (%) */
  peakDrawdownThresholdPercent: number;
  /** Account stop-loss threshold (USDT) */
  accountStopLossUsdt: number;
  /** Account take-profit threshold (USDT) */
  accountTakeProfitUsdt: number;
  /** Account drawdown warning percentage */
  accountDrawdownWarningPercent: number;
  /** Account drawdown no-new-position percentage */
  accountDrawdownNoNewPositionPercent: number;
  /** Account drawdown force-close percentage */
  accountDrawdownForceClosePercent: number;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database URL (file: or libsql:) */
  url: string;
  /** Sync configuration on startup */
  syncOnStartup: boolean;
}

/**
 * AI model configuration
 */
export interface AIConfig {
  /** OpenAI-compatible API key */
  apiKey: string;
  /** API base URL (e.g., https://openrouter.ai/api/v1) */
  baseUrl: string;
  /** AI model name (e.g., deepseek/deepseek-v3.2-exp) */
  modelName: string;
  /** Maximum tool call steps */
  maxSteps: number;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** HTTP server port */
  port: number;
  /** JWT secret for authentication */
  jwtSecret: string;
  /** JWT expiration time */
  jwtExpiresIn: string;
  /** Admin username */
  adminUsername: string;
  /** Admin password */
  adminPassword: string;
}

/**
 * Complete system configuration
 */
export interface SystemConfig {
  /** Exchange configuration */
  exchange: ExchangeConfig;
  /** Trading configuration */
  trading: TradingConfig;
  /** Risk management configuration */
  risk: RiskConfig;
  /** Database configuration */
  database: DatabaseConfig;
  /** AI model configuration */
  ai: AIConfig;
  /** Server configuration */
  server: ServerConfig;
}
