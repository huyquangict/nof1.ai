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
  positions_quantity: number;
}

export interface SystemConfig {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

/**
 * SQL CREATE TABLE statements
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

-- positions table
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

-- account history table
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

-- technical indicators table
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

-- Agent decision log table
CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  market_analysis TEXT NOT NULL,
  decision TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  account_value REAL NOT NULL,
  positions_quantity INTEGER NOT NULL
);

-- system configuration table
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- AI Learning System: Trading reflections (predictions + outcomes)
CREATE TABLE IF NOT EXISTS trading_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decision_type TEXT NOT NULL,      -- open_long, open_short, close, hold, add
  vision TEXT NOT NULL,              -- What LLM predicted
  confidence_score INTEGER NOT NULL CHECK(confidence_score >= 1 AND confidence_score <= 10),
  reasoning TEXT,                    -- Why this decision
  price_at_decision REAL NOT NULL,
  target_price REAL,
  prediction_timeframe TEXT,         -- 10m, 30m, 1h, 4h
  order_id TEXT,

  -- Feedback (filled 10-60 mins later)
  actual_price REAL,
  price_change_percent REAL,
  prediction_accuracy INTEGER CHECK(prediction_accuracy >= 0 AND prediction_accuracy <= 10),
  feedback_score INTEGER CHECK(feedback_score >= 1 AND feedback_score <= 10),
  pnl_result REAL,
  outcome_type TEXT,                 -- big_win, small_win, neutral, small_loss, big_loss
  time_to_feedback_minutes INTEGER,

  lesson_id INTEGER,
  reviewed INTEGER DEFAULT 0,

  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id)
);

-- AI Learning System: Learned lessons (extracted by reasoner)
CREATE TABLE IF NOT EXISTS learned_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  lesson_category TEXT NOT NULL CHECK(lesson_category IN (
    'entry_timing', 'exit_strategy', 'risk_management',
    'symbol_behavior', 'market_conditions', 'position_sizing', 'funding_rate'
  )),
  lesson_text TEXT NOT NULL,
  supporting_reflections TEXT,       -- JSON array of reflection IDs
  counter_examples TEXT,             -- JSON array of IDs where lesson failed

  success_rate REAL CHECK(success_rate >= 0 AND success_rate <= 1),
  avg_pnl REAL,
  confidence_level TEXT CHECK(confidence_level IN ('high', 'medium', 'low')),

  market_condition TEXT,             -- bull, bear, sideways, high_volatility
  applicable_symbols TEXT,           -- "BTC,ETH" or "all"

  times_applied INTEGER DEFAULT 0,
  times_helpful INTEGER DEFAULT 0,
  effectiveness_rate REAL,

  is_active INTEGER DEFAULT 1,
  created_by_model TEXT,
  last_validated TEXT
);

-- AI Learning System: Lesson applications (track effectiveness)
CREATE TABLE IF NOT EXISTS lesson_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  trade_reflection_id INTEGER,
  was_helpful INTEGER CHECK(was_helpful IN (0, 1)),
  pnl_impact REAL,

  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id),
  FOREIGN KEY (trade_reflection_id) REFERENCES trading_reflections(id)
);

-- create indexes
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trading_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON trading_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON account_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON agent_decisions(timestamp);

-- AI Learning System indexes
CREATE INDEX IF NOT EXISTS idx_reflections_symbol ON trading_reflections(symbol);
CREATE INDEX IF NOT EXISTS idx_reflections_timestamp ON trading_reflections(timestamp);
CREATE INDEX IF NOT EXISTS idx_reflections_feedback ON trading_reflections(feedback_score);
CREATE INDEX IF NOT EXISTS idx_reflections_reviewed ON trading_reflections(reviewed);
CREATE INDEX IF NOT EXISTS idx_reflections_lesson ON trading_reflections(lesson_id);

CREATE INDEX IF NOT EXISTS idx_lessons_category ON learned_lessons(lesson_category);
CREATE INDEX IF NOT EXISTS idx_lessons_success_rate ON learned_lessons(success_rate);
CREATE INDEX IF NOT EXISTS idx_lessons_active ON learned_lessons(is_active);
CREATE INDEX IF NOT EXISTS idx_lessons_effectiveness ON learned_lessons(effectiveness_rate);
CREATE INDEX IF NOT EXISTS idx_lessons_created_at ON learned_lessons(created_at);

CREATE INDEX IF NOT EXISTS idx_applications_lesson ON lesson_applications(lesson_id);
CREATE INDEX IF NOT EXISTS idx_applications_helpful ON lesson_applications(was_helpful);
CREATE INDEX IF NOT EXISTS idx_applications_reflection ON lesson_applications(trade_reflection_id);
CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON lesson_applications(applied_at);
`;

