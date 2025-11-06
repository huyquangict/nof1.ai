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
 * - Auto-adjust trailing take-profit orders (single TP for 100% position)
 * - Enforce 36-hour maximum holding time
 * - Peak drawdown protection (30% retracement from peak)
 * - Monitor and maintain SL orders
 *
 * Fully automated - no AI intervention needed for SL/TP management.
 */

import type { Logger } from "pino";
import { createContainer } from "../container";
import { createServices } from "../application/services";
import { createRepositories } from "../infrastructure/database/repositories";
import type { TakeProfitOrder } from "../database/schema";

// Initialize container and services
const container = createContainer();
const { exchangeClient, logger: tradingLogger } = container;
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

    // Get all active positions using repository
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
