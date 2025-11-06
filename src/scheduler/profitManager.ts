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
 * Profit Manager - Automated profit protection and SL/TP management
 *
 * Runs every 30 seconds to:
 * - Auto-adjust trailing take-profit orders (single TP for 100% position)
 * - Enforce 36-hour maximum holding time
 * - Peak drawdown protection (30% retracement from peak)
 * - Monitor and maintain SL orders
 *
 * Fully automated - no AI intervention needed for SL/TP management.
 */

import type { Logger } from "pino";
import { createExchangeClient } from "../services/exchange";
import { createClient } from "@libsql/client";
import type { Position, TakeProfitOrder } from "../database/schema";

const db = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export async function runProfitManager(logger: Logger): Promise<void> {
  try {
    logger.info("💰 Profit manager check started");

    // Get all active positions from database
    const result = await db.execute("SELECT * FROM positions");
    const positions = result.rows as unknown as Position[];

    if (positions.length === 0) {
      logger.info("No active positions to monitor");
      return;
    }

    logger.info(`Monitoring ${positions.length} position(s) for risk violations`);

    const exchangeClient = createExchangeClient();

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

      // Get and update peak profit
      let peakPnlPercent = Number(pos.peak_pnl_percent) || 0;

      if (pnlPercent > peakPnlPercent) {
        peakPnlPercent = pnlPercent;
        await db.execute({
          sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ?",
          args: [peakPnlPercent, symbol]
        });

        logger.info(`📈 ${symbol} new peak profit: ${peakPnlPercent.toFixed(2)}%`);
      }

      let shouldClose = false;
      let closeReason = "";

      // a) 36-hour forced liquidation check
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingHours = (now.getTime() - openedTime.getTime()) / (1000 * 60 * 60);

      if (holdingHours >= 36) {
        shouldClose = true;
        closeReason = `Holding time reached ${holdingHours.toFixed(1)} hours, exceeds 36-hour limit`;
      }

      // b) Auto-adjust trailing take-profit order
      if (!shouldClose) {
        let trailingStopPercent = -100;

        if (pnlPercent >= 25) {
          trailingStopPercent = 15;
        } else if (pnlPercent >= 15) {
          trailingStopPercent = 8;
        } else if (pnlPercent >= 8) {
          trailingStopPercent = 3;
        }

        // If trailing threshold active, adjust TP order instead of force-closing
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

            // Get current TP orders from database
            let currentTpOrders: TakeProfitOrder[] = [];
            if (pos.tp_orders) {
              try {
                currentTpOrders = JSON.parse(pos.tp_orders as any);
              } catch (e) {
                // Invalid JSON, treat as empty
              }
            }

            // Check if we need to adjust TP (if no TP or TP is below trailing stop)
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
                const orderSide = side === 'long' ? 'sell' : 'buy';

                const exchangeName = exchangeClient.getExchangeName();

                if (exchangeName === 'Binance') {
                  const binanceAdapter = exchangeClient as any;
                  const ccxt = binanceAdapter.getUnderlyingExchange();
                  const ccxtSymbol = exchangeClient.normalizeSymbol(symbol);

                  const order = await ccxt.createOrder(
                    ccxtSymbol,
                    'TAKE_PROFIT_MARKET',
                    orderSide,
                    tpQuantity,
                    undefined,
                    {
                      stopPrice: trailingTpPrice,
                      reduceOnly: true,
                    }
                  );

                  // Save to database
                  const newTp: TakeProfitOrder = {
                    price: trailingTpPrice,
                    percentage: 100,
                    orderId: order.id,
                    triggered: false,
                  };

                  await db.execute({
                    sql: "UPDATE positions SET tp_orders = ? WHERE symbol = ?",
                    args: [JSON.stringify([newTp]), symbol]
                  });

                  logger.info(`✅ ${symbol}: Trailing TP adjusted to ${trailingTpPrice.toFixed(4)} (+${trailingStopPercent}% lock, order: ${order.id})`);
                }
              }
            }
          } catch (error: any) {
            logger.error(`${symbol}: Failed to adjust trailing TP: ${error.message}`);
          }
        }
      }

      // c) Peak drawdown protection
      if (!shouldClose && peakPnlPercent > 5) {
        const drawdownFromPeak = peakPnlPercent > 0
          ? ((peakPnlPercent - pnlPercent) / peakPnlPercent) * 100
          : 0;

        if (drawdownFromPeak >= 30) {
          shouldClose = true;
          closeReason = `Triggered peak drawdown protection (peak ${peakPnlPercent.toFixed(2)}% → current ${pnlPercent.toFixed(2)}%, drawdown ${drawdownFromPeak.toFixed(1)}% >= 30%)`;
        }
      }

      // Execute forced liquidation
      if (shouldClose) {
        logger.warn(`⚠️  ${symbol} triggered forced liquidation: ${closeReason}`);

        try {
          // 1. Cancel all related orders (TP/SL)
          const openOrders = await exchangeClient.getOpenOrders(symbol);
          logger.info(`${symbol}: Cancelling ${openOrders.length} open orders before forced close`);

          for (const order of openOrders) {
            await exchangeClient.cancelOrder(order.id, symbol);
            logger.info(`Cancelled order ${order.id} (${order.side} ${order.quantity} @ ${order.price || 'market'})`);
          }

          // 2. Get current position to determine close quantity
          const exchangePositions = await exchangeClient.getPositions();
          const currentPosition = exchangePositions.find(p => p.symbol === symbol);

          if (!currentPosition || currentPosition.quantity === 0) {
            logger.warn(`${symbol}: Position no longer exists on exchange, removing from database`);
            await db.execute({
              sql: "DELETE FROM positions WHERE symbol = ?",
              args: [symbol]
            });
            continue;
          }

          // 3. Place market order to close position
          const closeSide = side === 'long' ? 'short' : 'long';
          const closeQuantity = currentPosition.quantity;

          logger.info(`${symbol}: Placing market order to close ${closeSide.toUpperCase()} ${closeQuantity}`);

          const order = await exchangeClient.placeOrder({
            symbol: symbol,
            side: closeSide,
            quantity: closeQuantity,
            reduceOnly: true,
          });

          logger.info(`${symbol}: Close order placed: ${order.id}`);

          // 4. Wait for order fill (with timeout)
          const maxWaitTime = 10000; // 10 seconds
          const startTime = Date.now();
          let isFilled = false;
          let filledPrice = currentPrice;

          while (Date.now() - startTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
              const orderStatus = await exchangeClient.getOrder(order.id || "", symbol);

              if (orderStatus.status === 'closed' || orderStatus.status === 'filled' || orderStatus.status === 'finished') {
                isFilled = true;
                filledPrice = orderStatus.price;
                logger.info(`${symbol}: Close order filled at ${filledPrice}`);
                break;
              }
            } catch (error) {
              logger.error(`${symbol}: Failed to check order status: ${error}`);
            }
          }

          if (!isFilled) {
            logger.warn(`${symbol}: Close order not confirmed filled within timeout, but likely executed`);
          }

          // 5. Record trade history
          const exitPrice = filledPrice;
          const pnl = side === 'long'
            ? (exitPrice - entryPrice) * closeQuantity * leverage
            : (entryPrice - exitPrice) * closeQuantity * leverage;

          await db.execute({
            sql: `INSERT INTO trades (
              symbol, side, entry_price, exit_price, quantity, leverage,
              entry_time, exit_time, pnl, pnl_percent, exit_reason, timestamp, status, type, price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              symbol,
              side,
              entryPrice,
              exitPrice,
              closeQuantity,
              leverage,
              pos.opened_at,
              new Date().toISOString(),
              pnl,
              pnlPercent,
              `FORCED_CLOSE: ${closeReason}`,
              new Date().toISOString(),
              isFilled ? 'filled' : 'pending',
              'close',
              exitPrice
            ]
          });

          // 6. Remove position from database
          await db.execute({
            sql: "DELETE FROM positions WHERE symbol = ?",
            args: [symbol]
          });

          logger.info(`✅ ${symbol}: Position closed successfully (PnL: ${pnl.toFixed(2)} USDT, ${pnlPercent.toFixed(2)}%)`);

        } catch (error) {
          logger.error(`❌ ${symbol}: Failed to execute forced liquidation: ${error}`);
        }
      }
    }

    logger.info("💰 Profit manager check completed");

  } catch (error) {
    logger.error(`Profit manager error: ${error}`);
  }
}
