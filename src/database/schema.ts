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
 * Database schema definition
 */

export interface TakeProfitOrder {
  price: number;
  percentage: number; // Percentage of position (1-100)
  orderId: string;
  triggered?: boolean; // Whether this TP has been triggered
}

export interface StopLossOrder {
  price: number;
  percentage: number; // Percentage of position (1-100)
  orderId: string;
  triggered?: boolean; // Whether this SL has been triggered
}

export interface Trade {
  id: number;
  order_id: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'open' | 'close';
  price: number;
  quantity: number;
  leverage: number;
  pnl?: number;
  fee?: number;
  timestamp: string;
  status: 'pending' | 'filled' | 'cancelled';
  close_reason?: 'manual' | 'stop_loss' | 'take_profit' | 'take_profit_partial' | 'time_limit' | 'drawdown'; // How position was closed
  entry_order_id?: string; // ID of the entry order (for close trades, links back to the open trade)
}

export interface Position {
  id: number;
  symbol: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  liquidation_price: number;
  unrealized_pnl: number;
  leverage: number;
  side: 'long' | 'short';
  profit_target?: number; // Deprecated: use tp_orders instead
  stop_loss?: number; // Deprecated: use sl_orders instead
  tp_order_id?: string; // Deprecated: use tp_orders instead
  sl_order_id?: string; // Deprecated: use sl_orders instead
  tp_percentage?: number; // Deprecated: use tp_orders instead
  sl_percentage?: number; // Deprecated: use sl_orders instead (total percentage covered by all SLs)
  tp_orders?: TakeProfitOrder[]; // Multiple take-profit orders (stored as JSON in DB)
  sl_orders?: StopLossOrder[]; // Multiple stop-loss orders (stored as JSON in DB)
  entry_order_id: string;
  opened_at: string;
  confidence?: number;
  risk_usd?: number;
  peak_pnl_percent?: number; // Historical peak PnL percentage (considering leverage)
}

export interface AccountHistory {
  id: number;
  timestamp: string;
  total_value: number;
  available_cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  return_percent: number;
  sharpe_ratio?: number;
}

export interface TradingSignal {
  id: number;
  symbol: string;
  timestamp: string;
  price: number;
  ema_20: number;
  ema_50?: number;
  macd: number;
  rsi_7: number;
  rsi_14: number;
  volume: number;
  open_interest?: number;
  funding_rate?: number;
  atr_3?: number;
  atr_14?: number;
}

export interface AgentDecision {
  id: number;
  timestamp: string;
  iteration: number;
  market_analysis: string;
  decision: string;
  actions_taken: string;
  account_value: number;
  positions_count: number;
}

export interface SystemConfig {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

/**
 * SQL 建表语句
 */
export const CREATE_TABLES_SQL = `
-- Trade records table
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  leverage INTEGER NOT NULL,
  pnl REAL,
  fee REAL,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  close_reason TEXT,  -- How position was closed: manual, stop_loss, take_profit, take_profit_partial, time_limit, drawdown
  entry_order_id TEXT  -- ID of entry order (for close trades, links back to open trade)
);

CREATE INDEX IF NOT EXISTS idx_trades_entry_order_id ON trades(entry_order_id);

-- position表
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL NOT NULL,
  liquidation_price REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  leverage INTEGER NOT NULL,
  side TEXT NOT NULL,
  profit_target REAL,
  stop_loss REAL,
  tp_order_id TEXT,
  sl_order_id TEXT,
  tp_percentage REAL,
  sl_percentage REAL,
  tp_orders TEXT, -- JSON array of TakeProfitOrder objects
  sl_orders TEXT, -- JSON array of StopLossOrder objects
  entry_order_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  confidence REAL,
  risk_usd REAL,
  peak_pnl_percent REAL DEFAULT 0
);

-- account历史表
CREATE TABLE IF NOT EXISTS account_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  total_value REAL NOT NULL,
  available_cash REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  return_percent REAL NOT NULL,
  sharpe_ratio REAL
);

-- 技术指标表
CREATE TABLE IF NOT EXISTS trading_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  price REAL NOT NULL,
  ema_20 REAL NOT NULL,
  ema_50 REAL,
  macd REAL NOT NULL,
  rsi_7 REAL NOT NULL,
  rsi_14 REAL NOT NULL,
  volume REAL NOT NULL,
  open_interest REAL,
  funding_rate REAL,
  atr_3 REAL,
  atr_14 REAL
);

-- Agent 决策记录表
CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  market_analysis TEXT NOT NULL,
  decision TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  account_value REAL NOT NULL,
  positions_count INTEGER NOT NULL
);

-- 系统configured表
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trading_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON trading_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON account_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON agent_decisions(timestamp);
`;

