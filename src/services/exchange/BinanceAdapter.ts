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
 * Binance Exchange Adapter
 * Implements IExchangeClient using CCXT library
 */

import ccxt from 'ccxt';
import type {
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

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  marginMode?: 'isolated' | 'crossed';
}

export class BinanceAdapter implements IExchangeClient {
  private exchange: ccxt.binance;
  private testnet: boolean;
  private marginMode: 'isolated' | 'crossed';

  constructor(config: BinanceConfig) {
    this.testnet = config.testnet ?? false;
    this.marginMode = config.marginMode ?? 'isolated';

    this.exchange = new ccxt.binance({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      options: {
        defaultType: 'future', // Use USDT-M futures
        adjustForTimeDifference: true,
      },
    });

    // Use testnet if specified
    if (this.testnet) {
      this.exchange.setSandboxMode(true);
    }
  }

  // ========== Symbol Normalization ==========

  /**
   * Convert normalized symbol to Binance CCXT format
   * BTC → BTC/USDT:USDT
   */
  normalizeSymbol(symbol: string): string {
    if (symbol.includes('/')) {
      return symbol; // Already in CCXT format
    }
    return `${symbol}/USDT:USDT`;
  }

  /**
   * Convert Binance format to normalized symbol
   * BTC/USDT:USDT → BTC
   */
  denormalizeSymbol(exchangeSymbol: string): string {
    if (!exchangeSymbol.includes('/')) {
      return exchangeSymbol; // Already normalized
    }
    return exchangeSymbol.split('/')[0];
  }

  // ========== Market Data ==========

  async getFuturesTicker(symbol: string): Promise<Ticker> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    const ticker = await this.exchange.fetchTicker(ccxtSymbol);

    return {
      symbol: this.denormalizeSymbol(ccxtSymbol),
      lastPrice: ticker.last ?? 0,
      markPrice: ticker.info?.markPrice ? parseFloat(ticker.info.markPrice) : ticker.last ?? 0,
      indexPrice: ticker.info?.indexPrice ? parseFloat(ticker.info.indexPrice) : ticker.last ?? 0,
      change24h: ticker.percentage ?? 0,
      volume24h: ticker.baseVolume ?? 0,
      timestamp: ticker.timestamp ?? Date.now(),
    };
  }

  async getFuturesCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const ccxtSymbol = this.normalizeSymbol(symbol);

    // Map our interval format to CCXT timeframe
    const timeframeMap: Record<string, string> = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '1d': '1d',
    };

    const timeframe = timeframeMap[interval] ?? '5m';
    const ohlcv = await this.exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);

    return ohlcv.map((candle) => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));
  }

  async getFundingRate(symbol: string): Promise<FundingRate> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    const fundingRate = await this.exchange.fetchFundingRate(ccxtSymbol);

    return {
      symbol: this.denormalizeSymbol(ccxtSymbol),
      rate: fundingRate.fundingRate ?? 0,
      timestamp: fundingRate.timestamp ?? Date.now(),
      nextFundingTime: fundingRate.fundingTimestamp,
    };
  }

  async getOrderBook(symbol: string, limit: number): Promise<OrderBook> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    const orderBook = await this.exchange.fetchOrderBook(ccxtSymbol, limit);

    return {
      symbol: this.denormalizeSymbol(ccxtSymbol),
      bids: orderBook.bids.map((bid) => [bid[0], bid[1]] as [number, number]),
      asks: orderBook.asks.map((ask) => [ask[0], ask[1]] as [number, number]),
      timestamp: orderBook.timestamp ?? Date.now(),
    };
  }

  async getContractInfo(symbol: string): Promise<ContractInfo> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    const markets = await this.exchange.loadMarkets();
    const market = markets[ccxtSymbol];

    if (!market) {
      throw new Error(`Market not found for symbol: ${ccxtSymbol}`);
    }

    return {
      symbol: this.denormalizeSymbol(ccxtSymbol),
      exchangeSymbol: ccxtSymbol,
      orderSizeMin: market.limits.amount?.min ?? 0.001,
      orderSizeMax: market.limits.amount?.max ?? 1000000,
      quantoMultiplier: market.contractSize ?? 1,
      type: market.type ?? 'swap',
      leverage_min: 1,
      leverage_max: 125,
    };
  }

  // ========== Account & Positions ==========

  async getFuturesAccount(): Promise<Account> {
    const balance = await this.exchange.fetchBalance({ type: 'future' });

    const usdt = balance.USDT ?? {};
    const totalBalance = usdt.total ?? 0;
    const freeBalance = usdt.free ?? 0;
    const usedBalance = usdt.used ?? 0;

    // Get unrealized PnL from all positions
    const positions = await this.getPositions();
    const unrealisedPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    return {
      currency: 'USDT',
      totalBalance,
      availableBalance: freeBalance,
      positionMargin: usedBalance,
      orderMargin: 0,
      unrealisedPnl,
      timestamp: Date.now(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const positions = await this.exchange.fetchPositions();

    // Filter only positions with non-zero contracts
    return positions
      .filter((pos: any) => {
        const contracts = parseFloat(pos.contracts ?? '0');
        return contracts !== 0;
      })
      .map((pos: any) => {
        const contracts = parseFloat(pos.contracts ?? '0');
        const side = pos.side === 'long' || contracts > 0 ? 'long' : 'short';
        const quantity = Math.abs(contracts);

        // Calculate leverage from initialMarginPercentage or notional/initialMargin
        // initialMarginPercentage = 1 / leverage
        let leverage = 1;
        if (pos.initialMarginPercentage) {
          leverage = Math.round(1 / pos.initialMarginPercentage);
        } else if (pos.notional && pos.initialMargin && pos.initialMargin > 0) {
          leverage = Math.round(pos.notional / pos.initialMargin);
        }

        return {
          symbol: this.denormalizeSymbol(pos.symbol),
          exchangeSymbol: pos.symbol,
          side,
          quantity,
          entryPrice: parseFloat(pos.entryPrice ?? '0'),
          currentPrice: parseFloat(pos.markPrice ?? pos.entryPrice ?? '0'),
          liquidationPrice: parseFloat(pos.liquidationPrice ?? '0'),
          unrealizedPnl: parseFloat(pos.unrealizedPnl ?? '0'),
          realizedPnl: parseFloat(pos.realizedPnl ?? '0'),
          leverage,
          margin: parseFloat(pos.initialMargin ?? '0'),
          timestamp: pos.timestamp ?? Date.now(),
        };
      });
  }

  // ========== Trading ==========

  async placeOrder(params: OrderParams): Promise<Order> {
    const ccxtSymbol = this.normalizeSymbol(params.symbol);

    // Set leverage if specified
    if (params.leverage) {
      await this.setLeverage(params.symbol, params.leverage);
    }

    // Set margin mode if needed
    await this.setMarginMode(ccxtSymbol);

    // Determine order type and side
    const orderType = params.price ? 'limit' : 'market';
    const side = params.side === 'long' ? 'buy' : 'sell';

    const orderParams: any = {
      reduceOnly: params.reduceOnly ?? params.isReduceOnly ?? false,
    };

    if (params.price) {
      orderParams.price = params.price;
    }

    if (params.tif) {
      orderParams.timeInForce = params.tif;
    }

    const order = await this.exchange.createOrder(
      ccxtSymbol,
      orderType,
      side,
      params.quantity,
      params.price,
      orderParams
    );

    return this.mapOrder(order);
  }

  async cancelOrder(orderId: string): Promise<void> {
    // Note: CCXT requires symbol for Binance cancelOrder
    // We may need to store order->symbol mapping or get it from open orders
    const openOrders = await this.getOpenOrders();
    const order = openOrders.find((o) => o.id === orderId);

    if (!order) {
      throw new Error(`Order ${orderId} not found in open orders`);
    }

    const ccxtSymbol = this.normalizeSymbol(order.symbol);
    await this.exchange.cancelOrder(orderId, ccxtSymbol);
  }

  async getOrder(orderId: string): Promise<Order> {
    // Similar issue: need symbol
    const openOrders = await this.getOpenOrders();
    const order = openOrders.find((o) => o.id === orderId);

    if (!order) {
      // Try to fetch from all symbols - less efficient but works
      // For now, throw error
      throw new Error(`Order ${orderId} not found. CCXT requires symbol for fetchOrder.`);
    }

    const ccxtSymbol = this.normalizeSymbol(order.symbol);
    const fetchedOrder = await this.exchange.fetchOrder(orderId, ccxtSymbol);

    return this.mapOrder(fetchedOrder);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const ccxtSymbol = symbol ? this.normalizeSymbol(symbol) : undefined;
    const orders = await this.exchange.fetchOpenOrders(ccxtSymbol);

    return orders.map((order) => this.mapOrder(order));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    await this.exchange.setLeverage(leverage, ccxtSymbol);
  }

  // ========== Configuration ==========

  getExchangeName(): string {
    return 'Binance';
  }

  isTestnet(): boolean {
    return this.testnet;
  }

  // ========== Helper Methods ==========

  private async setMarginMode(symbol: string): Promise<void> {
    try {
      // Set margin mode (isolated or crossed)
      await this.exchange.setMarginMode(this.marginMode, symbol);
    } catch (error: any) {
      // Ignore error if margin mode is already set
      if (!error.message?.includes('No need to change margin type')) {
        // Log but don't throw - margin mode might already be set
        console.warn(`Failed to set margin mode for ${symbol}:`, error.message);
      }
    }
  }

  private mapOrder(ccxtOrder: any): Order {
    const side = ccxtOrder.side === 'buy' ? 'long' : 'short';
    const filled = parseFloat(ccxtOrder.filled ?? '0');
    const amount = parseFloat(ccxtOrder.amount ?? '0');
    const remaining = parseFloat(ccxtOrder.remaining ?? amount - filled);

    // Map CCXT status to our standard status
    let status = ccxtOrder.status;
    if (status === 'closed') status = 'finished';

    return {
      id: ccxtOrder.id,
      symbol: this.denormalizeSymbol(ccxtOrder.symbol),
      side,
      price: parseFloat(ccxtOrder.average ?? ccxtOrder.price ?? '0'),
      quantity: amount,
      filled,
      remaining,
      status,
      isReduceOnly: ccxtOrder.reduceOnly ?? false,
      timestamp: ccxtOrder.timestamp ?? Date.now(),
    };
  }

  /**
   * Get underlying CCXT exchange instance for advanced usage
   */
  getUnderlyingExchange(): ccxt.binance {
    return this.exchange;
  }
}
