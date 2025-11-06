/**
 * Position Synchronizer Module
 * Handles synchronization of positions between exchange and database
 * Detects and records stop-loss and take-profit triggers
 */

import { createPinoLogger } from "@voltagent/logger";
import type { Client } from "@libsql/client";
import type { IExchangeClient, Position } from "../../../services/exchange/IExchangeClient";
import { getQuantoMultiplier } from "../../../utils/contractUtils";

const logger = createPinoLogger({
  name: "position-sync",
  level: "info",
});

/**
 * Position synchronizer class - handles all position sync logic
 */
export class PositionSynchronizer {
  constructor(
    private exchangeClient: IExchangeClient,
    private database: Client
  ) {}

  /**
   * Main synchronization method
   * Syncs positions from exchange to database, detecting SL/TP triggers
   */
  async syncPositions(cachedPositions?: Position[]): Promise<void> {
    try {
      // Fetch positions (use cached if available)
      const positions = cachedPositions || await this.exchangeClient.getPositions();

      // Get existing DB positions
      const dbResult = await this.database.execute(
        "SELECT symbol, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, stop_loss, profit_target, entry_order_id, opened_at FROM positions"
      );
      const dbPositionsMap = new Map(
        dbResult.rows.map((row: any) => [row.symbol, row])
      );

      // Safety check: Don't clear DB if exchange returns 0 but DB has positions (API delay)
      if (positions.length === 0 && dbResult.rows.length > 0) {
        logger.warn(
          `Warning: Exchange returned 0 positions, but database has ${dbResult.rows.length} positions, possibly API delay, skipping sync`
        );
        return;
      }

      // Detect closed positions (in DB but not on exchange) - check for SL/TP triggers
      await this.detectClosedPositions(positions, dbResult.rows);

      // Check TP orders for ALL positions (including still-open ones)
      await this.checkTakeProfitOrders(dbResult.rows);

      // Re-query to get updated tp_orders with triggered status
      const updatedDbResult = await this.database.execute(
        "SELECT symbol, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, stop_loss, profit_target, entry_order_id, opened_at FROM positions"
      );
      const updatedDbPositionsMap = new Map(
        updatedDbResult.rows.map((row: any) => [row.symbol, row])
      );

      // Clear and repopulate positions table
      await this.database.execute("DELETE FROM positions");

      let syncedCount = 0;
      for (const pos of positions) {
        await this.insertPosition(pos, updatedDbPositionsMap);
        syncedCount++;
      }

      // Validate sync success
      const activePositionsCount = positions.length;
      if (activePositionsCount > 0 && syncedCount === 0) {
        logger.error(
          `Exchange has ${activePositionsCount} positions, but database sync failed!`
        );
      }
    } catch (error) {
      logger.error("Failed to sync positions:", error as any);
    }
  }

  /**
   * Detect positions that were closed (in DB but not on exchange)
   * Check if they were closed by stop-loss or take-profit orders
   */
  private async detectClosedPositions(
    exchangePositions: Position[],
    dbRows: any[]
  ): Promise<void> {
    const exchangeSymbols = new Set(exchangePositions.map(p => p.symbol));

    for (const dbRow of dbRows) {
      const dbSymbol = (dbRow as any).symbol;

      // Position exists in DB but not on exchange - it was closed
      if (!exchangeSymbols.has(dbSymbol)) {
        const slOrderId = (dbRow as any).sl_order_id;
        const tpOrderId = (dbRow as any).tp_order_id;
        const entryOrderId = (dbRow as any).entry_order_id;

        // Get entry trade data for PnL calculation
        const entryData = await this.getEntryTradeData(entryOrderId, dbSymbol);

        // Check stop-loss trigger
        if (slOrderId) {
          await this.checkStopLossTrigger(slOrderId, dbSymbol, entryData, entryOrderId);
        }

        // Check take-profit trigger (multiple formats supported)
        await this.checkTakeProfitTrigger(
          dbSymbol,
          tpOrderId,
          (dbRow as any).tp_orders,
          entryData,
          entryOrderId
        );
      }
    }
  }

  /**
   * Get entry trade data for PnL calculations
   */
  private async getEntryTradeData(entryOrderId: string, symbol: string): Promise<{
    entryPrice: number;
    quantity: number;
    leverage: number;
    side: 'long' | 'short';
  }> {
    const defaultData = {
      entryPrice: 0,
      quantity: 0,
      leverage: 1,
      side: 'long' as const,
    };

    if (!entryOrderId) {
      return defaultData;
    }

    try {
      const entryTradeResult = await this.database.execute({
        sql: "SELECT price, quantity, leverage, side FROM trades WHERE order_id = ? AND type = 'open'",
        args: [entryOrderId]
      });

      if (entryTradeResult.rows.length > 0) {
        const entryTrade = entryTradeResult.rows[0] as any;
        return {
          entryPrice: parseFloat(entryTrade.price),
          quantity: parseFloat(entryTrade.quantity),
          leverage: parseInt(entryTrade.leverage),
          side: entryTrade.side,
        };
      }
    } catch (err) {
      logger.warn(`Could not fetch entry trade for ${symbol}: ${(err as any).message}`);
    }

    return defaultData;
  }

  /**
   * Check if stop-loss order was triggered
   */
  private async checkStopLossTrigger(
    slOrderId: string,
    symbol: string,
    entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
    entryOrderId: string
  ): Promise<void> {
    try {
      const order = await this.exchangeClient.getOrder(slOrderId, symbol);

      // Check if order was filled
      if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
        // Check if already recorded (prevent duplicates)
        const existingTrade = await this.database.execute({
          sql: 'SELECT order_id FROM trades WHERE order_id = ?',
          args: [slOrderId]
        });

        if (existingTrade.rows.length > 0) {
          logger.debug(`SL ${slOrderId} already recorded, skipping`);
          return;
        }

        logger.info(
          `🛑 Stop-loss TRIGGERED for ${symbol} (order ${slOrderId}) - Position closed automatically by exchange`
        );

        // Calculate PnL
        const quantoMultiplier = await getQuantoMultiplier(symbol);
        const exitNotional = order.price * entryData.quantity * quantoMultiplier;
        const exitFee = exitNotional * 0.0005;

        let pnl = 0;
        if (entryData.entryPrice > 0 && order.price > 0) {
          const priceChange = entryData.side === 'long'
            ? (order.price - entryData.entryPrice)
            : (entryData.entryPrice - order.price);
          pnl = priceChange * entryData.quantity * quantoMultiplier;

          const entryNotional = entryData.entryPrice * entryData.quantity * quantoMultiplier;
          const entryFee = entryNotional * 0.0005;
          pnl = pnl - entryFee - exitFee;
        }

        // Record close trade
        await this.database.execute({
          sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
          args: [
            slOrderId,
            symbol,
            entryData.side,
            order.price,
            entryData.quantity,
            entryData.leverage,
            pnl,
            exitFee,
            new Date().toISOString(),
            'stop_loss',
            entryOrderId
          ]
        });

        // Record in agent decisions
        await this.database.execute({
          sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                VALUES (?, 0, 'Stop-loss triggered', 'Stop-loss executed', ?, 0, 0)`,
          args: [
            new Date().toISOString(),
            `Stop-loss TRIGGERED: ${symbol} at ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${slOrderId})`
          ]
        });
      }
    } catch (orderError) {
      logger.debug(`Could not fetch stop-loss order ${slOrderId} for ${symbol}: ${(orderError as any).message}`);
    }
  }

  /**
   * Check take-profit trigger - supports both old and new formats
   */
  private async checkTakeProfitTrigger(
    symbol: string,
    tpOrderId: string | null,
    tpOrdersStr: string | null,
    entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
    entryOrderId: string
  ): Promise<void> {
    // New format: multiple TP orders in JSON array
    if (tpOrdersStr) {
      try {
        const tpOrders = JSON.parse(tpOrdersStr);
        for (const tp of tpOrders) {
          if (!tp.triggered) {
            await this.checkSingleTakeProfitOrder(
              symbol,
              tp.orderId,
              entryData,
              entryOrderId,
              tp.percentage,
              tp.price
            );
          }
        }
      } catch (parseError) {
        logger.warn(`Failed to parse tp_orders for ${symbol}, falling back to old format`);
        // Fallback to old format
        if (tpOrderId) {
          await this.checkSingleTakeProfitOrder(symbol, tpOrderId, entryData, entryOrderId);
        }
      }
    } else if (tpOrderId) {
      // Old format: single TP in tp_order_id field
      await this.checkSingleTakeProfitOrder(symbol, tpOrderId, entryData, entryOrderId);
    }
  }

  /**
   * Check a single take-profit order
   */
  private async checkSingleTakeProfitOrder(
    symbol: string,
    orderId: string,
    entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
    entryOrderId: string,
    percentage?: number,
    targetPrice?: number
  ): Promise<void> {
    try {
      const order = await this.exchangeClient.getOrder(orderId, symbol);

      if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
        // Check if already recorded
        const existingTrade = await this.database.execute({
          sql: 'SELECT order_id FROM trades WHERE order_id = ?',
          args: [orderId]
        });

        if (existingTrade.rows.length > 0) {
          logger.debug(`TP ${orderId} already recorded, skipping`);
          return;
        }

        const tpInfo = percentage
          ? `(${percentage}% @ ${targetPrice})`
          : '';
        logger.info(`🎯 Take-profit TRIGGERED for ${symbol} ${tpInfo} (order ${orderId})`);

        // Calculate PnL
        const quantoMultiplier = await getQuantoMultiplier(symbol);
        const actualQuantity = percentage
          ? entryData.quantity * (percentage / 100)
          : entryData.quantity;

        const exitNotional = order.price * actualQuantity * quantoMultiplier;
        const exitFee = exitNotional * 0.0005;

        let pnl = 0;
        if (entryData.entryPrice > 0 && order.price > 0) {
          const priceChange = entryData.side === 'long'
            ? (order.price - entryData.entryPrice)
            : (entryData.entryPrice - order.price);
          pnl = priceChange * actualQuantity * quantoMultiplier;

          const entryNotional = entryData.entryPrice * actualQuantity * quantoMultiplier;
          const entryFee = entryNotional * 0.0005;
          pnl = pnl - entryFee - exitFee;
        }

        // Record close trade
        const closeReason = percentage ? 'take_profit_partial' : 'take_profit';
        await this.database.execute({
          sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
          args: [
            orderId,
            symbol,
            entryData.side,
            order.price,
            actualQuantity,
            entryData.leverage,
            pnl,
            exitFee,
            new Date().toISOString(),
            closeReason,
            entryOrderId
          ]
        });

        // Record in agent decisions
        const tpDescription = percentage
          ? `${symbol} ${percentage}% @ ${order.price}`
          : `${symbol} at ${order.price}`;
        await this.database.execute({
          sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
          args: [
            new Date().toISOString(),
            `Take-profit TRIGGERED: ${tpDescription} (PnL: ${pnl.toFixed(2)} USDT, order ${orderId})`
          ]
        });
      }
    } catch (orderError) {
      logger.debug(`Could not fetch TP order ${orderId} for ${symbol}: ${(orderError as any).message}`);
    }
  }

  /**
   * Check take-profit orders for ALL positions (including still-open ones)
   */
  private async checkTakeProfitOrders(dbRows: any[]): Promise<void> {
    logger.debug('Checking take-profit orders for all positions...');

    for (const dbRow of dbRows) {
      const dbSymbol = (dbRow as any).symbol;
      const tpOrdersStr = (dbRow as any).tp_orders;
      const entryOrderId = (dbRow as any).entry_order_id;

      // Skip if no TP orders
      if (!tpOrdersStr) continue;

      // Get entry trade data
      const entryData = await this.getEntryTradeData(entryOrderId, dbSymbol);

      // Parse and check TP orders
      try {
        const tpOrders = JSON.parse(tpOrdersStr);
        for (const tp of tpOrders) {
          if (!tp.triggered) {
            try {
              const order = await this.exchangeClient.getOrder(tp.orderId, dbSymbol);

              // Check if order was filled
              if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
                // Check if already recorded
                const existingTrade = await this.database.execute({
                  sql: 'SELECT order_id FROM trades WHERE order_id = ?',
                  args: [tp.orderId]
                });

                if (existingTrade.rows.length > 0) {
                  logger.debug(`TP ${tp.orderId} already recorded, marking as triggered`);
                  tp.triggered = true;
                  await this.database.execute({
                    sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                    args: [JSON.stringify(tpOrders), dbSymbol]
                  });
                  continue;
                }

                logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol} (${tp.percentage}% @ ${tp.price}, order ${tp.orderId})`);

                // Calculate PnL for partial TP
                const quantoMultiplier = await getQuantoMultiplier(dbSymbol);
                const actualQuantity = entryData.quantity * (tp.percentage / 100);

                let pnl = 0;
                if (entryData.entryPrice > 0 && order.price > 0) {
                  const priceChange = entryData.side === 'long'
                    ? (order.price - entryData.entryPrice)
                    : (entryData.entryPrice - order.price);
                  pnl = priceChange * actualQuantity * quantoMultiplier;

                  const entryNotional = entryData.entryPrice * actualQuantity * quantoMultiplier;
                  const exitNotional = order.price * actualQuantity * quantoMultiplier;
                  const entryFee = entryNotional * 0.0005;
                  const exitFee = exitNotional * 0.0005;
                  pnl = pnl - entryFee - exitFee;
                }

                // Record close trade (partial close)
                await this.database.execute({
                  sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                        VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', 'take_profit_partial', ?)`,
                  args: [
                    tp.orderId,
                    dbSymbol,
                    entryData.side,
                    order.price,
                    actualQuantity,
                    entryData.leverage,
                    pnl,
                    order.price * actualQuantity * quantoMultiplier * 0.0005,
                    new Date().toISOString(),
                    entryOrderId
                  ]
                });

                // Record in agent decisions
                await this.database.execute({
                  sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
                        VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
                  args: [
                    new Date().toISOString(),
                    `Take-profit TRIGGERED: ${dbSymbol} ${tp.percentage}% @ ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${tp.orderId})`
                  ]
                });

                // Mark this TP as triggered
                tp.triggered = true;
                await this.database.execute({
                  sql: 'UPDATE positions SET tp_orders = ? WHERE symbol = ?',
                  args: [JSON.stringify(tpOrders), dbSymbol]
                });
              }
            } catch (orderError) {
              logger.debug(`Could not fetch TP order ${tp.orderId} for ${dbSymbol}: ${(orderError as any).message}`);
            }
          }
        }
      } catch (parseError) {
        logger.debug(`Failed to parse tp_orders for ${dbSymbol}: ${(parseError as any).message}`);
      }
    }
  }

  /**
   * Insert a position into the database, preserving metadata from previous sync
   */
  private async insertPosition(
    pos: Position,
    dbPositionsMap: Map<string, any>
  ): Promise<void> {
    const symbol = pos.symbol;
    let entryPrice = pos.entryPrice;
    let currentPrice = pos.currentPrice;
    const leverage = pos.leverage;
    const side = pos.side;
    const quantity = pos.quantity;
    const unrealizedPnl = pos.unrealizedPnl;
    let liquidationPrice = pos.liquidationPrice;

    // Fill in missing prices
    if (entryPrice === 0 || currentPrice === 0) {
      try {
        const ticker = await this.exchangeClient.getFuturesTicker(symbol);
        if (currentPrice === 0) {
          currentPrice = ticker.markPrice;
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice;
        }
      } catch (error) {
        logger.error(`Failed to fetch ${symbol} ticker:`, error as any);
      }
    }

    // Calculate liquidation price if missing
    if (liquidationPrice === 0 && entryPrice > 0) {
      liquidationPrice = side === "long"
        ? entryPrice * (1 - 0.9 / leverage)
        : entryPrice * (1 + 0.9 / leverage);
    }

    const dbPos = dbPositionsMap.get(symbol);

    // Preserve original entry_order_id and opened_at
    const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;

    await this.database.execute({
      sql: `INSERT INTO positions
            (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
             leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, entry_order_id, opened_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        symbol,
        quantity,
        entryPrice,
        currentPrice,
        liquidationPrice,
        unrealizedPnl,
        leverage,
        side,
        dbPos?.stop_loss || null,
        dbPos?.profit_target || null,
        dbPos?.sl_order_id || null,
        dbPos?.tp_order_id || null,
        dbPos?.sl_percentage || null,
        dbPos?.tp_percentage || null,
        dbPos?.tp_orders || null,
        dbPos?.sl_orders || null,
        entryOrderId,
        dbPos?.opened_at || new Date().toISOString(),
      ],
    });
  }
}

/**
 * Factory function to create position synchronizer
 */
export function createPositionSynchronizer(
  exchangeClient: IExchangeClient,
  database: Client
): PositionSynchronizer {
  return new PositionSynchronizer(exchangeClient, database);
}
