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
 * Trade Execution Tools
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createExchangeClient } from "../../services/exchange";
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { getChinaTimeISO } from "../../utils/timeUtils";
import { RISK_PARAMS } from "../../config/riskParams";
import { getQuantoMultiplier } from "../../utils/contractUtils";
import type { TakeProfitOrder, StopLossOrder } from "../../database/schema";

const logger = createPinoLogger({
  name: "trade-execution",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * Format price with appropriate decimal places based on value
 * - For prices < $1: show 5 decimals (e.g., 0.20200 for DOGE)
 * - For prices >= $1: show 4 decimals (e.g., 88.5300 for LTC, 95000.4200 for BTC)
 */
function formatPrice(price: number): string {
  if (price < 1) {
    return price.toFixed(5);
  }
  return price.toFixed(4);
}


/**
 * Open Position Tool
 */
export const openPositionTool = createTool({
  name: "openPosition",
  description: "Open position - long or short specified symbol (using market order, immediately filled at current market price).IMPORTANT: 1) Before opening positions, must first use getAccountBalance and getPositions tools to query available balance and existing positions to avoid insufficient funds.2) Automatically cancel all legacy SL/TP orders for this symbol (defensive programming - no need to manually call cancelAllOrdersForSymbol).3) Trading fee approximately 0.05%, avoid frequent trading.4) ✨ System will automatically set stop-loss (SL) orders to protect position size, no manual setup needed.take-profit (TP) automatically adjusted dynamically by profit manager based on profit level (+8% → lock +3%, +15% → lock +8%, +25% → lock +15%).You only need to focus on open/close position decisions.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    side: z.enum(["long", "short"]).describe("direction:long=long,short=short"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe(`leverage multiplier(1-${RISK_PARAMS.MAX_LEVERAGE}x,according toenvironment variableMAX_LEVERAGEconfigured)`),
    amountUsdt: z.number().describe("position amount(USDT)"),
  }),
  execute: async ({ symbol, side, leverage, amountUsdt }) => {
    // No take-profit/stop-loss set when opening positions, AI actively decides in each cycle
    const stopLoss = undefined;
    const takeProfit = undefined;
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);

    try {
      //  Parameter verification
      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
        return {
          success: false,
          message: `invalidposition amount: ${amountUsdt}`,
        };
      }
      
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > RISK_PARAMS.MAX_LEVERAGE) {
        return {
          success: false,
          message: `Invalid leverage multiplier: ${leverage}(must be1-${RISK_PARAMS.MAX_LEVERAGE}between,max value controlled by MAX_LEVERAGE environment variable)`,
        };
      }
      
      // ====== Forced risk check before opening position ======
      
      // 1. checkpositionquantity(max5)
      const allPositions = await client.getPositions();
      const activePositions = allPositions; // Already filtered in adapter

      if (activePositions.length >= RISK_PARAMS.MAX_POSITIONS) {
        return {
          success: false,
          message: `reached maximum position limit(${RISK_PARAMS.MAX_POSITIONS}),currently holding ${activePositions.length} ,cannotopen new position`,
        };
      }

      // 2. Check if symbol already has position (dual-direction positions not allowed)
      const existingPosition = activePositions.find((p) => p.symbol === symbol);

      if (existingPosition) {
        const existingSide = existingPosition.side;

        if (existingSide !== side) {
          return {
            success: false,
            message: `${symbol} Already has ${existingSide === "long" ? "long" : "short"} positions, dual-direction positions not allowed. Please close ${existingSide === "long" ? "long" : "short"} before opening ${side === "long" ? "long" : "short"} position.`,
          };
        }

        // If same direction, adding to position allowed (note total position limit)
        logger.info(`${symbol} Already has${side === "long" ? "long" : "short"}positions,allowed to add to position`);
      }
      
      // 3. Get account information
      const account = await client.getFuturesAccount();
      const unrealisedPnl = account.unrealisedPnl;
      const totalBalance = account.totalBalance;
      const availableBalance = account.availableBalance;
      
      if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
        return {
          success: false,
          message: `account available balance abnormal: ${availableBalance} USDT`,
        };
      }
      
      // 4. Check account drawdown (fetch initial total balance and peak total balance from database)
      const initialBalanceResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialBalanceResult.rows[0]
        ? Number.parseFloat(initialBalanceResult.rows[0].total_value as string)
        : totalBalance;
      
      const peakBalanceResult = await dbClient.execute(
        "SELECT MAX(total_value) as peak FROM account_history"
      );
      const peakBalance = peakBalanceResult.rows[0]?.peak 
        ? Number.parseFloat(peakBalanceResult.rows[0].peak as string)
        : totalBalance;
      
      const drawdownFromPeak = peakBalance > 0 
        ? ((peakBalance - totalBalance) / peakBalance) * 100 
        : 0;
      
      if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT) {
        return {
          success: false,
          message: `account drawdown reached ${drawdownFromPeak.toFixed(2)}% ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%,triggeredrisk protection,not allowedopen new position`,
        };
      }
      
      // 5. check total exposure(does not exceed account total balance 15x)
      let currentTotalExposure = 0;
      for (const pos of activePositions) {
        const posSize = pos.quantity;
        const entryPrice = pos.entryPrice;
        const posLeverage = pos.leverage;
        // get contract multiplier
        const posQuantoMultiplier = await getQuantoMultiplier(pos.exchangeSymbol);
        const posValue = posSize * entryPrice * posQuantoMultiplier;
        currentTotalExposure += posValue;
      }
      
      const newExposure = amountUsdt * leverage;
      const totalExposure = currentTotalExposure + newExposure;
      const maxAllowedExposure = totalBalance * RISK_PARAMS.MAX_LEVERAGE; // use configured max leverage
      
      if (totalExposure > maxAllowedExposure) {
        return {
          success: false,
          message: `opening new position will cause total exposure ${totalExposure.toFixed(2)} USDT exceeds limit ${maxAllowedExposure.toFixed(2)} USDT (account total balance ${RISK_PARAMS.MAX_LEVERAGE}x), refusing to open position`,
        };
      }
      
      // 6. check single position size(recommended not to exceed account total balance 30%)
      const maxSinglePosition = totalBalance * 0.30; // 30%
      if (amountUsdt > maxSinglePosition) {
        logger.warn(`position amount ${amountUsdt.toFixed(2)} USDT exceeds recommended position size ${maxSinglePosition.toFixed(2)} USDT(accounttotal balance 30%)`);
      }
      
      // ====== risk check passed, continue opening position ======
      
      let adjustedAmountUsdt = amountUsdt;
      
      // set leverage
      await client.setLeverage(symbol, leverage);

      // get current price and contract information
      const ticker = await client.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;
      const contractInfo = await client.getContractInfo(symbol);

      // perpetual contract margin calculation
      // note: use"contracts"as unit, each contracts contract represents a certain quantity coins
      // for BTC_USDT: 1 contracts = 0.0001 BTC
      // margin calculation: margin = (contracts * quantoMultiplier * price) / leverage
      
      // get contract multiplier
      const quantoMultiplier = await getQuantoMultiplier(contract);
      const minSize = contractInfo.orderSizeMin;
      const maxSize = contractInfo.orderSizeMax;
      
      // calculate how many can open contracts
      // adjustedAmountUsdt = (quantity * quantoMultiplier * currentPrice) / leverage
      // => quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice)
      let quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice);

      // round down to integer contracts (contracts must be integer)
      quantity = Math.floor(quantity);

      // ensure quantity is within allowed range
      quantity = Math.max(quantity, minSize);
      quantity = Math.min(quantity, maxSize);

      // Binance-specific: Check minimum notional requirement (~20 USDT)
      const exchangeType = process.env.EXCHANGE || 'binance';
      if (exchangeType === 'binance') {
        const MIN_NOTIONAL = 20; // Binance minimum notional in USDT
        const notional = quantity * currentPrice;

        if (notional < MIN_NOTIONAL) {
          // Calculate minimum quantity needed to meet notional requirement
          const minQuantityForNotional = Math.ceil((MIN_NOTIONAL / currentPrice) * 1000) / 1000;

          // Check if we have enough balance to meet minimum notional
          const requiredMargin = (minQuantityForNotional * quantoMultiplier * currentPrice) / leverage;

          if (requiredMargin > adjustedAmountUsdt) {
            return {
              success: false,
              message: `Binance requires minimum order value 20 USDT. ${symbol} price ${currentPrice} USDT, minimum need ${minQuantityForNotional.toFixed(3)} contracts (${MIN_NOTIONAL} USDT order value), need margin ${requiredMargin.toFixed(2)} USDT (${leverage}x leverage), but current available balance is only ${adjustedAmountUsdt.toFixed(2)} USDT. Recommend increasing position size or choosing lower priced symbol.`,
            };
          }

          // Adjust quantity to meet minimum notional
          quantity = minQuantityForNotional;
          logger.info(`Adjust ${symbol} quantity from ${(notional / currentPrice).toFixed(3)} to ${quantity.toFixed(3)} to meet Binance minimum order value requirement (20 USDT)`);
        }
      }

      let size = side === "long" ? quantity : -quantity;

      // final verification: if size is 0  or too small, abandon opening position
      if (Math.abs(size) < minSize) {
        const minMargin = (minSize * quantoMultiplier * currentPrice) / leverage;
        return {
          success: false,
          message: `calculate quantity ${Math.abs(size)}  contracts below minimum limit ${minSize}  contracts,need at least ${minMargin.toFixed(2)} USDT margin(current${adjustedAmountUsdt.toFixed(2)} USDT,leverage${leverage}x)`,
        };
      }
      
      // calculate actual used margin
      let actualMargin = (Math.abs(size) * quantoMultiplier * currentPrice) / leverage;
      
      logger.info(`open position ${symbol} ${side === "long" ? "long" : "short"} ${Math.abs(size)} contracts (leverage${leverage}x)`);

      // 🔥 Cancel any orphaned SL/TP orders from previous positions BEFORE opening new position (defensive programming)
      const prevPosResult = await dbClient.execute({
        sql: "SELECT sl_orders, sl_order_id, tp_orders FROM positions WHERE symbol = ?",
        args: [symbol],
      });

      if (prevPosResult.rows.length > 0) {
        const prevPosition = prevPosResult.rows[0] as any;
        let canceledCount = 0;

        // Cancel all old stop-loss orders (new array format)
        if (prevPosition.sl_orders) {
          try {
            const slOrders = JSON.parse(prevPosition.sl_orders);
            if (Array.isArray(slOrders)) {
              for (const sl of slOrders) {
                if (sl.orderId && !sl.triggered) {
                  try {
                    await client.cancelOrder(sl.orderId, symbol);
                    logger.info(`🔄 Cancelled orphaned SL order ${sl.orderId} before opening new ${symbol} position`);
                    canceledCount++;
                  } catch (e: any) {
                    logger.warn(`⚠️ Could not cancel orphaned SL order ${sl.orderId}: ${e.message}`);
                  }
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Error parsing sl_orders JSON: ${e.message}`);
          }
        }
        // Fallback: cancel old single SL format (backward compatibility)
        else if (prevPosition.sl_order_id) {
          try {
            await client.cancelOrder(prevPosition.sl_order_id, symbol);
            logger.info(`🔄 Cancelled old single SL order ${prevPosition.sl_order_id} before opening new ${symbol} position`);
            canceledCount++;
          } catch (e: any) {
            logger.warn(`⚠️ Could not cancel old SL order ${prevPosition.sl_order_id}: ${e.message}`);
          }
        }

        // Cancel old take-profit orders
        if (prevPosition.tp_orders) {
          try {
            const tpOrders = JSON.parse(prevPosition.tp_orders);
            if (Array.isArray(tpOrders)) {
              for (const tp of tpOrders) {
                if (tp.orderId && !tp.triggered) {
                  try {
                    await client.cancelOrder(tp.orderId, symbol);
                    logger.info(`🔄 Cancelled orphaned TP order ${tp.orderId} before opening new ${symbol} position`);
                    canceledCount++;
                  } catch (e: any) {
                    logger.warn(`⚠️ Could not cancel orphaned TP order ${tp.orderId}: ${e.message}`);
                  }
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Error parsing tp_orders JSON: ${e.message}`);
          }
        }

        if (canceledCount > 0) {
          logger.info(`✅ Cleaned up ${canceledCount} orphaned orders for ${symbol} before opening new position`);
        }
      }

      // 🔥 Step 2: Extra defensive cleanup - cancel ALL orders on exchange (catches orphans not tracked in DB)
      try {
        const binanceAdapter = client as any;
          const ccxt = binanceAdapter.getUnderlyingExchange();
          const ccxtSymbol = client.normalizeSymbol(symbol);

          // Fetch regular open orders
          const regularOrders = await client.getOpenOrders(symbol);
          if (regularOrders.length > 0) {
            logger.info(`🔍 Found ${regularOrders.length} regular open orders for ${symbol} on exchange, canceling...`);
            for (const order of regularOrders) {
              try {
                await client.cancelOrder(order.id, symbol);
                logger.info(`🔄 Cancelled regular orphan order ${order.id}`);
              } catch (e: any) {
                logger.warn(`⚠️ Could not cancel regular order ${order.id}: ${e.message}`);
              }
            }
          }

          // Fetch conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)
          try {
            const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
            if (conditionalOrders && conditionalOrders.length > 0) {
              logger.info(`🔍 Found ${conditionalOrders.length} conditional (STOP/TP) orders for ${symbol} on exchange, canceling...`);
              for (const order of conditionalOrders) {
                try {
                  await ccxt.cancelOrder(order.id, ccxtSymbol);
                  logger.info(`🔄 Cancelled conditional orphan order ${order.id} (${order.type})`);
                } catch (e: any) {
                  logger.warn(`⚠️ Could not cancel conditional order ${order.id}: ${e.message}`);
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Could not fetch conditional orders: ${e.message}`);
          }
      } catch (e: any) {
        logger.warn(`⚠️ Could not fetch/cancel open orders for ${symbol}: ${e.message}`);
      }

      //  market order open position(no take-profit stop-loss set)
      const order = await client.placeOrder({
        symbol,
        side,
        quantity: Math.abs(size),
        leverage,
        // price: undefined means market order
      });

      //  wait and verify order status (with retry)
      // increase wait time, ensure exchange API update position information
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      //  check order status and get actual filled price(max 3 retries)
      let finalOrderStatus = order.status;
      let actualFillSize = 0;
      let actualFillPrice = currentPrice; // Default to current price

      if (order.id) {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const orderDetail = await client.getOrder(order.id);
            finalOrderStatus = orderDetail.status;
            actualFillSize = orderDetail.filled;

            //  get actual filled price
            if (orderDetail.price > 0) {
              actualFillPrice = orderDetail.price;
            }
            
            logger.info(`filled: ${actualFillSize} contracts @ ${actualFillPrice.toFixed(2)} USDT`);
            
            //  verify filled price reasonability (slippage protection)
            const priceDeviation = Math.abs(actualFillPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.02) {
              // slippage exceeds 2%, reject this trade (rollback)
              logger.error(`❌ filled price deviation exceeds 2%: ${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)} (deviation ${(priceDeviation * 100).toFixed(2)}%), refusing trade`);
              
              // attempt to close position rollback (if already filled)
              try {
                await client.placeOrder({
                  symbol,
                  side: side === 'long' ? 'short' : 'long', // Opposite side
                  quantity: Math.abs(size),
                  reduceOnly: true,
                });
                logger.info(`rolled back trade`);
              } catch (rollbackError: any) {
                logger.error(`rollback failed: ${rollbackError.message},please handle manually`);
              }
              
              return {
                success: false,
                message: `open position failed: filled price deviation exceeds 2% (${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)}),trade refused`,
              };
            }
            
            // if order was cancelled or not filled, return failed
            if (finalOrderStatus === 'cancelled' || actualFillSize === 0) {
              return {
                success: false,
                message: `open position failed:order${finalOrderStatus === 'cancelled' ? 'was cancelled' : 'not filled'}(order ID: ${order.id})`,
              };
            }
            
            // successfully fetched order information, break loop
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`failed to fetch order details(retry${retryCount}times): ${error.message}`);
              // if cannot fetch order details, use estimated value to continue
              logger.warn(`use estimated value to continue: quantity=${Math.abs(size)}, price=${currentPrice}`);
              actualFillSize = Math.abs(size);
              actualFillPrice = currentPrice;
            } else {
              logger.warn(`failed to fetch order details,${retryCount}/${maxRetries} retries...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      //  use actual filled quantity and price to record to database
      const finalQuantity = actualFillSize > 0 ? actualFillSize : Math.abs(size);

      // calculate fee(taker fee rate 0.05%)
      // fee = contract notional value * 0.05%
      // contract notional value = contracts * quantoMultiplier * price
      const positionValue = finalQuantity * quantoMultiplier * actualFillPrice;
      const fee = positionValue * 0.0005; // 0.05%
      
      // record open position trade
      // side: positiondirection(long=long, short=short)
      // actual execution: long open position=buy (+size), short open position=sell (-size)
      // map status: finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';
      
      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, fee, timestamp, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,            // positiondirection(long/short)
          "open",
          actualFillPrice, // use actual filled price
          finalQuantity,   // use actual filled quantity
          leverage,
          fee,            // fee
          new Date().toISOString(),
          dbStatus,
        ],
      });
      
      // no stop-loss take-profit orders set
      let slOrderId: string | undefined;
      let tpOrderId: string | undefined;
      
      //  ✅ CRITICAL: Verify actual position from exchange by entry_order_id
      // Exchange API has delays, need to wait and retry
      let liquidationPrice = 0;
      let actualPositionQuantity = finalQuantity; // Default to order fill quantity
      let maxRetries = 5;
      let retryCount = 0;
      let positionVerified = false;

      while (retryCount < maxRetries) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // incremental wait time

          const positions = await client.getPositions();

          // 🔥 IMPORTANT: Match by symbol first, then verify quantity matches our order
          const exchangePosition = positions.find((p) => p.symbol === symbol && p.side === side);

          if (exchangePosition && exchangePosition.quantity > 0) {
            // ✅ Position found on exchange
            actualPositionQuantity = exchangePosition.quantity;
            liquidationPrice = exchangePosition.liquidationPrice;
            positionVerified = true;

            // 🔥 CRITICAL CHECK: Verify quantity matches what we expect
            const quantityDiff = Math.abs(actualPositionQuantity - finalQuantity);
            const quantityDiffPercent = (quantityDiff / finalQuantity) * 100;

            if (quantityDiff > 0.01 && quantityDiffPercent > 1) {
              logger.warn(`⚠️ QUANTITY MISMATCH: Order filled ${finalQuantity}, but exchange shows ${actualPositionQuantity}`);
              logger.warn(`   Difference: ${quantityDiff.toFixed(4)} (${quantityDiffPercent.toFixed(2)}%)`);
              logger.warn(`   Using EXCHANGE quantity: ${actualPositionQuantity} (source of truth)`);
            } else {
              logger.info(`✅ Position verified: ${actualPositionQuantity} units on exchange (matches order fill)`);
            }

            break; // position verified, break loop
          }

          retryCount++;

          if (retryCount >= maxRetries) {
            logger.error(`❌ WARNING: Exchange shows no position for ${symbol}, but order ${order.id} status=${finalOrderStatus}`);
            logger.error(`   Order filled: ${actualFillSize} units @ ${actualFillPrice}`);
            logger.error(`   Possible causes: Exchange API delay, position not settled yet`);
            logger.error(`   Will use order fill quantity ${finalQuantity} as fallback`);
          }
        } catch (error) {
          logger.warn(`Failed to get positions (retry ${retryCount + 1}/${maxRetries}): ${error}`);
          retryCount++;
        }
      }

      // if unable to fetch liquidation price from exchange, use estimation formula (as fallback only)
      if (liquidationPrice === 0) {
        liquidationPrice = side === "long"
          ? actualFillPrice * (1 - 0.9 / leverage)
          : actualFillPrice * (1 + 0.9 / leverage);
        logger.warn(`Using estimated liquidation price: ${liquidationPrice}`);
      }

      if (!positionVerified) {
        logger.error(`❌ CRITICAL: Could not verify position on exchange! Database may be out of sync.`);
        logger.error(`   Recommendation: Run syncPositionsTool to reconcile`);
      }
        
      // first check if position already exists
      const existingResult = await dbClient.execute({
        sql: "SELECT symbol FROM positions WHERE symbol = ?",
        args: [symbol],
      });
      
      if (existingResult.rows.length > 0) {
        // update existing position - 🔥 Use ACTUAL exchange quantity
        await dbClient.execute({
          sql: `UPDATE positions SET
                quantity = ?, entry_price = ?, current_price = ?, liquidation_price = ?,
                unrealized_pnl = ?, leverage = ?, side = ?, profit_target = ?, stop_loss = ?,
                tp_order_id = ?, sl_order_id = ?, entry_order_id = ?
                WHERE symbol = ?`,
          args: [
            actualPositionQuantity, // 🔥 Use verified exchange quantity
            actualFillPrice,
            actualFillPrice,
            liquidationPrice,
            0,
            leverage,
            side,
            takeProfit || null,
            stopLoss || null,
            tpOrderId || null,
            slOrderId || null,
            order.id?.toString() || "",
            symbol,
          ],
        });
        logger.info(`✅ Updated position in database: ${symbol} ${side} ${actualPositionQuantity} units`);
      } else {
        // insertnewposition - 🔥 Use ACTUAL exchange quantity
        await dbClient.execute({
          sql: `INSERT INTO positions
                (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
                 leverage, side, profit_target, stop_loss, tp_order_id, sl_order_id, tp_orders, sl_orders, entry_order_id, opened_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            symbol,
            actualPositionQuantity, // 🔥 Use verified exchange quantity
            actualFillPrice,
            actualFillPrice,
            liquidationPrice,
            0,
            leverage,
            side,
            takeProfit || null,
            stopLoss || null,
            tpOrderId || null,
            slOrderId || null,
            null, // tp_orders: will be populated by profit manager when trailing TP triggers
            null, // sl_orders: will be auto-populated by system after position is saved (see Phase 2 below)
            order.id?.toString() || "",
            new Date().toISOString(),
          ],
        });
        logger.info(`✅ Inserted position in database: ${symbol} ${side} ${actualPositionQuantity} units`);
      }

      // ====== 🔥 Phase 2: Auto-set stop-loss order based on system configuration ======
      try {
        // Read stop-loss percentage from environment variable (default: -15%)
        const slPnlPercent = Number.parseFloat(process.env.POSITION_STOP_LOSS_PNL_PERCENT || '-15');

        logger.info(`💰 Auto-setting stop-loss at ${slPnlPercent}% PnL (leveraged)...`);

        // Calculate stop-loss price from entry price
        // PnL% = (price_change% / leverage) * 100
        // => price_change% = (PnL% * leverage) / 100
        const slPriceChange = (Math.abs(slPnlPercent) / leverage) / 100;

        let stopLossPrice: number;
        if (side === 'long') {
          // LONG: SL price should be BELOW entry price
          stopLossPrice = actualFillPrice * (1 - slPriceChange);
        } else {
          // SHORT: SL price should be ABOVE entry price
          stopLossPrice = actualFillPrice * (1 + slPriceChange);
        }

        logger.info(`  Entry price: ${actualFillPrice.toFixed(4)}, SL price: ${stopLossPrice.toFixed(4)} (${slPnlPercent}%)`);

        // Place stop-loss order on Binance
        const binanceAdapter = client as any;
        const ccxt = binanceAdapter.getUnderlyingExchange();
        const ccxtSymbol = client.normalizeSymbol(symbol);

        // Stop order side is opposite to position (closing)
        const orderSide = side === 'long' ? 'sell' : 'buy';

        const slOrder = await ccxt.createOrder(
          ccxtSymbol,
          'STOP_MARKET',
          orderSide,
          actualPositionQuantity,
          undefined, // no limit price for STOP_MARKET
          {
            stopPrice: stopLossPrice,
            reduceOnly: true,
          }
        );

        const slOrderId = slOrder.id;
        logger.info(`  ✅ Stop-loss order created: ${symbol} ${side} ${actualPositionQuantity}@${stopLossPrice.toFixed(4)} (order ID: ${slOrderId})`);

        // Save SL order to database
        const newSL: StopLossOrder = {
          price: stopLossPrice,
          percentage: 100, // Full position coverage
          orderId: slOrderId,
          triggered: false,
        };

        await dbClient.execute({
          sql: "UPDATE positions SET sl_orders = ? WHERE symbol = ?",
          args: [JSON.stringify([newSL]), symbol]
        });

        logger.info(`  ✅ Stop-loss saved to database: ${slOrderId} @ ${stopLossPrice.toFixed(4)} (${slPnlPercent}%)`);

      } catch (slError: any) {
        logger.error(`  ❌ Failed to auto-set stop-loss: ${slError.message}`);
        logger.error(`  Position is open but without SL protection! Manual intervention may be needed.`);
        // Continue execution - position is already open, don't fail the entire operation
      }
      // ====== End of auto SL setting ======

      const contractAmount = Math.abs(size) * quantoMultiplier;
      const totalValue = contractAmount * actualFillPrice;

      return {
        success: true,
        orderId: order.id?.toString(),
        symbol,
        side,
        size: Math.abs(size), // contractcontracts
        contractAmount, // actual coin quantity
        price: actualFillPrice,
        leverage,
        actualMargin,
        message: `✅ successfully opened position ${symbol} ${side === "long" ? "long" : "short"} ${Math.abs(size)}  contracts (${contractAmount.toFixed(4)} ${symbol}), fill price ${formatPrice(actualFillPrice)}, margin ${actualMargin.toFixed(2)} USDT, leverage ${leverage}x. System has automatically set stop-loss (SL) protection, take-profit (TP) will be dynamically adjusted by profit manager.`,
      };
    } catch (error: any) {
      logger.error(`❌ open position failed ${symbol} ${side}: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `open position failed: ${error.message}`,
      };
    }
  },
});

/**
 * Close Position Tool
 */
export const closePositionTool = createTool({
  name: "closePosition",
  description: "close position - close specified symbol position. automatically cancel this symbol all SL/TP orders (defensive programming - ensure no residual orders triggered after closing position).",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    percentage: z.number().min(1).max(100).default(100).describe("close position percentage(1-100)"),
  }),
  execute: async ({ symbol, percentage }) => {
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);
    
    try {
      //  Parameter verification
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        return {
          success: false,
          message: `invalid close position percentage: ${percentage}(must be between 1-100)`,
        };
      }
      
      //  directly fetch latest from exchange position information (not dependent on database)
      const allPositions = await client.getPositions();
      const exchangePosition = allPositions.find((p) => p.symbol === symbol);

      if (!exchangePosition || exchangePosition.quantity === 0) {
        return {
          success: false,
          message: `did not find ${symbol}  position`,
        };
      }

      // fetch real-time data from exchange
      const side = exchangePosition.side;
      const quantity = exchangePosition.quantity;
      let entryPrice = exchangePosition.entryPrice;
      let currentPrice = exchangePosition.currentPrice;
      const leverage = exchangePosition.leverage;
      const totalUnrealizedPnl = exchangePosition.unrealizedPnl;

      //  if price is 0, fetch real-time ticker as fallback
      if (currentPrice === 0 || entryPrice === 0) {
        const ticker = await client.getFuturesTicker(symbol);
        if (currentPrice === 0) {
          currentPrice = ticker.markPrice;
          logger.warn(`position mark price is 0, use ticker price: ${currentPrice}`);
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice; // if entry price is 0, use current price
          logger.warn(`position entry price is 0, use current price: ${entryPrice}`);
        }
      }
      
      // calculateclose position quantity - No rounding, preserve full decimal precision
      const closeSize = (quantity * percentage) / 100;
      const size = side === "long" ? -closeSize : closeSize;
      
      // Get contract multiplier for calculating PnL and fee
      const quantoMultiplier = await getQuantoMultiplier(contract);
      
      // 🔥 no longer rely on exchange returned unrealisedPnl,always manually calculate gross PnL
      // manual PnL calculation formula:
      // for long:(currentPrice - entryPrice) * quantity * quantoMultiplier
      // for short:(entryPrice - currentPrice) * quantity * quantoMultiplier
      const priceChange = side === "long" 
        ? (currentPrice - entryPrice) 
        : (entryPrice - currentPrice);
      
      const grossPnl = priceChange * closeSize * quantoMultiplier;
      
      logger.info(`estimatedPnL: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)} USDT (price change: ${priceChange.toFixed(4)})`);
      
      //  calculate fee (open position + close position)
      const openFee = entryPrice * closeSize * quantoMultiplier * 0.0005;
      const closeFee = currentPrice * closeSize * quantoMultiplier * 0.0005;
      const totalFees = openFee + closeFee;
      
      // net PnL = gross PnL - total fees (this is estimated, will recalculate based on actual filled price after closing position)
      let pnl = grossPnl - totalFees;
      
      logger.info(`close position ${symbol} ${side === "long" ? "long" : "short"} ${closeSize} contracts (entry: ${entryPrice.toFixed(2)}, current: ${currentPrice.toFixed(2)})`);

      // 🔥 Cancel all SL/TP orders BEFORE closing position (defensive programming)
      // Step 1: Cancel orders tracked in database
      const posResult = await dbClient.execute({
        sql: "SELECT sl_orders, sl_order_id, tp_orders FROM positions WHERE symbol = ?",
        args: [symbol],
      });

      if (posResult.rows.length > 0) {
        const dbPosition = posResult.rows[0] as any;

        // Cancel all stop-loss orders (new array format)
        if (dbPosition.sl_orders) {
          try {
            const slOrders = JSON.parse(dbPosition.sl_orders);
            if (Array.isArray(slOrders)) {
              for (const sl of slOrders) {
                if (sl.orderId && !sl.triggered) {
                  try {
                    await client.cancelOrder(sl.orderId, symbol);
                    logger.info(`🔄 Cancelled SL order ${sl.orderId} before closing ${symbol}`);
                  } catch (e: any) {
                    logger.warn(`⚠️ Could not cancel SL order ${sl.orderId}: ${e.message}`);
                  }
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Error parsing sl_orders JSON: ${e.message}`);
          }
        }
        // Fallback: cancel old single SL format (backward compatibility)
        else if (dbPosition.sl_order_id) {
          try {
            await client.cancelOrder(dbPosition.sl_order_id, symbol);
            logger.info(`🔄 Cancelled old single SL order ${dbPosition.sl_order_id} before closing ${symbol}`);
          } catch (e: any) {
            logger.warn(`⚠️ Could not cancel old SL order ${dbPosition.sl_order_id}: ${e.message}`);
          }
        }

        // Cancel all take-profit orders
        if (dbPosition.tp_orders) {
          try {
            const tpOrders = JSON.parse(dbPosition.tp_orders);
            if (Array.isArray(tpOrders)) {
              for (const tp of tpOrders) {
                if (tp.orderId && !tp.triggered) {
                  try {
                    await client.cancelOrder(tp.orderId, symbol);
                    logger.info(`🔄 Cancelled TP order ${tp.orderId} before closing ${symbol}`);
                  } catch (e: any) {
                    logger.warn(`⚠️ Could not cancel TP order ${tp.orderId}: ${e.message}`);
                  }
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Error parsing tp_orders JSON: ${e.message}`);
          }
        }
      }

      // Step 2: Extra defensive cleanup - cancel ALL orders for this symbol on exchange
      // This catches orphan orders that weren't tracked in database (e.g., due to sync bugs)
      try {
        // For Binance, we need to check both regular orders AND conditional orders (STOP_MARKET)
        const binanceAdapter = client as any;
          const ccxt = binanceAdapter.getUnderlyingExchange();
          const ccxtSymbol = client.normalizeSymbol(symbol);

          // Fetch regular open orders
          const regularOrders = await client.getOpenOrders(symbol);
          if (regularOrders.length > 0) {
            logger.info(`🔍 Found ${regularOrders.length} regular open orders for ${symbol}, canceling...`);
            for (const order of regularOrders) {
              try {
                await client.cancelOrder(order.id, symbol);
                logger.info(`🔄 Cancelled regular order ${order.id}`);
              } catch (e: any) {
                logger.warn(`⚠️ Could not cancel regular order ${order.id}: ${e.message}`);
              }
            }
          }

          // Fetch conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)
          try {
            const conditionalOrders = await ccxt.fetchOpenOrders(ccxtSymbol, undefined, undefined, { stop: true });
            if (conditionalOrders && conditionalOrders.length > 0) {
              logger.info(`🔍 Found ${conditionalOrders.length} conditional (STOP/TP) orders for ${symbol}, canceling...`);
              for (const order of conditionalOrders) {
                try {
                  await ccxt.cancelOrder(order.id, ccxtSymbol);
                  logger.info(`🔄 Cancelled conditional order ${order.id} (${order.type})`);
                } catch (e: any) {
                  logger.warn(`⚠️ Could not cancel conditional order ${order.id}: ${e.message}`);
                }
              }
            }
          } catch (e: any) {
            logger.warn(`⚠️ Could not fetch conditional orders: ${e.message}`);
          }
      } catch (e: any) {
        logger.warn(`⚠️ Could not fetch/cancel open orders for ${symbol}: ${e.message}`);
      }

      //  market orderclose position
      const order = await client.placeOrder({
        symbol,
        side: side === 'long' ? 'short' : 'long', // Opposite side to close
        quantity: closeSize,
        reduceOnly: true, // reduce only, don't open new position
      });
      
      //  wait and verify order status (with retry)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      //  get actual filled price and quantity (max 3 retries)
      let actualExitPrice = currentPrice;
      let actualCloseSize = closeSize;
      let finalOrderStatus = order.status;
      
      if (order.id) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            const orderDetail = await client.getOrder(order.id);
            finalOrderStatus = orderDetail.status;
            const filled = orderDetail.filled;

            if (filled > 0) {
              actualCloseSize = filled;
            }

            // get actual filled price
            if (orderDetail.price > 0) {
              actualExitPrice = orderDetail.price;
            }
            
            logger.info(`filled: ${actualCloseSize} contracts @ ${actualExitPrice.toFixed(2)} USDT`);
            
            //  verify filled price reasonability (slippage protection)
            const priceDeviation = Math.abs(actualExitPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.03) {
              // when closing positions, 3% slippage allowed(more lenient than opening positions, because it may be emergency stop-loss)
              logger.warn(`⚠️ close position filled price deviation exceeds 3%: ${currentPrice.toFixed(2)} → ${actualExitPrice.toFixed(2)} (deviation ${(priceDeviation * 100).toFixed(2)}%)`);
            }
            
            //  recalculate actual PnL (based on actual filled price)
            // get contract multiplier
            const quantoMultiplier = await getQuantoMultiplier(contract);
            
            const priceChange = side === "long" 
              ? (actualExitPrice - entryPrice) 
              : (entryPrice - actualExitPrice);
            
            // PnL = Price change * contracts * contract multiplier
            const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
            
            //  deduct fee (open position + close position)
            // entry fee = open positionnotional value * 0.05%
            const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // exit fee = close positionnotional value * 0.05%
            const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // total fees
            const totalFees = openFee + closeFee;
            
            // net PnL = gross PnL - total fees
            pnl = grossPnl - totalFees;
            
            logger.info(`PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
            
            // successfully fetched order information, break loop
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`failed to fetch close position order details(retry${retryCount}times): ${error.message}`);
              // if cannot fetch order details, use estimated value
              logger.warn(`use estimated value to continue: quantity=${closeSize}, price=${currentPrice}`);
              actualCloseSize = closeSize;
              actualExitPrice = currentPrice;
              // recalculate PnL (need to multiply by contract multiplier)
              const quantoMultiplier = await getQuantoMultiplier(contract);
              const priceChange = side === "long" 
                ? (actualExitPrice - entryPrice) 
                : (entryPrice - actualExitPrice);
              const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
              // deduct fee
              const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
              const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
              pnl = grossPnl - openFee - closeFee;
            } else {
              logger.warn(`failed to fetch close position order details,${retryCount}/${maxRetries} retries...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      // get account information to record current total balance
      const account = await client.getFuturesAccount();
      const totalBalance = account.totalBalance;
      
      //  calculate total fees (open position + close position) for database record
      // need to get contract multiplier
      const dbQuantoMultiplier = await getQuantoMultiplier(contract);
      
      // entry fee = open positionnotional value * 0.05%
      const dbOpenFee = entryPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // exit fee = close positionnotional value * 0.05%
      const dbCloseFee = actualExitPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // total fees
      const totalFee = dbOpenFee + dbCloseFee;
      
      // 🔥 critical verification: check if PnL calculation is correct
      const notionalValue = actualExitPrice * actualCloseSize * dbQuantoMultiplier;
      const priceChangeCheck = side === "long" 
        ? (actualExitPrice - entryPrice) 
        : (entryPrice - actualExitPrice);
      const expectedPnl = priceChangeCheck * actualCloseSize * dbQuantoMultiplier - totalFee;
      
      // detect if PnL was incorrectly set to notional value
      if (Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
        logger.error(`🚨 detected PnL calculation anomaly！`);
        logger.error(`  current pnl: ${pnl.toFixed(2)} USDT close to notional value ${notionalValue.toFixed(2)} USDT`);
        logger.error(`  expected pnl: ${expectedPnl.toFixed(2)} USDT`);
        logger.error(`  entry price: ${entryPrice}, exit price: ${actualExitPrice}, quantity: ${actualCloseSize}, contract multiplier: ${dbQuantoMultiplier}`);
        logger.error(`  price change: ${priceChangeCheck.toFixed(4)}, fee: ${totalFee.toFixed(4)}`);
        
        // forcibly correct to correct value
        pnl = expectedPnl;
        logger.warn(`  automatically corrected pnl to: ${pnl.toFixed(2)} USDT`);
      }
      
      // detailed logging (for debug)
      logger.info(`【close position PnL details】${symbol} ${side}`);
      logger.info(`  entry price: ${entryPrice.toFixed(4)}, exit price: ${actualExitPrice.toFixed(4)}, quantity: ${actualCloseSize} contracts`);
      logger.info(`  price change: ${priceChangeCheck.toFixed(4)}, contract multiplier: ${dbQuantoMultiplier}`);
      logger.info(`  gross PnL: ${(priceChangeCheck * actualCloseSize * dbQuantoMultiplier).toFixed(2)} USDT`);
      logger.info(`  entry fee: ${dbOpenFee.toFixed(4)} USDT, exit fee: ${dbCloseFee.toFixed(4)} USDT`);
      logger.info(`  total fees: ${totalFee.toFixed(4)} USDT`);
      logger.info(`  net PnL: ${pnl.toFixed(2)} USDT`);
      
      // get entry_order_id from database for linking
      let entryOrderId: string | null = null;
      try {
        const posResult = await dbClient.execute({
          sql: "SELECT entry_order_id FROM positions WHERE symbol = ?",
          args: [symbol]
        });
        if (posResult.rows.length > 0) {
          entryOrderId = (posResult.rows[0] as any).entry_order_id || null;
        }
      } catch (error: any) {
        logger.warn(`Could not fetch entry_order_id: ${error.message}`);
      }

      // record close position trade
      // side: original position direction (long/short)
      // actual execution direction: long close position=sell, short close position=buy
      // pnl: net PnL (fee deducted)
      // fee: total fees(open position+close position)
      // map status: finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';

      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,             // original position direction (convenient for statistics for a certain symbol long/short PnL)
          "close",
          actualExitPrice,   // use actual filled price
          actualCloseSize,   // use actual filled quantity
          leverage,
          pnl,              // net PnL (fee deducted)
          totalFee,         // total fees(open position+close position)
          new Date().toISOString(),
          dbStatus,
          'manual',         // Manual close by LLM
          entryOrderId,     // 🔥 Link to entry order
        ],
      });

      // if all closed positions, delete from position table；otherwise no operation (leave to sync task to update)
      if (percentage === 100) {
        await dbClient.execute({
          sql: "DELETE FROM positions WHERE symbol = ?",
          args: [symbol],
        });
      }
      
      return {
        success: true,
        orderId: order.id?.toString(),
        symbol,
        side,
        closedSize: actualCloseSize,  // use actual filled quantity
        entryPrice,
        exitPrice: actualExitPrice,   // use actual filled price
        leverage,
        pnl,                          // net PnL (fee deducted)
        fee: totalFee,                // total fees
        totalBalance,
        message: `successfully closed position ${symbol} ${actualCloseSize}  contracts, entry price ${formatPrice(entryPrice)}, exit price ${formatPrice(actualExitPrice)}, net PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (fees deducted ${totalFee.toFixed(2)} USDT), current total balance ${totalBalance.toFixed(2)} USDT`,
      };
    } catch (error: any) {
      logger.error(`close position failed: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `close position failed: ${error.message}`,
      };
    }
  },
});

/**
 * Cancel Order Tool
 */
export const cancelOrderTool = createTool({
  name: "cancelOrder",
  description: "cancel specified pending order",
  parameters: z.object({
    orderId: z.string().describe("order ID"),
  }),
  execute: async ({ orderId }) => {
    const client = createExchangeClient();

    try {
      await client.cancelOrder(orderId);

      return {
        success: true,
        orderId,
        message: `order ${orderId} cancelled`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `cancelorderfailed: ${error.message}`,
      };
    }
  },
});

/**
 * Cancel All Orders for Symbol Tool
 * Cancels all open orders (SL/TP) for a specific symbol.
 * Use this to clean up orphaned orders before opening a new position.
 */
export const cancelAllOrdersForSymbolTool = createTool({
  name: "cancelAllOrdersForSymbol",
  description: "Cancel ALL open orders (both stop-loss and take-profit) for a specific symbol. IMPORTANT: Use this ONLY before opening a new position for a symbol to clean up orphaned orders from previous closed positions. Do NOT use this when you only want to modify TP or SL - use cancelAllTakeProfitOrders or cancelStopLossOrder instead.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code to cancel all orders for"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();

    try {
      // Get all open orders for this symbol
      const openOrders = await client.getOpenOrders(symbol);

      if (openOrders.length === 0) {
        return {
          success: true,
          symbol,
          canceledCount: 0,
          message: `No open orders found for ${symbol}`,
        };
      }

      logger.info(`🧹 Canceling ${openOrders.length} open orders for ${symbol}...`);

      let successCount = 0;
      let failCount = 0;
      const canceledOrders: string[] = [];
      const errors: string[] = [];

      // Cancel all open orders
      for (const order of openOrders) {
        try {
          await client.cancelOrder(order.id);
          successCount++;
          canceledOrders.push(order.id);
          logger.info(`  ✅ Canceled order ${order.id} for ${symbol}`);
        } catch (error: any) {
          failCount++;
          errors.push(`${order.id}: ${error.message}`);
          logger.warn(`  ⚠️  Failed to cancel order ${order.id}: ${error.message}`);
        }
      }

      const message = successCount > 0
        ? `✅ Canceled ${successCount} order(s) for ${symbol}${failCount > 0 ? `, ${failCount} failed` : ''}`
        : `❌ Failed to cancel all ${failCount} order(s) for ${symbol}`;

      return {
        success: successCount > 0,
        symbol,
        canceledCount: successCount,
        failedCount: failCount,
        canceledOrders,
        errors: errors.length > 0 ? errors : undefined,
        message,
      };
    } catch (error: any) {
      logger.error(`❌ Failed to get/cancel orders for ${symbol}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to cancel orders for ${symbol}: ${error.message}`,
      };
    }
  },
});

/**
 * Cancel All Take-Profit Orders Tool
 * Cancels only the take-profit orders for a symbol, keeps stop-loss order intact.
 * Use this when you want to replace/modify TP levels without affecting SL.
 */
export const cancelAllTakeProfitOrdersTool = createTool({
  name: "cancelAllTakeProfitOrders",
  description: "Cancel all take-profit orders for a specific symbol while keeping the stop-loss order intact. IMPORTANT: Use this when you want to replace or modify TP levels without affecting the existing SL. After canceling, you can set new TPs with setTakeProfit.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code to cancel TPs for"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();

    try {
      // 1. Get position from database to find TP order IDs
      const dbResult = await dbClient.execute({
        sql: "SELECT tp_orders, sl_order_id FROM positions WHERE symbol = ?",
        args: [symbol]
      });

      if (dbResult.rows.length === 0) {
        return {
          success: false,
          message: `No position found for ${symbol}`,
        };
      }

      const row = dbResult.rows[0] as any;
      const tpOrdersStr = row.tp_orders;
      const slOrderId = row.sl_order_id;

      if (!tpOrdersStr) {
        return {
          success: true,
          symbol,
          canceledCount: 0,
          message: `No take-profit orders found for ${symbol}`,
        };
      }

      let tpOrders: TakeProfitOrder[] = [];
      try {
        tpOrders = JSON.parse(tpOrdersStr);
      } catch (e) {
        return {
          success: false,
          message: `Failed to parse TP orders for ${symbol}`,
        };
      }

      const activeTPs = tpOrders.filter(tp => !tp.triggered);
      if (activeTPs.length === 0) {
        return {
          success: true,
          symbol,
          canceledCount: 0,
          message: `No active take-profit orders found for ${symbol}`,
        };
      }

      logger.info(`🧹 Canceling ${activeTPs.length} take-profit order(s) for ${symbol} (keeping SL: ${slOrderId || 'none'})...`);

      let successCount = 0;
      let failCount = 0;
      const canceledOrders: string[] = [];
      const errors: string[] = [];

      // Cancel all TP orders
      for (const tp of activeTPs) {
        try {
          await client.cancelOrder(tp.orderId);
          successCount++;
          canceledOrders.push(tp.orderId);
          logger.info(`  ✅ Canceled TP order ${tp.orderId} for ${symbol}`);
        } catch (error: any) {
          failCount++;
          errors.push(`${tp.orderId}: ${error.message}`);
          logger.warn(`  ⚠️  Failed to cancel TP order ${tp.orderId}: ${error.message}`);
        }
      }

      // Clear tp_orders in database
      if (successCount > 0) {
        await dbClient.execute({
          sql: "UPDATE positions SET tp_orders = NULL WHERE symbol = ?",
          args: [symbol]
        });
      }

      const message = successCount > 0
        ? `✅ Canceled ${successCount} TP order(s) for ${symbol}${failCount > 0 ? `, ${failCount} failed` : ''} (SL preserved)`
        : `❌ Failed to cancel all ${failCount} TP order(s) for ${symbol}`;

      return {
        success: successCount > 0,
        symbol,
        canceledCount: successCount,
        failedCount: failCount,
        canceledOrders,
        errors: errors.length > 0 ? errors : undefined,
        message,
      };
    } catch (error: any) {
      logger.error(`❌ Failed to cancel TP orders for ${symbol}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to cancel TP orders for ${symbol}: ${error.message}`,
      };
    }
  },
});

/**
 * Cancel Stop-Loss Order Tool
 * Cancels only the stop-loss order for a symbol, keeps take-profit orders intact.
 * Use this when you want to replace/modify SL without affecting TPs.
 */
export const cancelStopLossOrderTool = createTool({
  name: "cancelStopLossOrder",
  description: "Cancel ALL stop-loss orders for a specific symbol while keeping all take-profit orders intact. IMPORTANT: Use this when you want to remove or replace all SLs without affecting the existing TPs. After canceling, you can set new SLs with setStopLoss.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code to cancel SL for"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();

    try {
      // 1. Get position from database to find SL orders
      const dbResult = await dbClient.execute({
        sql: "SELECT sl_orders, sl_order_id, tp_orders FROM positions WHERE symbol = ?",
        args: [symbol]
      });

      if (dbResult.rows.length === 0) {
        return {
          success: false,
          message: `No position found for ${symbol}`,
        };
      }

      const row = dbResult.rows[0] as any;
      let slOrders: StopLossOrder[] = [];
      let canceledCount = 0;

      // Try to parse sl_orders array (new format)
      if (row.sl_orders) {
        try {
          slOrders = JSON.parse(row.sl_orders);
          slOrders = slOrders.filter((sl: StopLossOrder) => !sl.triggered);
        } catch (e) {
          logger.warn(`Failed to parse sl_orders for ${symbol}`);
        }
      }
      // Fallback: handle old single SL format (backward compatibility)
      else if (row.sl_order_id) {
        slOrders = [{
          orderId: row.sl_order_id,
          price: 0, // Unknown
          percentage: 100,
          triggered: false
        }];
      }

      if (slOrders.length === 0) {
        return {
          success: true,
          symbol,
          message: `No stop-loss orders found for ${symbol}`,
        };
      }

      // Count active TPs for logging
      let activeTpCount = 0;
      if (row.tp_orders) {
        try {
          const tpOrders = JSON.parse(row.tp_orders);
          activeTpCount = tpOrders.filter((tp: TakeProfitOrder) => !tp.triggered).length;
        } catch (e) {}
      }

      logger.info(`🧹 Canceling ${slOrders.length} stop-loss order(s) for ${symbol} (keeping ${activeTpCount} TP order(s))...`);

      // Cancel all SL orders
      for (const sl of slOrders) {
        try {
          await client.cancelOrder(sl.orderId);
          logger.info(`  ✅ Canceled SL order ${sl.orderId}`);
          canceledCount++;
        } catch (error: any) {
          logger.error(`  ❌ Failed to cancel SL order ${sl.orderId}: ${error.message}`);
        }
      }

      // Clear sl_orders in database
      await dbClient.execute({
        sql: "UPDATE positions SET sl_orders = NULL, sl_order_id = NULL, sl_percentage = NULL WHERE symbol = ?",
        args: [symbol]
      });

      logger.info(`✅ Canceled ${canceledCount}/${slOrders.length} SL order(s) for ${symbol}`);

      return {
        success: true,
        symbol,
        canceledCount,
        totalCount: slOrders.length,
        message: `✅ Canceled ${canceledCount}/${slOrders.length} stop-loss order(s) for ${symbol} (${activeTpCount} TP order(s) preserved)`,
      };
    } catch (error: any) {
      logger.error(`❌ Failed to cancel SL orders for ${symbol}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to cancel SL orders for ${symbol}: ${error.message}`,
      };
    }
  },
});

/**
 * Set Take Profit Tool - Create automatic take-profit orders for existing position
 * Supports multiple TP levels (e.g., 30% at +5%, 40% at +10%, 30% at +15%)
 */
export const setTakeProfitTool = createTool({
  name: "setTakeProfit",
  description: "Set one or more take-profit orders for an existing position. Supports multiple TP levels for scaling out (e.g., 30% at +5%, 40% at +10%, 30% at +15%). Take-profits execute automatically when price reaches each target. Can be called multiple times to add more TPs. IMPORTANT: 1) Long positions must have TP > current price, short positions must have TP < current price. 2) If adding new TP would exceed 100% total coverage, automatically cancels ALL existing TPs first (defensive programming - prevents orphaned orders). 3) Safe to call multiple times - system handles conflicts automatically.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code"),
    takeProfitPrice: z.number().describe("Take-profit trigger price (long: TP > current, short: TP < current)"),
    percentage: z.number().min(1).max(100).optional().describe("Percentage of position to take profit (1-100%, default 100% if no existing TPs)"),
  }),
  execute: async ({ symbol, takeProfitPrice, percentage }) => {
    const client = createExchangeClient();

    try {
      // 1. Get current position from exchange
      const positions = await client.getPositions();
      const position = positions.find(p => p.symbol === symbol);

      if (!position) {
        return {
          success: false,
          message: `No position found for ${symbol}, cannot set take-profit`,
        };
      }

      // 2. Get existing TPs from database
      const dbResult = await dbClient.execute({
        sql: "SELECT tp_orders FROM positions WHERE symbol = ?",
        args: [symbol]
      });

      let existingTPs: TakeProfitOrder[] = [];
      if (dbResult.rows.length > 0) {
        const tpOrdersStr = (dbResult.rows[0] as any).tp_orders;
        if (tpOrdersStr) {
          try {
            existingTPs = JSON.parse(tpOrdersStr);
          } catch (e) {
            logger.warn(`Failed to parse existing tp_orders for ${symbol}, starting fresh`);
          }
        }
      }

      // 3. Calculate total existing percentage (excluding triggered TPs)
      let totalExistingPercent = existingTPs
        .filter(tp => !tp.triggered)
        .reduce((sum, tp) => sum + tp.percentage, 0);

      // 4. Determine percentage for this TP
      let tpPercentage = percentage;
      if (tpPercentage === undefined) {
        // Default: 100% if no existing TPs, otherwise error (user must specify)
        if (totalExistingPercent === 0) {
          tpPercentage = 100;
        } else {
          return {
            success: false,
            message: `Position already has ${totalExistingPercent.toFixed(0)}% covered by TPs. Must specify percentage for additional TP (remaining: ${(100 - totalExistingPercent).toFixed(0)}%)`,
          };
        }
      }

      // 5. Auto-cancel all existing TPs if new total would exceed 100% (defensive programming)
      const newTotalPercent = totalExistingPercent + tpPercentage;
      if (newTotalPercent > 100) {
        logger.info(`🔄 Total TP would exceed 100% (existing: ${totalExistingPercent.toFixed(0)}%, new: ${tpPercentage}%). Auto-cancelling all existing TPs for ${symbol}...`);

        // Cancel all existing active TPs
        const activeTPs = existingTPs.filter(tp => !tp.triggered);
        let canceledCount = 0;

        for (const tp of activeTPs) {
          try {
            await client.cancelOrder(tp.orderId);
            canceledCount++;
            logger.info(`🔄 Cancelled TP order ${tp.orderId} @ ${formatPrice(tp.price)} (${tp.percentage}%)`);
          } catch (error: any) {
            logger.warn(`⚠️ Failed to cancel TP order ${tp.orderId} (might be already triggered/cancelled): ${error.message}`);
          }
        }

        logger.info(`✅ Cancelled ${canceledCount} existing TP orders for ${symbol}, proceeding with new TP @ ${tpPercentage}%`);

        // Reset existing TPs
        existingTPs = [];
        totalExistingPercent = 0;
      }

      // 6. Get current price
      const ticker = await client.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;

      // 7. Validate take-profit price
      if (position.side === 'long' && takeProfitPrice <= currentPrice) {
        return {
          success: false,
          message: `Long position take-profit price ${formatPrice(takeProfitPrice)} must be above current price ${formatPrice(currentPrice)}`,
        };
      }

      if (position.side === 'short' && takeProfitPrice >= currentPrice) {
        return {
          success: false,
          message: `Short position take-profit price ${formatPrice(takeProfitPrice)} must be below current price ${formatPrice(currentPrice)}`,
        };
      }

      // 8. Calculate take-profit quantity
      let tpQuantity = (position.quantity * tpPercentage) / 100;

      // 8b. Check minimum order size (exchange-specific)
      // For Binance, most contracts require minimum 0.001 for BTC, similar for others
      // If calculated quantity is below minimum, we need to adjust or fail gracefully
      const MIN_ORDER_QUANTITY = {
        'BTC': 0.001,
        'ETH': 0.001,
        'SOL': 0.1,
        'BNB': 0.01,
        'LTC': 0.01,
        'XRP': 1,
      };

      const minQty = MIN_ORDER_QUANTITY[symbol as keyof typeof MIN_ORDER_QUANTITY] || 0.001;

      if (tpQuantity < minQty) {
        // Position is too small to split - check if we can use remaining percentage
        const remainingQty = position.quantity - (position.quantity * totalExistingPercent / 100);

        if (remainingQty >= minQty && (100 - totalExistingPercent) >= tpPercentage) {
          // Use full remaining position instead
          tpQuantity = remainingQty;
          logger.warn(`⚠️ Calculated TP quantity ${tpQuantity.toFixed(4)} below minimum ${minQty}. Using full remaining position: ${remainingQty.toFixed(4)}`);
          // Update percentage to reflect actual coverage
          tpPercentage = 100 - totalExistingPercent;
        } else {
          return {
            success: false,
            message: `Position size ${position.quantity.toFixed(4)} is too small to create TP order with ${tpPercentage}%. Calculated quantity ${tpQuantity.toFixed(4)} is below exchange minimum ${minQty}. Consider using 100% TP or larger position sizes.`,
          };
        }
      }

      // 9. Binance: Use CCXT TAKE_PROFIT_MARKET order
      const binanceAdapter = client as any; // Type assertion
      const ccxt = binanceAdapter.getUnderlyingExchange();
      const ccxtSymbol = client.normalizeSymbol(symbol);

      // Take-profit order side is opposite to position (closing)
      const orderSide = position.side === 'long' ? 'sell' : 'buy';

      const order = await ccxt.createOrder(
        ccxtSymbol,
        'TAKE_PROFIT_MARKET',
        orderSide,
        tpQuantity,
        undefined, // no limit price for TAKE_PROFIT_MARKET
        {
          stopPrice: takeProfitPrice,
          reduceOnly: true,
        }
      );

      const orderId = order.id;
      logger.info(`Take-profit order created: ${symbol} ${position.side} ${tpQuantity}@${takeProfitPrice} (order ID: ${orderId})`);


      // 10. Add new TP to the array and save to database
      const newTP: TakeProfitOrder = {
        price: takeProfitPrice,
        percentage: tpPercentage,
        orderId: orderId,
        triggered: false,
      };

      const allTPs = [...existingTPs, newTP];

      await dbClient.execute({
        sql: "UPDATE positions SET tp_orders = ? WHERE symbol = ?",
        args: [JSON.stringify(allTPs), symbol]
      });

      // 11. Build summary message
      const tpCount = allTPs.filter(tp => !tp.triggered).length;
      const coveredPercent = allTPs.filter(tp => !tp.triggered).reduce((sum, tp) => sum + tp.percentage, 0);

      return {
        success: true,
        orderId: orderId,
        symbol,
        side: position.side,
        takeProfitPrice,
        quantity: tpQuantity,
        percentage: tpPercentage,
        totalTPs: tpCount,
        totalCoverage: coveredPercent,
        message: `✅ Take-profit set: ${symbol} ${position.side.toUpperCase()} TP${tpCount} @ ${formatPrice(takeProfitPrice)} (${tpPercentage}% = ${tpQuantity.toFixed(4)} contracts). Total coverage: ${coveredPercent.toFixed(0)}% across ${tpCount} TPs.`,
      };

    } catch (error: any) {
      logger.error(`Failed to set take-profit for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        message: `Failed to set take-profit: ${error.message}`,
      };
    }
  },
});

/**
 * Set Stop Loss Tool - Create automatic stop-loss order for existing position
 */
export const setStopLossTool = createTool({
  name: "setStopLoss",
  description: "Set a stop-loss order for an existing position (automatic market close order). Stop-loss will execute automatically when price reaches the trigger price, no manual monitoring needed. Used for risk management and profit protection. IMPORTANT: 1) Stop price must be set correctly - long positions must have stop price < current price, short positions must have stop price > current price. 2) Automatically cancels any existing SL order before creating new one (defensive programming - no orphaned orders). 3) Safe to call multiple times - old SL is always removed first.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code"),
    stopPrice: z.number().describe("Stop-loss trigger price (long: stop price < current, short: stop price > current)"),
    percentage: z.number().min(1).max(100).optional().describe("Percentage of position to protect (1-100%, default 100% full position)"),
  }),
  execute: async ({ symbol, stopPrice, percentage = 100 }) => {
    const client = createExchangeClient();

    try {
      // 1. Get current position
      const positions = await client.getPositions();
      const position = positions.find(p => p.symbol === symbol);

      if (!position) {
        return {
          success: false,
          message: `No position found for ${symbol}, cannot set stop-loss`,
        };
      }

      // 2. Get existing SL orders from database
      const dbResult = await dbClient.execute({
        sql: "SELECT sl_orders, sl_order_id FROM positions WHERE symbol = ?",
        args: [symbol]
      });

      let existingSLs: StopLossOrder[] = [];
      let totalExistingPercent = 0;

      if (dbResult.rows.length > 0) {
        const row = dbResult.rows[0] as any;

        // Try to parse sl_orders array (new format)
        if (row.sl_orders) {
          try {
            existingSLs = JSON.parse(row.sl_orders);
            existingSLs = existingSLs.filter((sl: StopLossOrder) => !sl.triggered);
            totalExistingPercent = existingSLs.reduce((sum: number, sl: StopLossOrder) => sum + sl.percentage, 0);
          } catch (error) {
            logger.warn(`Failed to parse sl_orders for ${symbol}, treating as empty array`);
            existingSLs = [];
          }
        }
        // Fallback: migrate old single SL (backward compatibility)
        else if (row.sl_order_id) {
          logger.info(`Migrating old single SL for ${symbol} to array format`);
          // We'll handle this by auto-canceling below
        }
      }

      // 3. Check if adding this SL would exceed 100% coverage
      const totalPercent = totalExistingPercent + percentage;

      if (totalPercent > 100) {
        // Auto-cancel all existing SLs (defensive programming)
        logger.info(`🔄 Total SL would exceed 100% (${totalPercent.toFixed(0)}%). Auto-cancelling all existing SLs for ${symbol}...`);

        for (const sl of existingSLs) {
          try {
            await client.cancelOrder(sl.orderId);
            logger.info(`🔄 Auto-cancelled SL order ${sl.orderId} (${sl.percentage}% @ ${sl.price})`);
          } catch (error: any) {
            logger.warn(`⚠️ Failed to cancel SL order ${sl.orderId}: ${error.message}`);
          }
        }

        // Reset to empty array
        existingSLs = [];
        totalExistingPercent = 0;
      }

      // 4. Get current price
      const ticker = await client.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;

      // 5. Validate stop price
      if (position.side === 'long' && stopPrice >= currentPrice) {
        return {
          success: false,
          message: `Long position stop price ${formatPrice(stopPrice)} must be below current price ${formatPrice(currentPrice)}`,
        };
      }

      if (position.side === 'short' && stopPrice <= currentPrice) {
        return {
          success: false,
          message: `Short position stop price ${formatPrice(stopPrice)} must be above current price ${formatPrice(currentPrice)}`,
        };
      }

      // 6. Calculate stop quantity
      let stopQuantity = (position.quantity * percentage) / 100;

      // 6b. Check minimum order size (exchange-specific)
      const MIN_ORDER_QUANTITY = {
        'BTC': 0.001,
        'ETH': 0.001,
        'SOL': 0.1,
        'BNB': 0.01,
        'LTC': 0.01,
        'XRP': 1,
      };

      const minQty = MIN_ORDER_QUANTITY[symbol as keyof typeof MIN_ORDER_QUANTITY] || 0.001;

      if (stopQuantity < minQty) {
        // Position is too small to split - check if we can use remaining percentage
        const remainingQty = position.quantity - (position.quantity * totalExistingPercent / 100);

        if (remainingQty >= minQty && (100 - totalExistingPercent) >= percentage) {
          // Use full remaining position instead
          stopQuantity = remainingQty;
          logger.warn(`⚠️ Calculated SL quantity ${stopQuantity.toFixed(4)} below minimum ${minQty}. Using full remaining position: ${remainingQty.toFixed(4)}`);
          // Update percentage to reflect actual coverage
          percentage = 100 - totalExistingPercent;
        } else {
          return {
            success: false,
            message: `Position size ${position.quantity.toFixed(4)} is too small to create SL order with ${percentage}%. Calculated quantity ${stopQuantity.toFixed(4)} is below exchange minimum ${minQty}. Consider using 100% SL or larger position sizes.`,
          };
        }
      }

      // 7. Binance: Use CCXT STOP_MARKET order
      const binanceAdapter = client as any; // Type assertion
      const ccxt = binanceAdapter.getUnderlyingExchange();
      const ccxtSymbol = client.normalizeSymbol(symbol);

      // Stop order side is opposite to position (closing)
      const orderSide = position.side === 'long' ? 'sell' : 'buy';

      const order = await ccxt.createOrder(
        ccxtSymbol,
        'STOP_MARKET',
        orderSide,
        stopQuantity,
        undefined, // no limit price for STOP_MARKET
        {
          stopPrice: stopPrice,
          reduceOnly: true,
        }
      );

      logger.info(`Stop-loss order created: ${symbol} ${position.side} ${stopQuantity}@${stopPrice} (order ID: ${order.id})`);

      // 8. Add new SL to the array and save to database
      const newSL: StopLossOrder = {
        price: stopPrice,
        percentage: percentage,
        orderId: order.id,
        triggered: false,
      };

      const allSLs = [...existingSLs, newSL];

      await dbClient.execute({
        sql: "UPDATE positions SET sl_orders = ? WHERE symbol = ?",
        args: [JSON.stringify(allSLs), symbol]
      });

      // 9. Build summary message
      const slCount = allSLs.filter(sl => !sl.triggered).length;
      const coveredPercent = allSLs.filter(sl => !sl.triggered).reduce((sum, sl) => sum + sl.percentage, 0);

      return {
        success: true,
        orderId: order.id,
        symbol,
        side: position.side,
        stopPrice,
        quantity: stopQuantity,
        percentage,
        totalSLs: slCount,
        totalCoverage: coveredPercent,
        message: `✅ Stop-loss set: ${symbol} ${position.side.toUpperCase()} SL${slCount} @ ${formatPrice(stopPrice)} (${percentage}% = ${stopQuantity.toFixed(4)} contracts). Total coverage: ${coveredPercent.toFixed(0)}% across ${slCount} SLs.`,
      };

    } catch (error: any) {
      logger.error(`Failed to set stop-loss for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        message: `Failed to set stop-loss: ${error.message}`,
      };
    }
  },
});

