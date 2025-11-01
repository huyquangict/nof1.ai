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
 * Gate.io Exchange Adapter
 *
 * Wraps the existing GateClient to implement the IExchangeClient interface.
 * This provides a standardized interface for Gate.io while maintaining
 * all existing functionality.
 */

import { GateClient } from '../gateClient';
import {
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

export class GateAdapter implements IExchangeClient {
  private client: GateClient;
  private testnet: boolean;

  constructor(apiKey: string, apiSecret: string, testnet: boolean = false) {
    this.client = new GateClient(apiKey, apiSecret);
    this.testnet = testnet;
  }

  // ========== Market Data ==========

  async getFuturesTicker(symbol: string): Promise<Ticker> {
    const contract = this.normalizeSymbol(symbol);
    const raw = await this.client.getFuturesTicker(contract);

    return {
      symbol,
      lastPrice: parseFloat(raw.last || "0"),
      markPrice: parseFloat(raw.markPrice || raw.last || "0"),
      indexPrice: parseFloat(raw.indexPrice || raw.last || "0"),
      change24h: parseFloat(raw.change_percentage || "0"),
      volume24h: parseFloat(raw.volume_24h || "0"),
      timestamp: Date.now(),
    };
  }

  async getFuturesCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const contract = this.normalizeSymbol(symbol);
    const rawCandles = await this.client.getFuturesCandles(contract, interval, limit);

    return rawCandles.map((c: any) => ({
      timestamp: c.t ? c.t * 1000 : Date.now(), // Convert to milliseconds
      open: parseFloat(c.o || "0"),
      high: parseFloat(c.h || "0"),
      low: parseFloat(c.l || "0"),
      close: parseFloat(c.c || "0"),
      volume: parseFloat(c.v || "0"),
    }));
  }

  async getFundingRate(symbol: string): Promise<FundingRate> {
    const contract = this.normalizeSymbol(symbol);
    const raw = await this.client.getFundingRate(contract);

    return {
      symbol,
      rate: parseFloat(raw.r || "0"),
      timestamp: raw.t ? raw.t * 1000 : Date.now(),
      nextFundingTime: undefined, // Gate.io doesn't provide this in funding rate endpoint
    };
  }

  async getOrderBook(symbol: string, limit: number): Promise<OrderBook> {
    const contract = this.normalizeSymbol(symbol);
    const raw = await this.client.getOrderBook(contract, limit);

    return {
      symbol,
      bids: (raw.bids || []).map((b: any) => [parseFloat(b.p), parseFloat(b.s)]),
      asks: (raw.asks || []).map((a: any) => [parseFloat(a.p), parseFloat(a.s)]),
      timestamp: Date.now(),
    };
  }

  async getContractInfo(symbol: string): Promise<ContractInfo> {
    const contract = this.normalizeSymbol(symbol);
    const raw = await this.client.getContractInfo(contract);

    return {
      symbol,
      exchangeSymbol: contract,
      orderSizeMin: parseFloat(raw.orderSizeMin || "1"),
      orderSizeMax: parseFloat(raw.orderSizeMax || "1000000"),
      quantoMultiplier: parseFloat(raw.quanto_multiplier || "1"),
      type: raw.type || "direct",
      leverage_min: parseFloat(raw.leverage_min || "1"),
      leverage_max: parseFloat(raw.leverage_max || "100"),
    };
  }

  // ========== Account & Positions ==========

  async getFuturesAccount(): Promise<Account> {
    const raw = await this.client.getFuturesAccount();

    // Gate.io specific: account.total doesn't include unrealized PnL
    // We need to add it to get the true total balance
    const baseTotal = parseFloat(raw.total || "0");
    const unrealisedPnl = parseFloat(raw.unrealisedPnl || "0");

    return {
      currency: raw.currency || "USDT",
      totalBalance: baseTotal + unrealisedPnl, // Include unrealized PnL in total
      availableBalance: parseFloat(raw.available || "0"),
      positionMargin: parseFloat(raw.positionMargin || "0"),
      orderMargin: parseFloat(raw.orderMargin || "0"),
      unrealisedPnl,
      timestamp: Date.now(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const rawPositions = await this.client.getPositions();

    return rawPositions
      .filter((p: any) => parseInt(p.size || "0") !== 0)
      .map((p: any) => {
        const size = parseInt(p.size || "0");

        return {
          symbol: this.denormalizeSymbol(p.contract),
          exchangeSymbol: p.contract,
          side: size > 0 ? 'long' : 'short' as 'long' | 'short',
          quantity: Math.abs(size),
          entryPrice: parseFloat(p.entryPrice || "0"),
          currentPrice: parseFloat(p.markPrice || "0"),
          liquidationPrice: parseFloat(p.liqPrice || "0"),
          unrealizedPnl: parseFloat(p.unrealisedPnl || "0"),
          realizedPnl: parseFloat(p.realisedPnl || "0"),
          leverage: parseInt(p.leverage || "1"),
          margin: parseFloat(p.margin || "0"),
          timestamp: Date.now(),
        };
      });
  }

  // ========== Trading ==========

  async placeOrder(params: OrderParams): Promise<Order> {
    const contract = this.normalizeSymbol(params.symbol);

    // Convert side to size (Gate.io uses signed size)
    const size = params.side === 'long' ? params.quantity : -params.quantity;

    const rawOrder = await this.client.placeOrder({
      contract,
      size,
      price: params.price,
      tif: params.tif,
      reduceOnly: params.reduceOnly,
      autoSize: params.autoSize,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
    });

    return {
      id: rawOrder.id?.toString() || "",
      symbol: params.symbol,
      side: params.side,
      price: parseFloat(rawOrder.price || "0"),
      quantity: Math.abs(parseFloat(rawOrder.size || "0")),
      filled: Math.abs(parseFloat(rawOrder.size || "0") - parseFloat(rawOrder.left || "0")),
      remaining: Math.abs(parseFloat(rawOrder.left || "0")),
      status: rawOrder.status || "open",
      isReduceOnly: rawOrder.is_reduce_only || false,
      timestamp: rawOrder.create_time ? rawOrder.create_time * 1000 : Date.now(),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async getOrder(orderId: string): Promise<Order> {
    const raw = await this.client.getOrder(orderId);
    const size = parseInt(raw.size || "0");

    return {
      id: raw.id?.toString() || orderId,
      symbol: this.denormalizeSymbol(raw.contract || ""),
      side: size > 0 ? 'long' : 'short',
      price: parseFloat(raw.price || "0"),
      quantity: Math.abs(size),
      filled: Math.abs(size - parseInt(raw.left || "0")),
      remaining: Math.abs(parseInt(raw.left || "0")),
      status: raw.status || "unknown",
      isReduceOnly: raw.is_reduce_only || false,
      timestamp: raw.create_time ? raw.create_time * 1000 : Date.now(),
    };
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const contract = symbol ? this.normalizeSymbol(symbol) : undefined;
    const rawOrders = await this.client.getOpenOrders(contract);

    return rawOrders.map((raw: any) => {
      const size = parseInt(raw.size || "0");

      return {
        id: raw.id?.toString() || "",
        symbol: this.denormalizeSymbol(raw.contract || ""),
        side: size > 0 ? 'long' : 'short' as 'long' | 'short',
        price: parseFloat(raw.price || "0"),
        quantity: Math.abs(size),
        filled: Math.abs(size - parseInt(raw.left || "0")),
        remaining: Math.abs(parseInt(raw.left || "0")),
        status: raw.status || "open",
        isReduceOnly: raw.is_reduce_only || false,
        timestamp: raw.create_time ? raw.create_time * 1000 : Date.now(),
      };
    });
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const contract = this.normalizeSymbol(symbol);
    await this.client.setLeverage(contract, leverage);
  }

  // ========== Configuration ==========

  getExchangeName(): string {
    return 'gateio';
  }

  isTestnet(): boolean {
    return this.testnet;
  }

  normalizeSymbol(symbol: string): string {
    // Convert "BTC" -> "BTC_USDT"
    if (symbol.includes('_USDT')) {
      return symbol; // Already normalized
    }
    return `${symbol}_USDT`;
  }

  denormalizeSymbol(exchangeSymbol: string): string {
    // Convert "BTC_USDT" -> "BTC"
    return exchangeSymbol.replace('_USDT', '');
  }

  // ========== Internal Helper ==========

  /**
   * Get the underlying GateClient instance
   * Useful for backward compatibility or accessing Gate.io-specific features
   */
  getUnderlyingClient(): GateClient {
    return this.client;
  }
}
