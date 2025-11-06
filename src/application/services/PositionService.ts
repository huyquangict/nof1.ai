/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Position Service
 *
 * Business logic for managing trading positions.
 */

import type { IExchangeClient } from '../../services/exchange/IExchangeClient';
import type { PositionRepository } from '../../infrastructure/database/repositories/position';
import type { TradeRepository } from '../../infrastructure/database/repositories/trade';
import type { TradingLogger } from '../../infrastructure/logger';
import type { SystemConfig } from '../../types/config';
import type {
  OpenPositionParams,
  OpenPositionResult,
  ClosePositionParams,
  ClosePositionResult,
  UpdateStopLossParams,
  UpdateTakeProfitParams,
} from '../../types/services';
import type { Position } from '../../database/schema';
import { PositionNotFoundError, PositionConflictError } from '../../errors';

/**
 * Position Service
 *
 * Handles all position-related business logic including:
 * - Opening new positions
 * - Closing positions
 * - Updating stop-loss and take-profit
 * - Syncing positions from exchange
 */
export class PositionService {
  constructor(
    private readonly exchangeClient: IExchangeClient,
    private readonly positionRepo: PositionRepository,
    private readonly tradeRepo: TradeRepository,
    private readonly logger: TradingLogger,
    private readonly config: SystemConfig
  ) {}

  /**
   * Open a new position
   */
  async openPosition(params: OpenPositionParams): Promise<OpenPositionResult> {
    const { symbol, side, quantity, leverage, stopLossPercent, takeProfitPercent, confidence, riskUsd } = params;

    try {
      this.logger.info(`Opening ${side} position for ${symbol}`, {
        symbol,
        side,
        quantity,
        leverage,
      });

      // 1. Check for existing position
      const existingPosition = await this.positionRepo.findBySymbol(symbol);
      if (existingPosition) {
        throw new PositionConflictError(
          symbol,
          existingPosition.side,
          side
        );
      }

      // 2. Set leverage on exchange
      await this.exchangeClient.setLeverage(symbol, leverage);
      this.logger.info(`Set leverage to ${leverage}x for ${symbol}`, { symbol, leverage });

      // 3. Place market order
      const order = await this.exchangeClient.placeOrder({
        symbol,
        side,
        quantity,
      });

      if (!order || !order.id) {
        return {
          success: false,
          error: 'Failed to place market order',
          message: `Failed to open ${side} position for ${symbol}`,
        };
      }

      const entryPrice = order.price || 0;
      this.logger.positionOpened({
        symbol,
        side,
        quantity,
        price: entryPrice,
        leverage,
        orderId: order.id,
      });

      // 4. Calculate stop-loss price
      const slPercent = stopLossPercent || this.config.risk.positionStopLossPnlPercent;
      const slPriceRaw = side === 'long'
        ? entryPrice * (1 + slPercent / leverage / 100)
        : entryPrice * (1 - slPercent / leverage / 100);

      // Round to appropriate precision
      const slPrice = this.roundPrice(slPriceRaw, symbol);

      // 5. Set stop-loss order on exchange
      let stopLossOrderId: string | undefined;
      try {
        const slSide = side === 'long' ? 'short' : 'long';
        const slOrder = await this.exchangeClient.placeOrder({
          symbol,
          side: slSide,
          quantity,
          stopLoss: slPrice,
          reduceOnly: true,
        });
        stopLossOrderId = slOrder?.id;

        if (stopLossOrderId) {
          this.logger.stopLossSet({
            symbol,
            side,
            quantity,
            stopLossPrice: slPrice,
          });
        }
      } catch (slError: any) {
        this.logger.warn(`Failed to set auto-SL for ${symbol}: ${slError.message}`, {
          symbol,
          error: slError.message,
        });
      }

      // 6. Save position to database
      const position: Omit<Position, 'id'> = {
        symbol,
        quantity,
        entry_price: entryPrice,
        current_price: entryPrice,
        liquidation_price: 0, // Will be updated from exchange sync
        unrealized_pnl: 0,
        leverage,
        side,
        profit_target: takeProfitPercent ? entryPrice * (1 + takeProfitPercent / 100) : undefined,
        stop_loss: slPrice,
        tp_order_id: undefined,
        sl_order_id: stopLossOrderId || undefined,
        tp_percentage: takeProfitPercent || undefined,
        sl_percentage: slPercent,
        tp_orders: undefined,
        sl_orders: stopLossOrderId ? [{ price: slPrice, percentage: 100, orderId: stopLossOrderId }] : undefined,
        entry_order_id: order.id,
        opened_at: new Date().toISOString(),
        confidence: confidence || undefined,
        risk_usd: riskUsd || undefined,
        peak_pnl_percent: 0,
      };

      const createdPosition = await this.positionRepo.create(position);

      // 7. Record trade
      await this.tradeRepo.create({
        order_id: order.id,
        symbol,
        side,
        type: 'open',
        price: entryPrice,
        quantity,
        leverage,
        pnl: undefined,
        fee: 0,
        timestamp: new Date().toISOString(),
        status: 'filled',
        close_reason: undefined,
        entry_order_id: order.id,
      });

      return {
        success: true,
        position: createdPosition,
        order: {
          orderId: order.id,
          symbol,
          side,
          price: entryPrice,
          quantity,
        },
        stopLoss: stopLossOrderId
          ? {
              orderId: stopLossOrderId,
              price: slPrice,
              percentage: slPercent,
            }
          : undefined,
        message: `Successfully opened ${side} position for ${symbol} at ${entryPrice} with ${leverage}x leverage`,
      };
    } catch (error: any) {
      this.logger.error(error, { symbol, side, quantity, operation: 'openPosition' });
      return {
        success: false,
        error: error.message,
        message: `Failed to open ${side} position for ${symbol}: ${error.message}`,
      };
    }
  }

  /**
   * Close an existing position
   */
  async closePosition(params: ClosePositionParams): Promise<ClosePositionResult> {
    const { symbol, reason, partialQuantity } = params;

    try {
      this.logger.info(`Closing position for ${symbol}`, { symbol, reason });

      // 1. Find position in database
      const position = await this.positionRepo.findBySymbol(symbol);
      if (!position) {
        throw new PositionNotFoundError(symbol);
      }

      // 2. Cancel any open SL/TP orders
      if (position.sl_order_id) {
        try {
          await this.exchangeClient.cancelOrder(position.sl_order_id, symbol);
          this.logger.info(`Cancelled SL order ${position.sl_order_id} for ${symbol}`, {
            symbol,
            orderId: position.sl_order_id,
          });
        } catch (cancelError: any) {
          this.logger.warn(`Failed to cancel SL order: ${cancelError.message}`, {
            symbol,
            orderId: position.sl_order_id,
          });
        }
      }

      // Cancel TP orders if any
      if (position.sl_orders && Array.isArray(position.sl_orders)) {
        for (const slOrder of position.sl_orders) {
          if (slOrder.orderId && slOrder.orderId !== position.sl_order_id) {
            try {
              await this.exchangeClient.cancelOrder(slOrder.orderId, symbol);
            } catch (err: any) {
              this.logger.warn(`Failed to cancel SL order ${slOrder.orderId}`, { symbol, error: err.message });
            }
          }
        }
      }

      // 3. Place closing order
      const closeQuantity = partialQuantity || position.quantity;
      const closeSide = position.side === 'long' ? 'short' : 'long';

      const closeOrder = await this.exchangeClient.placeOrder({
        symbol,
        side: closeSide,
        quantity: closeQuantity,
        reduceOnly: true,
      });

      if (!closeOrder || !closeOrder.id) {
        return {
          success: false,
          error: 'Failed to place closing order',
          message: `Failed to close position for ${symbol}`,
        };
      }

      const exitPrice = closeOrder.price || 0;

      // 4. Calculate PnL
      const pnl = this.calculatePnl(
        position.entry_price,
        exitPrice,
        closeQuantity,
        position.leverage,
        position.side
      );

      const pnlPercent = ((exitPrice - position.entry_price) / position.entry_price) * position.leverage * 100 * (position.side === 'long' ? 1 : -1);

      this.logger.positionClosed({
        symbol,
        side: position.side,
        entryPrice: position.entry_price,
        exitPrice,
        quantity: closeQuantity,
        pnl,
        pnlPercent,
        reason,
      });

      // 5. Record trade
      const trade = await this.tradeRepo.create({
        order_id: closeOrder.id,
        symbol,
        side: position.side,
        type: 'close',
        price: exitPrice,
        quantity: closeQuantity,
        leverage: position.leverage,
        pnl,
        fee: 0,
        timestamp: new Date().toISOString(),
        status: 'filled',
        close_reason: reason,
        entry_order_id: position.entry_order_id,
      });

      // 6. Update or delete position
      if (partialQuantity && partialQuantity < position.quantity) {
        // Partial close - update quantity
        const remainingQuantity = position.quantity - partialQuantity;
        await this.positionRepo.update(symbol, {
          quantity: remainingQuantity,
        });
        this.logger.info(`Partially closed position for ${symbol}. Remaining: ${remainingQuantity}`, {
          symbol,
          closedQuantity: partialQuantity,
          remainingQuantity,
        });
      } else {
        // Full close - delete position
        await this.positionRepo.deleteBySymbol(symbol);
        this.logger.info(`Fully closed and removed position for ${symbol}`, { symbol });
      }

      return {
        success: true,
        trade,
        order: {
          orderId: closeOrder.id,
          symbol,
          side: position.side,
          price: exitPrice,
          quantity: closeQuantity,
        },
        pnl: {
          amount: pnl,
          percentage: pnlPercent,
        },
        message: `Successfully closed ${position.side} position for ${symbol}. PnL: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)`,
      };
    } catch (error: any) {
      this.logger.error(error, { symbol, reason, operation: 'closePosition' });
      return {
        success: false,
        error: error.message,
        message: `Failed to close position for ${symbol}: ${error.message}`,
      };
    }
  }

  /**
   * Update stop-loss for a position
   */
  async updateStopLoss(params: UpdateStopLossParams): Promise<boolean> {
    const { symbol, newStopLossPercent, reason } = params;

    try {
      const position = await this.positionRepo.findBySymbol(symbol);
      if (!position) {
        throw new PositionNotFoundError(symbol);
      }

      // Calculate new SL price
      const newSlPrice =
        position.side === 'long'
          ? position.entry_price * (1 + newStopLossPercent / position.leverage / 100)
          : position.entry_price * (1 - newStopLossPercent / position.leverage / 100);

      const roundedSlPrice = this.roundPrice(newSlPrice, symbol);

      // Cancel old SL order
      if (position.sl_order_id) {
        try {
          await this.exchangeClient.cancelOrder(position.sl_order_id, symbol);
        } catch (err: any) {
          this.logger.warn(`Failed to cancel old SL order: ${err.message}`, { symbol });
        }
      }

      // Place new SL order
      const slSide = position.side === 'long' ? 'short' : 'long';
      const slOrder = await this.exchangeClient.placeOrder({
        symbol,
        side: slSide,
        quantity: position.quantity,
        stopLoss: roundedSlPrice,
        reduceOnly: true,
      });

      // Update database
      await this.positionRepo.update(symbol, {
        stop_loss: roundedSlPrice,
        sl_order_id: slOrder?.id || undefined,
        sl_percentage: newStopLossPercent,
      });

      this.logger.positionUpdated({
        symbol,
        side: position.side,
        quantity: position.quantity,
        updateType: `Stop-loss adjusted from ${position.stop_loss} to ${roundedSlPrice} (${reason})`,
      });

      return true;
    } catch (error: any) {
      this.logger.error(error, { symbol, operation: 'updateStopLoss' });
      return false;
    }
  }

  /**
   * Update take-profit orders for a position
   */
  async updateTakeProfit(params: UpdateTakeProfitParams): Promise<boolean> {
    const { symbol, takeProfitOrders, reason } = params;

    try {
      const position = await this.positionRepo.findBySymbol(symbol);
      if (!position) {
        throw new PositionNotFoundError(symbol);
      }

      // Cancel existing TP orders
      if (position.tp_orders && Array.isArray(position.tp_orders)) {
        for (const tpOrder of position.tp_orders) {
          if (tpOrder.orderId) {
            try {
              await this.exchangeClient.cancelOrder(tpOrder.orderId, symbol);
            } catch (err: any) {
              this.logger.warn(`Failed to cancel TP order ${tpOrder.orderId}`, { symbol });
            }
          }
        }
      }

      // Place new TP orders
      const newTpOrders: any[] = [];
      for (const tpOrder of takeProfitOrders) {
        const tpSide = position.side === 'long' ? 'short' : 'long';
        const placedOrder = await this.exchangeClient.placeOrder({
          symbol,
          side: tpSide,
          quantity: tpOrder.quantity,
          price: tpOrder.price,
          reduceOnly: true,
        });

        newTpOrders.push({
          price: tpOrder.price,
          quantity: tpOrder.quantity,
          orderId: placedOrder?.id || undefined,
        });
      }

      // Update database
      await this.positionRepo.updateTpOrders(symbol, newTpOrders);

      this.logger.positionUpdated({
        symbol,
        side: position.side,
        quantity: position.quantity,
        updateType: `Take-profit adjusted: ${newTpOrders.length} orders (${reason})`,
      });

      return true;
    } catch (error: any) {
      this.logger.error(error, { symbol, operation: 'updateTakeProfit' });
      return false;
    }
  }

  /**
   * Get all active positions
   */
  async getActivePositions(): Promise<Position[]> {
    return this.positionRepo.findAllPositions();
  }

  /**
   * Get position by symbol
   */
  async getPosition(symbol: string): Promise<Position | null> {
    return this.positionRepo.findBySymbol(symbol);
  }

  /**
   * Sync position from exchange
   */
  async syncPositionFromExchange(symbol: string): Promise<void> {
    try {
      const exchangePositions = await this.exchangeClient.getPositions();
      const exchangePosition = exchangePositions.find((p) => p.symbol === symbol);

      if (!exchangePosition || exchangePosition.quantity === 0) {
        // Position doesn't exist on exchange, remove from database
        await this.positionRepo.deleteBySymbol(symbol);
        this.logger.info(`Removed position ${symbol} (not found on exchange)`, { symbol });
        return;
      }

      // Update database with exchange data
      const dbPosition = await this.positionRepo.findBySymbol(symbol);
      if (dbPosition) {
        await this.positionRepo.update(symbol, {
          current_price: exchangePosition.currentPrice || exchangePosition.entryPrice,
          unrealized_pnl: exchangePosition.unrealizedPnl || 0,
          liquidation_price: exchangePosition.liquidationPrice || 0,
        });
        this.logger.info(`Synced position ${symbol} from exchange`, { symbol });
      }
    } catch (error: any) {
      this.logger.error(error, { symbol, operation: 'syncPositionFromExchange' });
      throw error;
    }
  }

  /**
   * Calculate PnL for a position
   */
  private calculatePnl(
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    leverage: number,
    side: 'long' | 'short'
  ): number {
    const priceChange = side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
    return (priceChange / entryPrice) * leverage * quantity * entryPrice;
  }

  /**
   * Round price to appropriate precision
   */
  private roundPrice(price: number, symbol: string): number {
    // Most crypto pairs use 2-4 decimal places
    // BTC/ETH typically use 1-2, altcoins use 3-4
    const decimals = price > 1000 ? 1 : price > 10 ? 2 : 4;
    return Math.round(price * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }
}
