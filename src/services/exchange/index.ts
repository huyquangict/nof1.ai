/**
 * open-nof1.ai - AI 加密货币自动交易系统
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
 * Exchange Abstraction Layer
 *
 * Exports for multi-exchange support
 */

// Interface and types
export type {
  IExchangeClient,
  Ticker,
  Candle,
  FundingRate,
  OrderBook,
  Account,
  Position,
  Order,
  OrderParams,
  ContractInfo,
} from './IExchangeClient';

// Exchange adapters
export { GateAdapter } from './GateAdapter';
export { BinanceAdapter } from './BinanceAdapter';
export type { BinanceConfig } from './BinanceAdapter';

// Factory functions
export {
  createExchangeClient,
  resetExchangeClient,
  getConfiguredExchange,
  isTestnetConfigured,
} from './ExchangeFactory';
