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
 * Profit Manager - Automated profit protection and SL/TP management
 *
 * Runs every 30 seconds to:
 * - Detect closed positions and record SL/TP triggers to trade history
 * - Auto-adjust trailing take-profit orders (single TP for 100% position)
 * - Enforce 36-hour maximum holding time
 * - Peak drawdown protection (30% retracement from peak)
 * - Monitor and maintain SL orders
 *
 * Fully automated - no AI intervention needed for SL/TP management.
 * Consolidates monitoring that was previously split between profit manager and position sync.
 */

import type { Logger } from "pino";
import { createContainer } from "../container";
import { createServices } from "../application/services";
import { createRepositories } from "../infrastructure/database/repositories";
import type { TakeProfitOrder } from "../database/schema";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { updateReflectionOnClose } from "../learning/reflections/updateOnClose";

// Initialize container and services
const container = createContainer();
const { exchangeClient, database: dbClient, logger: tradingLogger } = container;
const services = createServices(
  container.exchangeClient,
  container.database,
  container.logger,
  container.config
);
const repos = createRepositories(container.database, container.logger);

export async function runProfitManager(logger: Logger): Promise<void> {
  try {
    logger.info("💰 Profit manager check started");

    // Step 1: Detect closed positions and check for SL/TP triggers
    await detectClosedPositions(logger);

    // Step 2: Get all active positions using repository
    const positions = await repos.position.findAllPositions();

    if (positions.length === 0) {
      logger.info("No active positions to monitor");
      return;
    }

    logger.info(`Monitoring ${positions.length} position(s) for risk violations`);

    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side;
      const leverage = pos.leverage;
      const entryPrice = pos.entry_price;
      const currentPrice = pos.current_price;

      // Calculate P&L percentage (considering leverage)
      const priceChangePercent = entryPrice > 0
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;

      // Get and update peak profit using repository
      let peakPnlPercent = Number(pos.peak_pnl_percent) || 0;

      if (pnlPercent > peakPnlPercent) {
        peakPnlPercent = pnlPercent;
        await repos.position.update(symbol, { peak_pnl_percent: peakPnlPercent });
        logger.info(`📈 ${symbol} new peak profit: ${peakPnlPercent.toFixed(2)}%`);
      }

      // Use RiskService to check if position should close
      const riskMetrics = await services.risk.getPositionRiskMetrics(symbol);

      if (riskMetrics && riskMetrics.shouldClose) {
        // Close position using service
        logger.warn(`⚠️  ${symbol} triggered forced liquidation: ${riskMetrics.closeReason}`);

        let closeReason: 'time_limit' | 'drawdown' | 'stop_loss' = 'time_limit';
        if (riskMetrics.closeReason?.includes('drawdown')) {
          closeReason = 'drawdown';
        } else if (riskMetrics.closeReason?.includes('Stop-loss')) {
          closeReason = 'stop_loss';
        }

        const result = await services.position.closePosition({
          symbol,
          reason: closeReason,
        });

        if (result.success) {
          logger.info(`✅ ${symbol}: ${result.message}`);
        } else {
          logger.error(`❌ ${symbol}: Failed to close position: ${result.error}`);
        }

        continue; // Skip TP adjustment if closing
      }

      // Auto-adjust trailing take-profit order (custom logic)
      let trailingStopPercent = -100;

      if (pnlPercent >= 25) {
        trailingStopPercent = 15;
      } else if (pnlPercent >= 15) {
        trailingStopPercent = 8;
      } else if (pnlPercent >= 8) {
        trailingStopPercent = 3;
      }

      // If trailing threshold active, adjust TP order
      if (trailingStopPercent > -100) {
        try {
          // Calculate trailing stop price from entry price
          const trailingPriceChange = (trailingStopPercent / leverage) / 100;
          let trailingTpPrice: number;

          if (side === 'long') {
            // LONG: TP price should be BELOW current price (sell when price drops)
            trailingTpPrice = entryPrice * (1 + trailingPriceChange);
          } else {
            // SHORT: TP price should be ABOVE current price (buy when price rises)
            trailingTpPrice = entryPrice * (1 - trailingPriceChange);
          }

          // Get current TP orders from position
          let currentTpOrders: TakeProfitOrder[] = [];
          if (pos.tp_orders) {
            try {
              currentTpOrders = Array.isArray(pos.tp_orders)
                ? pos.tp_orders
                : JSON.parse(pos.tp_orders as any);
            } catch (e) {
              // Invalid JSON, treat as empty
            }
          }

          // Check if we need to adjust TP
          let needsAdjustment = false;
          if (currentTpOrders.length === 0) {
            needsAdjustment = true;
            logger.info(`${symbol}: No TP order exists, will create trailing TP at ${trailingTpPrice.toFixed(4)}`);
          } else {
            // Check if existing TP is worse than trailing stop
            const currentTp = currentTpOrders[0];
            const currentTpPnl = side === 'long'
              ? ((currentTp.price - entryPrice) / entryPrice * 100) * leverage
              : ((entryPrice - currentTp.price) / entryPrice * 100) * leverage;

            if (currentTpPnl < trailingStopPercent) {
              needsAdjustment = true;
              logger.info(`${symbol}: Current TP at ${currentTpPnl.toFixed(2)}% < trailing stop ${trailingStopPercent}%, will adjust to ${trailingTpPrice.toFixed(4)}`);
            }
          }

          if (needsAdjustment) {
            // Cancel all existing TP orders
            for (const tp of currentTpOrders) {
              if (tp.orderId && !tp.triggered) {
                try {
                  await exchangeClient.cancelOrder(tp.orderId, symbol);
                  logger.info(`${symbol}: Cancelled old TP order ${tp.orderId}`);
                } catch (e: any) {
                  logger.warn(`${symbol}: Could not cancel TP ${tp.orderId}: ${e.message}`);
                }
              }
            }

            // Get current position quantity from exchange
            const exchangePositions = await exchangeClient.getPositions();
            const currentPosition = exchangePositions.find(p => p.symbol === symbol);

            if (currentPosition && currentPosition.quantity > 0) {
              // Place new trailing TP order for 100% of position
              const tpQuantity = currentPosition.quantity;
              const orderSide = side === 'long' ? 'short' : 'long';

              const exchangeName = exchangeClient.getExchangeName();

              if (exchangeName === 'Binance') {
                const binanceAdapter = exchangeClient as any;
                const ccxt = binanceAdapter.getUnderlyingExchange();
                const ccxtSymbol = exchangeClient.normalizeSymbol(symbol);

                const order = await ccxt.createOrder(
                  ccxtSymbol,
                  'TAKE_PROFIT_MARKET',
                  orderSide === 'long' ? 'buy' : 'sell',
                  tpQuantity,
                  undefined,
                  {
                    stopPrice: trailingTpPrice,
                    reduceOnly: true,
                  }
                );

                // Save to database using repository
                const newTp: TakeProfitOrder = {
                  price: trailingTpPrice,
                  percentage: 100,
                  orderId: order.id,
                  triggered: false,
                };

                await repos.position.updateTpOrders(symbol, [newTp]);

                logger.info(`✅ ${symbol}: Trailing TP adjusted to ${trailingTpPrice.toFixed(4)} (+${trailingStopPercent}% lock, order: ${order.id})`);
              }
            }
          }
        } catch (error: any) {
          logger.error(`${symbol}: Failed to adjust trailing TP: ${error.message}`);
        }
      }
    }

    logger.info("💰 Profit manager check completed");

  } catch (error) {
    logger.error(`Profit manager error: ${error}`);
  }
}

/**
 * Detect positions that were closed (in DB but not on exchange)
 * Check if they were closed by stop-loss or take-profit orders
 */
async function detectClosedPositions(logger: Logger): Promise<void> {
  try {
    // Fetch positions from exchange and database
    const exchangePositions = await exchangeClient.getPositions();
    const dbPositions = await repos.position.findAllPositions();

    const exchangeSymbols = new Set(exchangePositions.map(p => p.symbol));

    for (const dbPos of dbPositions) {
      const symbol = dbPos.symbol;

      // Position exists in DB but not on exchange - it was closed
      if (!exchangeSymbols.has(symbol)) {
        const slOrderId = dbPos.sl_order_id;
        const tpOrderId = dbPos.tp_order_id;
        const entryOrderId = dbPos.entry_order_id;

        // Get entry trade data for PnL calculation
        const entryData = await getEntryTradeData(entryOrderId, symbol);

        // Check stop-loss trigger
        if (slOrderId) {
          await checkStopLossTrigger(slOrderId, symbol, entryData, entryOrderId, logger);
        }

        // Check take-profit trigger
        await checkTakeProfitTrigger(
          symbol,
          tpOrderId || null,
          dbPos.tp_orders,
          entryData,
          entryOrderId,
          logger
        );

        // Remove closed position from database
        await dbClient.execute({
          sql: 'DELETE FROM positions WHERE symbol = ?',
          args: [symbol]
        });
      }
    }
  } catch (error) {
    logger.error("Failed to detect closed positions:", error as any);
  }
}

/**
 * Get entry trade data for PnL calculations
 */
async function getEntryTradeData(entryOrderId: string, symbol: string): Promise<{
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
    const entryTradeResult = await dbClient.execute({
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
    tradingLogger.warn(`Could not fetch entry trade for ${symbol}: ${(err as any).message}`);
  }

  return defaultData;
}

/**
 * Check if stop-loss order was triggered
 */
async function checkStopLossTrigger(
  slOrderId: string,
  symbol: string,
  entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
  entryOrderId: string,
  logger: Logger
): Promise<void> {
  try {
    const order = await exchangeClient.getOrder(slOrderId, symbol);

    // Check if order was filled
    if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
      // Check if already recorded (prevent duplicates)
      const existingTrade = await dbClient.execute({
        sql: 'SELECT order_id FROM trades WHERE order_id = ?',
        args: [slOrderId]
      });

      if (existingTrade.rows.length > 0) {
        tradingLogger.debug(`SL ${slOrderId} already recorded, skipping`);
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
      await dbClient.execute({
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

      // Update reflection with close data (for AI learning)
      await updateReflectionOnClose({
        entryOrderId,
        closePrice: order.price,
        pnl,
        closeReason: 'stop_loss',
        symbol,
      });

      // Record in agent decisions
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
              VALUES (?, 0, 'Stop-loss triggered', 'Stop-loss executed', ?, 0, 0)`,
        args: [
          new Date().toISOString(),
          `Stop-loss TRIGGERED: ${symbol} at ${order.price} (PnL: ${pnl.toFixed(2)} USDT, order ${slOrderId})`
        ]
      });
    }
  } catch (orderError) {
    tradingLogger.debug(`Could not fetch stop-loss order ${slOrderId} for ${symbol}: ${(orderError as any).message}`);
  }
}

/**
 * Check take-profit trigger - supports both old and new formats
 */
async function checkTakeProfitTrigger(
  symbol: string,
  tpOrderId: string | null,
  tpOrdersData: any,
  entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
  entryOrderId: string,
  logger: Logger
): Promise<void> {
  // Parse TP orders
  let tpOrders: any[] = [];
  if (tpOrdersData) {
    try {
      tpOrders = Array.isArray(tpOrdersData) ? tpOrdersData : JSON.parse(tpOrdersData);
    } catch (parseError) {
      tradingLogger.warn(`Failed to parse tp_orders for ${symbol}`);
      if (tpOrderId) {
        // Fallback to old format
        tpOrders = [{ orderId: tpOrderId, percentage: 100, triggered: false }];
      }
    }
  } else if (tpOrderId) {
    // Old format: single TP in tp_order_id field
    tpOrders = [{ orderId: tpOrderId, percentage: 100, triggered: false }];
  }

  // Check each TP order
  for (const tp of tpOrders) {
    if (!tp.triggered) {
      await checkSingleTakeProfitOrder(
        symbol,
        tp.orderId,
        entryData,
        entryOrderId,
        tp.percentage,
        tp.price,
        logger
      );
    }
  }
}

/**
 * Check a single take-profit order
 */
async function checkSingleTakeProfitOrder(
  symbol: string,
  orderId: string,
  entryData: { entryPrice: number; quantity: number; leverage: number; side: 'long' | 'short' },
  entryOrderId: string,
  percentage?: number,
  targetPrice?: number,
  logger?: Logger
): Promise<void> {
  try {
    const order = await exchangeClient.getOrder(orderId, symbol);

    if (order.status === 'finished' || order.status === 'closed' || order.status === 'filled') {
      // Check if already recorded
      const existingTrade = await dbClient.execute({
        sql: 'SELECT order_id FROM trades WHERE order_id = ?',
        args: [orderId]
      });

      if (existingTrade.rows.length > 0) {
        tradingLogger.debug(`TP ${orderId} already recorded, skipping`);
        return;
      }

      const tpInfo = percentage
        ? `(${percentage}% @ ${targetPrice})`
        : '';
      tradingLogger.info(`🎯 Take-profit TRIGGERED for ${symbol} ${tpInfo} (order ${orderId})`);

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
      await dbClient.execute({
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

      // Update reflection with close data (for AI learning)
      await updateReflectionOnClose({
        entryOrderId,
        closePrice: order.price,
        pnl,
        closeReason,
        symbol,
      });

      // Record in agent decisions
      const tpDescription = percentage
        ? `${symbol} ${percentage}% @ ${order.price}`
        : `${symbol} at ${order.price}`;
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions (timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_quantity)
              VALUES (?, 0, 'Take-profit triggered', 'Take-profit executed', ?, 0, 0)`,
        args: [
          new Date().toISOString(),
          `Take-profit TRIGGERED: ${tpDescription} (PnL: ${pnl.toFixed(2)} USDT, order ${orderId})`
        ]
      });
    }
  } catch (orderError) {
    tradingLogger.debug(`Could not fetch TP order ${orderId} for ${symbol}: ${(orderError as any).message}`);
  }
}
