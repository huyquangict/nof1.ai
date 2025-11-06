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
 * Basic risk parameter configuration (read from environment variables for flexible configuration)
 */

// Read trading symbol list from environment variable (comma-separated)
const DEFAULT_TRADING_SYMBOLS = 'BTC,ETH,SOL,XRP,BNB,BCH,DOGE,LTC,HBAR,ASTER';
const tradingSymbolsStr = process.env.TRADING_SYMBOLS || DEFAULT_TRADING_SYMBOLS;
const tradingSymbols = tradingSymbolsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

// Read configuration from environment variables with default values
export const RISK_PARAMS = {
  // Maximum number of positions
  MAX_POSITIONS: Number.parseInt(process.env.MAX_POSITIONS || '5', 10),

  // Maximum leverage multiplier
  MAX_LEVERAGE: Number.parseInt(process.env.MAX_LEVERAGE || '15', 10),

  // Trading symbol list (as tuple to support zod.enum)
  TRADING_SYMBOLS: tradingSymbols as [string, ...string[]],

  // Maximum holding hours
  MAX_HOLDING_HOURS: Number.parseInt(process.env.MAX_HOLDING_HOURS || '36', 10),

  // Maximum holding cycles (auto-calculated based on holding hours: hours * 6, as each cycle is 10 minutes)
  get MAX_HOLDING_CYCLES() {
    return this.MAX_HOLDING_HOURS * 6;
  },

  // Account drawdown risk control thresholds
  // Drawdown threshold to prohibit new positions (when reached, only close positions allowed, no new positions)
  ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT || '15', 10),

  // Drawdown threshold to force close all positions (when reached, immediately close all positions and stop trading)
  ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT || '20', 10),

  // Drawdown threshold for warning alerts (when reached, warn to trade cautiously)
  ACCOUNT_DRAWDOWN_WARNING_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_WARNING_PERCENT || '10', 10),
} as const;

