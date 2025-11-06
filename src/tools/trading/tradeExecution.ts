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
  description: "Open position - long or short specified symbol (using market order, immediately filled at current market price).IMPORTANT: 1) Before opening position, must first use getAccountBalance and getPositions tools to query available balance and existing positions to avoid insufficient funds.2) Automatically cancel all legacy SL/TP orders for this symbol (defensive programming - no need to manually call cancelAllOrdersForSymbol).3) Trading fee approximately 0.05%, avoid frequent trading.4) ✨ System will automatically set stop-loss (SL) orders to protect position size, no manual setup needed.take-profit(TP)由利润管理器根据profit水close自动动态调整(+8% → 锁定+3%, +15% → 锁定+8%, +25% → 锁定+15%).You only need to focus on open/close position decisions.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    side: z.enum(["long", "short"]).describe("direction:long=long,short=short"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe(`leverage multiplier(1-${RISK_PARAMS.MAX_LEVERAGE}倍,根据环境变量MAX_LEVERAGE配置)`),
    amountUsdt: z.number().describe("position amount(USDT)"),
  }),
  execute: async ({ symbol, side, leverage, amountUsdt }) => {
    // No take-profit/stop-loss set when opening position, AI actively decides in each cycle
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
          message: `Invalid leverage multiplier: ${leverage}(must在1-${RISK_PARAMS.MAX_LEVERAGE}之间,max value controlled by MAX_LEVERAGE environment variable)`,
        };
      }
      
      // ====== open position前强制risk check ======
      
      // 1. checkposition数量(最多5个)
      const allPositions = await client.getPositions();
      const activePositions = allPositions; // Already filtered in adapter

      if (activePositions.length >= RISK_PARAMS.MAX_POSITIONS) {
        return {
          success: false,
          message: `reachedMaximum number of positions量限制(${RISK_PARAMS.MAX_POSITIONS}个),currentposition ${activePositions.length} 个,无法opennew仓`,
        };
      }

      // 2. check该symbol是否已有position(禁止dual-direction position)
      const existingPosition = activePositions.find((p) => p.symbol === symbol);

      if (existingPosition) {
        const existingSide = existingPosition.side;

        if (existingSide !== side) {
          return {
            success: false,
            message: `${symbol} 已有${existingSide === "long" ? "多" : "空"}单position,dual-direction positions not allowed.please close${existingSide === "long" ? "多" : "空"}单before opening${side === "long" ? "多" : "空"}单.`,
          };
        }

        // 如果direction相同,允许add to position(但需要注意总position限制)
        logger.info(`${symbol} 已有${side === "long" ? "多" : "空"}单position,允许add to position`);
      }
      
      // 3. 获取account信息
      const account = await client.getFuturesAccount();
      const unrealisedPnl = account.unrealisedPnl;
      const totalBalance = account.totalBalance;
      const availableBalance = account.availableBalance;
      
      if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
        return {
          success: false,
          message: `accountavailable balance异常: ${availableBalance} USDT`,
        };
      }
      
      // 4. checkaccountdrawdown(从database获取初始total balance和peaktotal balance)
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
          message: `accountdrawdown已达 ${drawdownFromPeak.toFixed(2)}% ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%,triggeredrisk protection,禁止newopen position`,
        };
      }
      
      // 5. check总exposure(不exceedsaccounttotal balance的15倍)
      let currentTotalExposure = 0;
      for (const pos of activePositions) {
        const posSize = pos.quantity;
        const entryPrice = pos.entryPrice;
        const posLeverage = pos.leverage;
        // 获取contract乘数
        const posQuantoMultiplier = await getQuantoMultiplier(pos.exchangeSymbol);
        const posValue = posSize * entryPrice * posQuantoMultiplier;
        currentTotalExposure += posValue;
      }
      
      const newExposure = amountUsdt * leverage;
      const totalExposure = currentTotalExposure + newExposure;
      const maxAllowedExposure = totalBalance * RISK_PARAMS.MAX_LEVERAGE; // 使用配置的max leverage
      
      if (totalExposure > maxAllowedExposure) {
        return {
          success: false,
          message: `newopen position将导致总exposure ${totalExposure.toFixed(2)} USDT exceeds限制 ${maxAllowedExposure.toFixed(2)} USDT(accounttotal balance的${RISK_PARAMS.MAX_LEVERAGE}倍),拒绝open position`,
        };
      }
      
      // 6. check单笔position size(建议不exceedsaccounttotal balance的30%)
      const maxSinglePosition = totalBalance * 0.30; // 30%
      if (amountUsdt > maxSinglePosition) {
        logger.warn(`position amount ${amountUsdt.toFixed(2)} USDT exceeds建议position size ${maxSinglePosition.toFixed(2)} USDT(accounttotal balance的30%)`);
      }
      
      // ====== risk check通过,继续open position ======
      
      let adjustedAmountUsdt = amountUsdt;
      
      // 设置leverage
      await client.setLeverage(symbol, leverage);

      // 获取current价格和contract信息
      const ticker = await client.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;
      const contractInfo = await client.getContractInfo(symbol);

      // 永续contract的margin计算
      // 注意:使用"contracts"作为单位,每 contractscontract代表一定数量的币
      // 对于 BTC_USDT: 1 contracts = 0.0001 BTC
      // margin计算:margin = (contracts * quantoMultiplier * 价格) / leverage
      
      // 获取contract乘数
      const quantoMultiplier = await getQuantoMultiplier(contract);
      const minSize = contractInfo.orderSizeMin;
      const maxSize = contractInfo.orderSizeMax;
      
      // 计算可以open多少 contractscontract
      // adjustedAmountUsdt = (quantity * quantoMultiplier * currentPrice) / leverage
      // => quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice)
      let quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice);

      // 向下取整到整数contracts(contractmust是整数)
      quantity = Math.floor(quantity);

      // 确保数量在允许范围内
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
              message: `Binance要求最小order价值20 USDT.${symbol}价格${currentPrice} USDT,最少需要${minQuantityForNotional.toFixed(3)} contractscontract(${MIN_NOTIONAL} USDTorder价值),需要margin${requiredMargin.toFixed(2)} USDT(${leverage}xleverage),但currentavailable balance仅${adjustedAmountUsdt.toFixed(2)} USDT.建议增add to position位大小或选择价格更低的symbol.`,
            };
          }

          // Adjust quantity to meet minimum notional
          quantity = minQuantityForNotional;
          logger.info(`调整 ${symbol} 数量从 ${(notional / currentPrice).toFixed(3)} 到 ${quantity.toFixed(3)} 以满足Binance最小order价值要求(20 USDT)`);
        }
      }

      let size = side === "long" ? quantity : -quantity;

      // 最后verify:如果 size 为 0 或者太小,放弃open position
      if (Math.abs(size) < minSize) {
        const minMargin = (minSize * quantoMultiplier * currentPrice) / leverage;
        return {
          success: false,
          message: `计算的数量 ${Math.abs(size)}  contracts小于最小限制 ${minSize}  contracts,需要至少 ${minMargin.toFixed(2)} USDT margin(current${adjustedAmountUsdt.toFixed(2)} USDT,leverage${leverage}x)`,
        };
      }
      
      // 计算actual使用的margin
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

      //  market orderopen position(不设置take-profitstop-loss)
      const order = await client.placeOrder({
        symbol,
        side,
        quantity: Math.abs(size),
        leverage,
        // price: undefined means market order
      });

      //  等待并verifyorder状态(带重试)
      // 增加等待time,确保交易所 API updateposition信息
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      //  checkorder状态并获取actualfilled价格(最多重试3次)
      let finalOrderStatus = order.status;
      let actualFillSize = 0;
      let actualFillPrice = currentPrice; // 默认使用current价格

      if (order.id) {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const orderDetail = await client.getOrder(order.id);
            finalOrderStatus = orderDetail.status;
            actualFillSize = orderDetail.filled;

            //  获取actualfilled价格
            if (orderDetail.price > 0) {
              actualFillPrice = orderDetail.price;
            }
            
            logger.info(`filled: ${actualFillSize} contracts @ ${actualFillPrice.toFixed(2)} USDT`);
            
            //  verifyfilled价格的合理性(slippage protection)
            const priceDeviation = Math.abs(actualFillPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.02) {
              // slippageexceeds2%,拒绝此次交易(rollback)
              logger.error(`❌ filled价deviationexceeds2%: ${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)} (deviation ${(priceDeviation * 100).toFixed(2)}%),拒绝交易`);
              
              // 尝试close positionrollback(如果已经filled)
              try {
                await client.placeOrder({
                  symbol,
                  side: side === 'long' ? 'short' : 'long', // Opposite side
                  quantity: Math.abs(size),
                  reduceOnly: true,
                });
                logger.info(`rolled back交易`);
              } catch (rollbackError: any) {
                logger.error(`rollbackfailed: ${rollbackError.message},请手动处理`);
              }
              
              return {
                success: false,
                message: `open positionfailed:filled价deviationexceeds2% (${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)}),已拒绝交易`,
              };
            }
            
            // 如果order被cancel或not filled,返回failed
            if (finalOrderStatus === 'cancelled' || actualFillSize === 0) {
              return {
                success: false,
                message: `open positionfailed:order${finalOrderStatus === 'cancelled' ? '被cancel' : 'not filled'}(orderID: ${order.id})`,
              };
            }
            
            // successful获取order信息,跳出循环
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`获取order详情failed(重试${retryCount}次): ${error.message}`);
              // 如果无法获取order详情,使用estimated值继续
              logger.warn(`使用estimated值继续: 数量=${Math.abs(size)}, 价格=${currentPrice}`);
              actualFillSize = Math.abs(size);
              actualFillPrice = currentPrice;
            } else {
              logger.warn(`获取order详情failed,${retryCount}/${maxRetries} 次重试...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      //  使用actualfilled数量和价格记录到database
      const finalQuantity = actualFillSize > 0 ? actualFillSize : Math.abs(size);

      // 计算fee(taker费率 0.05%)
      // fee = contractnotional value * 0.05%
      // contractnotional value = contracts * quantoMultiplier * 价格
      const positionValue = finalQuantity * quantoMultiplier * actualFillPrice;
      const fee = positionValue * 0.0005; // 0.05%
      
      // 记录open position交易
      // side: positiondirection(long=long, short=short)
      // actual执行: longopen position=buy(+size), shortopen position=sell(-size)
      // 映射状态:finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';
      
      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, fee, timestamp, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,            // positiondirection(long/short)
          "open",
          actualFillPrice, // 使用actualfilled价格
          finalQuantity,   // 使用actualfilled数量
          leverage,
          fee,            // fee
          new Date().toISOString(),
          dbStatus,
        ],
      });
      
      // 不设置stop-losstake-profitorder
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
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // 递增等待time

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

            break; // position已verify,跳出循环
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

      // 如果未能从交易所获取liquidation price,使用估算公式(仅作为后备)
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
        
      // 先check是否已存在position
      const existingResult = await dbClient.execute({
        sql: "SELECT symbol FROM positions WHERE symbol = ?",
        args: [symbol],
      });
      
      if (existingResult.rows.length > 0) {
        // update现有position - 🔥 Use ACTUAL exchange quantity
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
        contractAmount, // actual币的数量
        price: actualFillPrice,
        leverage,
        actualMargin,
        message: `✅ successfulopen position ${symbol} ${side === "long" ? "long" : "short"} ${Math.abs(size)}  contracts (${contractAmount.toFixed(4)} ${symbol}),filled价 ${formatPrice(actualFillPrice)},margin ${actualMargin.toFixed(2)} USDT,leverage ${leverage}x.系统已自动设置stop-loss(SL)保护,take-profit(TP)将由利润管理器动态调整.`,
      };
    } catch (error: any) {
      logger.error(`❌ open positionfailed ${symbol} ${side}: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `open positionfailed: ${error.message}`,
      };
    }
  },
});

/**
 * Close Position Tool
 */
export const closePositionTool = createTool({
  name: "closePosition",
  description: "close position - 关闭指定symbol的position.自动cancel该symbol的所有SL/TPorder(defensive programming - 确保close position后不会有遗留ordertriggered).",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("symbol code"),
    percentage: z.number().min(1).max(100).default(100).describe("close position百分比(1-100)"),
  }),
  execute: async ({ symbol, percentage }) => {
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);
    
    try {
      //  Parameter verification
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        return {
          success: false,
          message: `invalidclose position百分比: ${percentage}(must在1-100之间)`,
        };
      }
      
      //  直接从交易所获取最new的position信息(不依赖database)
      const allPositions = await client.getPositions();
      const exchangePosition = allPositions.find((p) => p.symbol === symbol);

      if (!exchangePosition || exchangePosition.quantity === 0) {
        return {
          success: false,
          message: `没有找到 ${symbol} 的position`,
        };
      }

      // 从交易所获取实时数据
      const side = exchangePosition.side;
      const quantity = exchangePosition.quantity;
      let entryPrice = exchangePosition.entryPrice;
      let currentPrice = exchangePosition.currentPrice;
      const leverage = exchangePosition.leverage;
      const totalUnrealizedPnl = exchangePosition.unrealizedPnl;

      //  如果价格为0,获取实时行情作为后备
      if (currentPrice === 0 || entryPrice === 0) {
        const ticker = await client.getFuturesTicker(symbol);
        if (currentPrice === 0) {
          currentPrice = ticker.markPrice;
          logger.warn(`position标记价格为0,使用行情价格: ${currentPrice}`);
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice; // 如果open position价为0,使用current价格
          logger.warn(`positionopen position价为0,使用current价格: ${entryPrice}`);
        }
      }
      
      // 计算close position数量 - No rounding, preserve full decimal precision
      const closeSize = (quantity * percentage) / 100;
      const size = side === "long" ? -closeSize : closeSize;
      
      //  获取contract乘数用于计算PnL和fee
      const quantoMultiplier = await getQuantoMultiplier(contract);
      
      // 🔥 不再依赖交易所返回的unrealisedPnl,始终手动计算gross PnL
      // 手动计算PnL公式:
      // 对于long:(currentPrice - entryPrice) * quantity * quantoMultiplier
      // 对于short:(entryPrice - currentPrice) * quantity * quantoMultiplier
      const priceChange = side === "long" 
        ? (currentPrice - entryPrice) 
        : (entryPrice - currentPrice);
      
      const grossPnl = priceChange * closeSize * quantoMultiplier;
      
      logger.info(`estimatedPnL: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)} USDT (price change: ${priceChange.toFixed(4)})`);
      
      //  计算fee(open position + close position)
      const openFee = entryPrice * closeSize * quantoMultiplier * 0.0005;
      const closeFee = currentPrice * closeSize * quantoMultiplier * 0.0005;
      const totalFees = openFee + closeFee;
      
      // net PnL = gross PnL - total fees(此值为estimated,close position后会基于actualfilled价重new计算)
      let pnl = grossPnl - totalFees;
      
      logger.info(`close position ${symbol} ${side === "long" ? "long" : "short"} ${closeSize} contracts (入场: ${entryPrice.toFixed(2)}, current: ${currentPrice.toFixed(2)})`);

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
        reduceOnly: true, // 只减仓,不opennew仓
      });
      
      //  等待并verifyorder状态(带重试)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      //  获取actualfilled价格和数量(最多重试3次)
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

            // 获取actualfilled价格
            if (orderDetail.price > 0) {
              actualExitPrice = orderDetail.price;
            }
            
            logger.info(`filled: ${actualCloseSize} contracts @ ${actualExitPrice.toFixed(2)} USDT`);
            
            //  verifyfilled价格的合理性(slippage protection)
            const priceDeviation = Math.abs(actualExitPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.03) {
              // close position时允许3%slippage(比open position宽松,因为可能是紧急stop-loss)
              logger.warn(`⚠️ close positionfilled价deviationexceeds3%: ${currentPrice.toFixed(2)} → ${actualExitPrice.toFixed(2)} (deviation ${(priceDeviation * 100).toFixed(2)}%)`);
            }
            
            //  重new计算actualPnL(基于真实filled价格)
            // 获取contract乘数
            const quantoMultiplier = await getQuantoMultiplier(contract);
            
            const priceChange = side === "long" 
              ? (actualExitPrice - entryPrice) 
              : (entryPrice - actualExitPrice);
            
            // PnL = Price change * contracts * contract乘数
            const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
            
            //  扣除fee(open position + close position)
            // entry fee = open positionnotional value * 0.05%
            const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // exit fee = close positionnotional value * 0.05%
            const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // total fees
            const totalFees = openFee + closeFee;
            
            // net PnL = gross PnL - total fees
            pnl = grossPnl - totalFees;
            
            logger.info(`PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
            
            // successful获取order信息,跳出循环
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`获取close positionorder详情failed(重试${retryCount}次): ${error.message}`);
              // 如果无法获取order详情,使用estimated值
              logger.warn(`使用estimated值继续: 数量=${closeSize}, 价格=${currentPrice}`);
              actualCloseSize = closeSize;
              actualExitPrice = currentPrice;
              // 重new计算PnL(需要乘以contract乘数)
              const quantoMultiplier = await getQuantoMultiplier(contract);
              const priceChange = side === "long" 
                ? (actualExitPrice - entryPrice) 
                : (entryPrice - actualExitPrice);
              const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
              // 扣除fee
              const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
              const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
              pnl = grossPnl - openFee - closeFee;
            } else {
              logger.warn(`获取close positionorder详情failed,${retryCount}/${maxRetries} 次重试...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      // 获取account信息用于记录currenttotal balance
      const account = await client.getFuturesAccount();
      const totalBalance = account.totalBalance;
      
      //  计算total fees(open position + close position)用于database记录
      // 需要获取contract乘数
      const dbQuantoMultiplier = await getQuantoMultiplier(contract);
      
      // entry fee = open positionnotional value * 0.05%
      const dbOpenFee = entryPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // exit fee = close positionnotional value * 0.05%
      const dbCloseFee = actualExitPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // total fees
      const totalFee = dbOpenFee + dbCloseFee;
      
      // 🔥 关键verify:checkPnL计算是否正确
      const notionalValue = actualExitPrice * actualCloseSize * dbQuantoMultiplier;
      const priceChangeCheck = side === "long" 
        ? (actualExitPrice - entryPrice) 
        : (entryPrice - actualExitPrice);
      const expectedPnl = priceChangeCheck * actualCloseSize * dbQuantoMultiplier - totalFee;
      
      // 检测PnL是否被error地设置为notional value
      if (Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
        logger.error(`🚨 检测到PnL计算异常！`);
        logger.error(`  currentpnl: ${pnl.toFixed(2)} USDT 接近notional value ${notionalValue.toFixed(2)} USDT`);
        logger.error(`  预期pnl: ${expectedPnl.toFixed(2)} USDT`);
        logger.error(`  open position价: ${entryPrice}, exit price: ${actualExitPrice}, 数量: ${actualCloseSize}, contract乘数: ${dbQuantoMultiplier}`);
        logger.error(`  price change: ${priceChangeCheck.toFixed(4)}, fee: ${totalFee.toFixed(4)}`);
        
        // 强制修正为正确值
        pnl = expectedPnl;
        logger.warn(`  已自动修正pnl为: ${pnl.toFixed(2)} USDT`);
      }
      
      // 详细日志记录(用于debug)
      logger.info(`【close positionPnL详情】${symbol} ${side}`);
      logger.info(`  open position价: ${entryPrice.toFixed(4)}, exit price: ${actualExitPrice.toFixed(4)}, 数量: ${actualCloseSize} contracts`);
      logger.info(`  price change: ${priceChangeCheck.toFixed(4)}, contract乘数: ${dbQuantoMultiplier}`);
      logger.info(`  gross PnL: ${(priceChangeCheck * actualCloseSize * dbQuantoMultiplier).toFixed(2)} USDT`);
      logger.info(`  entry fee: ${dbOpenFee.toFixed(4)} USDT, exit fee: ${dbCloseFee.toFixed(4)} USDT`);
      logger.info(`  total fees: ${totalFee.toFixed(4)} USDT`);
      logger.info(`  net PnL: ${pnl.toFixed(2)} USDT`);
      
      // 获取entry_order_id from database for linking
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

      // 记录close position交易
      // side: 原positiondirection(long/short)
      // actual执行direction: longclose position=sell, shortclose position=buy
      // pnl: net PnL(已扣除fee)
      // fee: total fees(open position+close position)
      // 映射状态:finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';

      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,             // 原positiondirection(便于统计某个symbol的多空PnL)
          "close",
          actualExitPrice,   // 使用actualfilled价格
          actualCloseSize,   // 使用actualfilled数量
          leverage,
          pnl,              // net PnL(已扣除fee)
          totalFee,         // total fees(open position+close position)
          new Date().toISOString(),
          dbStatus,
          'manual',         // Manual close by LLM
          entryOrderId,     // 🔥 Link to entry order
        ],
      });

      // 如果全部close position,从position表delete；否则不操作(交由sync任务update)
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
        closedSize: actualCloseSize,  // 使用actualfilled数量
        entryPrice,
        exitPrice: actualExitPrice,   // 使用actualfilled价格
        leverage,
        pnl,                          // net PnL(已扣除fee)
        fee: totalFee,                // total fees
        totalBalance,
        message: `successfulclose position ${symbol} ${actualCloseSize}  contracts,entry price ${formatPrice(entryPrice)},exit price ${formatPrice(actualExitPrice)},net PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (已扣fee ${totalFee.toFixed(2)} USDT),currenttotal balance ${totalBalance.toFixed(2)} USDT`,
      };
    } catch (error: any) {
      logger.error(`close positionfailed: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `close positionfailed: ${error.message}`,
      };
    }
  },
});

/**
 * Cancel Order Tool
 */
export const cancelOrderTool = createTool({
  name: "cancelOrder",
  description: "cancel指定的pending order",
  parameters: z.object({
    orderId: z.string().describe("orderID"),
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

