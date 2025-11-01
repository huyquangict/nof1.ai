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
 * Exchange Client Interface - Abstraction layer for multiple exchanges
 *
 * This interface standardizes interactions with different cryptocurrency exchanges.
 * Each exchange adapter (Gate.io, Binance, etc.) implements this interface.
 */

// ============================================================================
// Standardized Data Types
// ============================================================================

export interface Ticker {
  symbol: string;           // Normalized symbol: "BTC"
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  change24h: number;        // Percentage change
  volume24h: number;
  timestamp: number;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundingRate {
  symbol: string;
  rate: number;
  timestamp: number;
  nextFundingTime?: number;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][]; // [price, quantity]
  timestamp: number;
}

export interface Account {
  currency: string;
  totalBalance: number;
  availableBalance: number;
  positionMargin: number;
  orderMargin: number;
  unrealisedPnl: number;
  timestamp: number;
}

export interface Position {
  symbol: string;           // Normalized: "BTC"
  exchangeSymbol: string;   // Exchange format: "BTC_USDT" or "BTC/USDT:USDT"
  side: 'long' | 'short';
  quantity: number;         // Absolute value
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  margin: number;
  timestamp: number;
}

export interface Order {
  id: string;
  symbol: string;           // Normalized: "BTC"
  side: 'long' | 'short';
  price: number;
  quantity: number;
  filled: number;
  remaining: number;
  status: string;           // 'open', 'closed', 'cancelled', 'finished'
  isReduceOnly: boolean;
  timestamp: number;
}

export interface OrderParams {
  symbol: string;           // Normalized: "BTC"
  side: 'long' | 'short';
  quantity: number;
  price?: number;           // undefined = market order
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
  autoSize?: string;
  tif?: string;             // time in force
}

export interface ContractInfo {
  symbol: string;           // Normalized: "BTC"
  exchangeSymbol: string;   // Exchange format
  orderSizeMin: number;
  orderSizeMax: number;
  quantoMultiplier: number;
  type: string;
  leverage_min: number;
  leverage_max: number;
}

// ============================================================================
// Exchange Client Interface
// ============================================================================

export interface IExchangeClient {
  // ========== Market Data ==========

  /**
   * Get ticker/price data for a symbol
   * @param symbol Normalized symbol (e.g., "BTC")
   */
  getFuturesTicker(symbol: string): Promise<Ticker>;

  /**
   * Get candlestick/OHLCV data
   * @param symbol Normalized symbol (e.g., "BTC")
   * @param interval Time interval ("1m", "5m", "15m", "1h", etc.)
   * @param limit Number of candles to fetch
   */
  getFuturesCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;

  /**
   * Get funding rate for perpetual contract
   * @param symbol Normalized symbol (e.g., "BTC")
   */
  getFundingRate(symbol: string): Promise<FundingRate>;

  /**
   * Get order book (depth)
   * @param symbol Normalized symbol (e.g., "BTC")
   * @param limit Number of levels to fetch
   */
  getOrderBook(symbol: string, limit: number): Promise<OrderBook>;

  /**
   * Get contract information
   * @param symbol Normalized symbol (e.g., "BTC")
   */
  getContractInfo(symbol: string): Promise<ContractInfo>;

  // ========== Account & Positions ==========

  /**
   * Get account balance and margin information
   */
  getFuturesAccount(): Promise<Account>;

  /**
   * Get all current positions
   * Returns only active positions (non-zero size)
   */
  getPositions(): Promise<Position[]>;

  // ========== Trading ==========

  /**
   * Place an order (market or limit)
   * @param params Order parameters
   */
  placeOrder(params: OrderParams): Promise<Order>;

  /**
   * Cancel an open order
   * @param orderId Exchange-specific order ID
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Get order status/details
   * @param orderId Exchange-specific order ID
   */
  getOrder(orderId: string): Promise<Order>;

  /**
   * Get all open orders
   * @param symbol Optional: filter by symbol
   */
  getOpenOrders(symbol?: string): Promise<Order[]>;

  /**
   * Set leverage for a symbol
   * @param symbol Normalized symbol (e.g., "BTC")
   * @param leverage Leverage multiplier
   */
  setLeverage(symbol: string, leverage: number): Promise<void>;

  // ========== Configuration ==========

  /**
   * Get exchange name
   */
  getExchangeName(): string;

  /**
   * Check if using testnet
   */
  isTestnet(): boolean;

  /**
   * Convert normalized symbol to exchange format
   * @param symbol Normalized symbol (e.g., "BTC")
   * @returns Exchange-specific format (e.g., "BTC_USDT" or "BTC/USDT:USDT")
   */
  normalizeSymbol(symbol: string): string;

  /**
   * Convert exchange symbol to normalized format
   * @param exchangeSymbol Exchange-specific format
   * @returns Normalized symbol (e.g., "BTC")
   */
  denormalizeSymbol(exchangeSymbol: string): string;
}
