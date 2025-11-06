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
 * Logging Types and Interfaces
 *
 * Defines types for structured logging throughout the system.
 */

/**
 * Log levels
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Base log context that all logs can include
 */
export interface LogContext {
  /** Trading symbol (e.g., BTC, ETH) */
  symbol?: string;
  /** Position side (long or short) */
  side?: 'long' | 'short';
  /** Order ID */
  orderId?: string;
  /** Position entry order ID */
  positionId?: string;
  /** Additional custom fields */
  [key: string]: unknown;
}

/**
 * Trading operation types for categorization
 */
export enum TradingOperation {
  POSITION_OPEN = 'position_open',
  POSITION_CLOSE = 'position_close',
  POSITION_UPDATE = 'position_update',
  ORDER_PLACE = 'order_place',
  ORDER_CANCEL = 'order_cancel',
  ORDER_UPDATE = 'order_update',
  STOP_LOSS_SET = 'stop_loss_set',
  STOP_LOSS_TRIGGER = 'stop_loss_trigger',
  TAKE_PROFIT_SET = 'take_profit_set',
  TAKE_PROFIT_TRIGGER = 'take_profit_trigger',
  TAKE_PROFIT_ADJUST = 'take_profit_adjust',
  RISK_CHECK = 'risk_check',
  BALANCE_UPDATE = 'balance_update',
  MARKET_DATA_FETCH = 'market_data_fetch',
  EXCHANGE_API_CALL = 'exchange_api_call',
  SYSTEM_STARTUP = 'system_startup',
  SYSTEM_SHUTDOWN = 'system_shutdown',
  TRADING_CYCLE = 'trading_cycle',
}

/**
 * Performance metrics for operations
 */
export interface PerformanceMetrics {
  /** Operation duration in milliseconds */
  durationMs: number;
  /** Operation start timestamp */
  startTime: Date;
  /** Operation end timestamp */
  endTime: Date;
  /** Whether operation succeeded */
  success: boolean;
  /** Additional metrics */
  [key: string]: unknown;
}

/**
 * Position log context
 */
export interface PositionLogContext extends LogContext {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice?: number;
  leverage?: number;
  pnlPercent?: number;
  pnlUsdt?: number;
}

/**
 * Order log context
 */
export interface OrderLogContext extends LogContext {
  orderId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  price?: number;
  orderType?: string;
  status?: string;
}

/**
 * Risk log context
 */
export interface RiskLogContext extends LogContext {
  checkType: string;
  passed: boolean;
  reason?: string;
  currentValue?: number;
  threshold?: number;
}

/**
 * Account log context
 */
export interface AccountLogContext extends LogContext {
  balance: number;
  equity?: number;
  marginUsed?: number;
  marginAvailable?: number;
  pnlTotal?: number;
}

/**
 * Exchange API log context
 */
export interface ExchangeApiLogContext extends LogContext {
  exchange: string;
  endpoint: string;
  method: string;
  statusCode?: number;
  durationMs?: number;
  retryCount?: number;
}
