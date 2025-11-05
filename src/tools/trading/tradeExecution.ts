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
 * 交易执行工具
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
 * - For prices >= $1: show 2 decimals (e.g., 95000.42 for BTC)
 */
function formatPrice(price: number): string {
  if (price < 1) {
    return price.toFixed(5);
  }
  return price.toFixed(2);
}


/**
 * 开仓工具
 */
export const openPositionTool = createTool({
  name: "openPosition",
  description: "开仓 - 做多或做空指定币种（使用市价单，立即以当前市场价格成交）。IMPORTANT: 1) 开仓前必须先用getAccountBalance和getPositions工具查询可用资金和现有持仓，避免资金不足。2) 自动取消该币种的所有遗留SL/TP订单（defensive programming - 无需手动调用cancelAllOrdersForSymbol）。3) 交易手续费约0.05%，避免频繁交易。4) 开仓时不设置止盈止损，你需要在每个周期主动决策是否平仓，或使用setTakeProfit/setStopLoss工具设置。",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    side: z.enum(["long", "short"]).describe("方向：long=做多，short=做空"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe(`杠杆倍数（1-${RISK_PARAMS.MAX_LEVERAGE}倍，根据环境变量MAX_LEVERAGE配置）`),
    amountUsdt: z.number().describe("开仓金额（USDT）"),
  }),
  execute: async ({ symbol, side, leverage, amountUsdt }) => {
    // 开仓时不设置止盈止损，由 AI 在每个周期主动决策
    const stopLoss = undefined;
    const takeProfit = undefined;
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);

    try {
      //  参数验证
      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
        return {
          success: false,
          message: `无效的开仓金额: ${amountUsdt}`,
        };
      }
      
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > RISK_PARAMS.MAX_LEVERAGE) {
        return {
          success: false,
          message: `无效的杠杆倍数: ${leverage}（必须在1-${RISK_PARAMS.MAX_LEVERAGE}之间，最大值由环境变量MAX_LEVERAGE控制）`,
        };
      }
      
      // ====== 开仓前强制风控检查 ======
      
      // 1. 检查持仓数量（最多5个）
      const allPositions = await client.getPositions();
      const activePositions = allPositions; // Already filtered in adapter

      if (activePositions.length >= RISK_PARAMS.MAX_POSITIONS) {
        return {
          success: false,
          message: `已达到最大持仓数量限制（${RISK_PARAMS.MAX_POSITIONS}个），当前持仓 ${activePositions.length} 个，无法开新仓`,
        };
      }

      // 2. 检查该币种是否已有持仓（禁止双向持仓）
      const existingPosition = activePositions.find((p) => p.symbol === symbol);

      if (existingPosition) {
        const existingSide = existingPosition.side;

        if (existingSide !== side) {
          return {
            success: false,
            message: `${symbol} 已有${existingSide === "long" ? "多" : "空"}单持仓，禁止同时持有双向持仓。请先平掉${existingSide === "long" ? "多" : "空"}单后再开${side === "long" ? "多" : "空"}单。`,
          };
        }

        // 如果方向相同，允许加仓（但需要注意总持仓限制）
        logger.info(`${symbol} 已有${side === "long" ? "多" : "空"}单持仓，允许加仓`);
      }
      
      // 3. 获取账户信息
      const account = await client.getFuturesAccount();
      const unrealisedPnl = account.unrealisedPnl;
      const totalBalance = account.totalBalance;
      const availableBalance = account.availableBalance;
      
      if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
        return {
          success: false,
          message: `账户可用资金异常: ${availableBalance} USDT`,
        };
      }
      
      // 4. 检查账户回撤（从数据库获取初始净值和峰值净值）
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
          message: `账户回撤已达 ${drawdownFromPeak.toFixed(2)}% ≥ ${RISK_PARAMS.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT}%，触发风控保护，禁止新开仓`,
        };
      }
      
      // 5. 检查总敞口（不超过账户净值的15倍）
      let currentTotalExposure = 0;
      for (const pos of activePositions) {
        const posSize = pos.quantity;
        const entryPrice = pos.entryPrice;
        const posLeverage = pos.leverage;
        // 获取合约乘数
        const posQuantoMultiplier = await getQuantoMultiplier(pos.exchangeSymbol);
        const posValue = posSize * entryPrice * posQuantoMultiplier;
        currentTotalExposure += posValue;
      }
      
      const newExposure = amountUsdt * leverage;
      const totalExposure = currentTotalExposure + newExposure;
      const maxAllowedExposure = totalBalance * RISK_PARAMS.MAX_LEVERAGE; // 使用配置的最大杠杆
      
      if (totalExposure > maxAllowedExposure) {
        return {
          success: false,
          message: `新开仓将导致总敞口 ${totalExposure.toFixed(2)} USDT 超过限制 ${maxAllowedExposure.toFixed(2)} USDT（账户净值的${RISK_PARAMS.MAX_LEVERAGE}倍），拒绝开仓`,
        };
      }
      
      // 6. 检查单笔仓位（建议不超过账户净值的30%）
      const maxSinglePosition = totalBalance * 0.30; // 30%
      if (amountUsdt > maxSinglePosition) {
        logger.warn(`开仓金额 ${amountUsdt.toFixed(2)} USDT 超过建议仓位 ${maxSinglePosition.toFixed(2)} USDT（账户净值的30%）`);
      }
      
      // ====== 风控检查通过，继续开仓 ======
      
      let adjustedAmountUsdt = amountUsdt;
      
      // 设置杠杆
      await client.setLeverage(symbol, leverage);

      // 获取当前价格和合约信息
      const ticker = await client.getFuturesTicker(symbol);
      const currentPrice = ticker.lastPrice;
      const contractInfo = await client.getContractInfo(symbol);

      // 永续合约的保证金计算
      // 注意：使用"张数"作为单位，每张合约代表一定数量的币
      // 对于 BTC_USDT: 1张 = 0.0001 BTC
      // 保证金计算：保证金 = (张数 * quantoMultiplier * 价格) / 杠杆
      
      // 获取合约乘数
      const quantoMultiplier = await getQuantoMultiplier(contract);
      const minSize = contractInfo.orderSizeMin;
      const maxSize = contractInfo.orderSizeMax;
      
      // 计算可以开多少张合约
      // adjustedAmountUsdt = (quantity * quantoMultiplier * currentPrice) / leverage
      // => quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice)
      let quantity = (adjustedAmountUsdt * leverage) / (quantoMultiplier * currentPrice);

      // 向下取整到整数张数（合约必须是整数）
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
              message: `Binance要求最小订单价值20 USDT。${symbol}价格${currentPrice} USDT，最少需要${minQuantityForNotional.toFixed(3)}张合约（${MIN_NOTIONAL} USDT订单价值），需要保证金${requiredMargin.toFixed(2)} USDT（${leverage}x杠杆），但当前可用资金仅${adjustedAmountUsdt.toFixed(2)} USDT。建议增加仓位大小或选择价格更低的币种。`,
            };
          }

          // Adjust quantity to meet minimum notional
          quantity = minQuantityForNotional;
          logger.info(`调整 ${symbol} 数量从 ${(notional / currentPrice).toFixed(3)} 到 ${quantity.toFixed(3)} 以满足Binance最小订单价值要求(20 USDT)`);
        }
      }

      let size = side === "long" ? quantity : -quantity;

      // 最后验证：如果 size 为 0 或者太小，放弃开仓
      if (Math.abs(size) < minSize) {
        const minMargin = (minSize * quantoMultiplier * currentPrice) / leverage;
        return {
          success: false,
          message: `计算的数量 ${Math.abs(size)} 张小于最小限制 ${minSize} 张，需要至少 ${minMargin.toFixed(2)} USDT 保证金（当前${adjustedAmountUsdt.toFixed(2)} USDT，杠杆${leverage}x）`,
        };
      }
      
      // 计算实际使用的保证金
      let actualMargin = (Math.abs(size) * quantoMultiplier * currentPrice) / leverage;
      
      logger.info(`开仓 ${symbol} ${side === "long" ? "做多" : "做空"} ${Math.abs(size)}张 (杠杆${leverage}x)`);

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

      //  市价单开仓（不设置止盈止损）
      const order = await client.placeOrder({
        symbol,
        side,
        quantity: Math.abs(size),
        leverage,
        // price: undefined means market order
      });

      //  等待并验证订单状态（带重试）
      // 增加等待时间，确保交易所 API 更新持仓信息
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      //  检查订单状态并获取实际成交价格（最多重试3次）
      let finalOrderStatus = order.status;
      let actualFillSize = 0;
      let actualFillPrice = currentPrice; // 默认使用当前价格

      if (order.id) {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const orderDetail = await client.getOrder(order.id);
            finalOrderStatus = orderDetail.status;
            actualFillSize = orderDetail.filled;

            //  获取实际成交价格
            if (orderDetail.price > 0) {
              actualFillPrice = orderDetail.price;
            }
            
            logger.info(`成交: ${actualFillSize}张 @ ${actualFillPrice.toFixed(2)} USDT`);
            
            //  验证成交价格的合理性（滑点保护）
            const priceDeviation = Math.abs(actualFillPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.02) {
              // 滑点超过2%，拒绝此次交易（回滚）
              logger.error(`❌ 成交价偏离超过2%: ${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)} (偏离 ${(priceDeviation * 100).toFixed(2)}%)，拒绝交易`);
              
              // 尝试平仓回滚（如果已经成交）
              try {
                await client.placeOrder({
                  symbol,
                  side: side === 'long' ? 'short' : 'long', // Opposite side
                  quantity: Math.abs(size),
                  reduceOnly: true,
                });
                logger.info(`已回滚交易`);
              } catch (rollbackError: any) {
                logger.error(`回滚失败: ${rollbackError.message}，请手动处理`);
              }
              
              return {
                success: false,
                message: `开仓失败：成交价偏离超过2% (${currentPrice.toFixed(2)} → ${actualFillPrice.toFixed(2)})，已拒绝交易`,
              };
            }
            
            // 如果订单被取消或未成交，返回失败
            if (finalOrderStatus === 'cancelled' || actualFillSize === 0) {
              return {
                success: false,
                message: `开仓失败：订单${finalOrderStatus === 'cancelled' ? '被取消' : '未成交'}（订单ID: ${order.id}）`,
              };
            }
            
            // 成功获取订单信息，跳出循环
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`获取订单详情失败（重试${retryCount}次）: ${error.message}`);
              // 如果无法获取订单详情，使用预估值继续
              logger.warn(`使用预估值继续: 数量=${Math.abs(size)}, 价格=${currentPrice}`);
              actualFillSize = Math.abs(size);
              actualFillPrice = currentPrice;
            } else {
              logger.warn(`获取订单详情失败，${retryCount}/${maxRetries} 次重试...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      //  使用实际成交数量和价格记录到数据库
      const finalQuantity = actualFillSize > 0 ? actualFillSize : Math.abs(size);

      // 计算手续费（taker费率 0.05%）
      // 手续费 = 合约名义价值 * 0.05%
      // 合约名义价值 = 张数 * quantoMultiplier * 价格
      const positionValue = finalQuantity * quantoMultiplier * actualFillPrice;
      const fee = positionValue * 0.0005; // 0.05%
      
      // 记录开仓交易
      // side: 持仓方向（long=做多, short=做空）
      // 实际执行: long开仓=买入(+size), short开仓=卖出(-size)
      // 映射状态：finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';
      
      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, fee, timestamp, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,            // 持仓方向（long/short）
          "open",
          actualFillPrice, // 使用实际成交价格
          finalQuantity,   // 使用实际成交数量
          leverage,
          fee,            // 手续费
          new Date().toISOString(),
          dbStatus,
        ],
      });
      
      // 不设置止损止盈订单
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
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // 递增等待时间

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

            break; // 持仓已验证，跳出循环
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

      // 如果未能从交易所获取强平价，使用估算公式（仅作为后备）
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
        
      // 先检查是否已存在持仓
      const existingResult = await dbClient.execute({
        sql: "SELECT symbol FROM positions WHERE symbol = ?",
        args: [symbol],
      });
      
      if (existingResult.rows.length > 0) {
        // 更新现有持仓 - 🔥 Use ACTUAL exchange quantity
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
        // 插入新持仓 - 🔥 Use ACTUAL exchange quantity
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
            null, // tp_orders: initialized as empty, will be populated by setTakeProfit tool
            null, // sl_orders: initialized as empty, will be populated by setStopLoss tool
            order.id?.toString() || "",
            new Date().toISOString(),
          ],
        });
        logger.info(`✅ Inserted position in database: ${symbol} ${side} ${actualPositionQuantity} units`);
      }
      
      const contractAmount = Math.abs(size) * quantoMultiplier;
      const totalValue = contractAmount * actualFillPrice;

      return {
        success: true,
        orderId: order.id?.toString(),
        symbol,
        side,
        size: Math.abs(size), // 合约张数
        contractAmount, // 实际币的数量
        price: actualFillPrice,
        leverage,
        actualMargin,
        message: `✅ 成功开仓 ${symbol} ${side === "long" ? "做多" : "做空"} ${Math.abs(size)} 张 (${contractAmount.toFixed(4)} ${symbol})，成交价 ${formatPrice(actualFillPrice)}，保证金 ${actualMargin.toFixed(2)} USDT，杠杆 ${leverage}x。⚠️ 未设置止盈止损，请在每个周期主动决策是否平仓。`,
      };
    } catch (error: any) {
      logger.error(`❌ 开仓失败 ${symbol} ${side}: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `开仓失败: ${error.message}`,
      };
    }
  },
});

/**
 * 平仓工具
 */
export const closePositionTool = createTool({
  name: "closePosition",
  description: "平仓 - 关闭指定币种的持仓。自动取消该币种的所有SL/TP订单（defensive programming - 确保平仓后不会有遗留订单触发）。",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    percentage: z.number().min(1).max(100).default(100).describe("平仓百分比（1-100）"),
  }),
  execute: async ({ symbol, percentage }) => {
    const client = createExchangeClient();
    const contract = client.normalizeSymbol(symbol);
    
    try {
      //  参数验证
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        return {
          success: false,
          message: `无效的平仓百分比: ${percentage}（必须在1-100之间）`,
        };
      }
      
      //  直接从交易所获取最新的持仓信息（不依赖数据库）
      const allPositions = await client.getPositions();
      const exchangePosition = allPositions.find((p) => p.symbol === symbol);

      if (!exchangePosition || exchangePosition.quantity === 0) {
        return {
          success: false,
          message: `没有找到 ${symbol} 的持仓`,
        };
      }

      // 从交易所获取实时数据
      const side = exchangePosition.side;
      const quantity = exchangePosition.quantity;
      let entryPrice = exchangePosition.entryPrice;
      let currentPrice = exchangePosition.currentPrice;
      const leverage = exchangePosition.leverage;
      const totalUnrealizedPnl = exchangePosition.unrealizedPnl;

      //  如果价格为0，获取实时行情作为后备
      if (currentPrice === 0 || entryPrice === 0) {
        const ticker = await client.getFuturesTicker(symbol);
        if (currentPrice === 0) {
          currentPrice = ticker.markPrice;
          logger.warn(`持仓标记价格为0，使用行情价格: ${currentPrice}`);
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice; // 如果开仓价为0，使用当前价格
          logger.warn(`持仓开仓价为0，使用当前价格: ${entryPrice}`);
        }
      }
      
      // 计算平仓数量 - No rounding, preserve full decimal precision
      const closeSize = (quantity * percentage) / 100;
      const size = side === "long" ? -closeSize : closeSize;
      
      //  获取合约乘数用于计算盈亏和手续费
      const quantoMultiplier = await getQuantoMultiplier(contract);
      
      // 🔥 不再依赖交易所返回的unrealisedPnl，始终手动计算毛盈亏
      // 手动计算盈亏公式：
      // 对于做多：(currentPrice - entryPrice) * quantity * quantoMultiplier
      // 对于做空：(entryPrice - currentPrice) * quantity * quantoMultiplier
      const priceChange = side === "long" 
        ? (currentPrice - entryPrice) 
        : (entryPrice - currentPrice);
      
      const grossPnl = priceChange * closeSize * quantoMultiplier;
      
      logger.info(`预估盈亏: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)} USDT (价格变动: ${priceChange.toFixed(4)})`);
      
      //  计算手续费（开仓 + 平仓）
      const openFee = entryPrice * closeSize * quantoMultiplier * 0.0005;
      const closeFee = currentPrice * closeSize * quantoMultiplier * 0.0005;
      const totalFees = openFee + closeFee;
      
      // 净盈亏 = 毛盈亏 - 总手续费（此值为预估，平仓后会基于实际成交价重新计算）
      let pnl = grossPnl - totalFees;
      
      logger.info(`平仓 ${symbol} ${side === "long" ? "做多" : "做空"} ${closeSize}张 (入场: ${entryPrice.toFixed(2)}, 当前: ${currentPrice.toFixed(2)})`);

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
        const exchangeName = client.getExchangeName();

        if (exchangeName === 'Binance') {
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
        } else {
          // For other exchanges (Gate.io), regular getOpenOrders should work
          const allOpenOrders = await client.getOpenOrders(symbol);
          if (allOpenOrders.length > 0) {
            logger.info(`🔍 Found ${allOpenOrders.length} open orders for ${symbol}, canceling all...`);
            for (const order of allOpenOrders) {
              try {
                await client.cancelOrder(order.id, symbol);
                logger.info(`🔄 Cancelled orphan order ${order.id}`);
              } catch (e: any) {
                logger.warn(`⚠️ Could not cancel order ${order.id}: ${e.message}`);
              }
            }
          }
        }
      } catch (e: any) {
        logger.warn(`⚠️ Could not fetch/cancel open orders for ${symbol}: ${e.message}`);
      }

      //  市价单平仓
      const order = await client.placeOrder({
        symbol,
        side: side === 'long' ? 'short' : 'long', // Opposite side to close
        quantity: closeSize,
        reduceOnly: true, // 只减仓，不开新仓
      });
      
      //  等待并验证订单状态（带重试）
      await new Promise(resolve => setTimeout(resolve, 500));
      
      //  获取实际成交价格和数量（最多重试3次）
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

            // 获取实际成交价格
            if (orderDetail.price > 0) {
              actualExitPrice = orderDetail.price;
            }
            
            logger.info(`成交: ${actualCloseSize}张 @ ${actualExitPrice.toFixed(2)} USDT`);
            
            //  验证成交价格的合理性（滑点保护）
            const priceDeviation = Math.abs(actualExitPrice - currentPrice) / currentPrice;
            if (priceDeviation > 0.03) {
              // 平仓时允许3%滑点（比开仓宽松，因为可能是紧急止损）
              logger.warn(`⚠️ 平仓成交价偏离超过3%: ${currentPrice.toFixed(2)} → ${actualExitPrice.toFixed(2)} (偏离 ${(priceDeviation * 100).toFixed(2)}%)`);
            }
            
            //  重新计算实际盈亏（基于真实成交价格）
            // 获取合约乘数
            const quantoMultiplier = await getQuantoMultiplier(contract);
            
            const priceChange = side === "long" 
              ? (actualExitPrice - entryPrice) 
              : (entryPrice - actualExitPrice);
            
            // 盈亏 = 价格变化 * 张数 * 合约乘数
            const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
            
            //  扣除手续费（开仓 + 平仓）
            // 开仓手续费 = 开仓名义价值 * 0.05%
            const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // 平仓手续费 = 平仓名义价值 * 0.05%
            const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
            // 总手续费
            const totalFees = openFee + closeFee;
            
            // 净盈亏 = 毛盈亏 - 总手续费
            pnl = grossPnl - totalFees;
            
            logger.info(`盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
            
            // 成功获取订单信息，跳出循环
            break;
            
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`获取平仓订单详情失败（重试${retryCount}次）: ${error.message}`);
              // 如果无法获取订单详情，使用预估值
              logger.warn(`使用预估值继续: 数量=${closeSize}, 价格=${currentPrice}`);
              actualCloseSize = closeSize;
              actualExitPrice = currentPrice;
              // 重新计算盈亏（需要乘以合约乘数）
              const quantoMultiplier = await getQuantoMultiplier(contract);
              const priceChange = side === "long" 
                ? (actualExitPrice - entryPrice) 
                : (entryPrice - actualExitPrice);
              const grossPnl = priceChange * actualCloseSize * quantoMultiplier;
              // 扣除手续费
              const openFee = entryPrice * actualCloseSize * quantoMultiplier * 0.0005;
              const closeFee = actualExitPrice * actualCloseSize * quantoMultiplier * 0.0005;
              pnl = grossPnl - openFee - closeFee;
            } else {
              logger.warn(`获取平仓订单详情失败，${retryCount}/${maxRetries} 次重试...`);
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }
      
      // 获取账户信息用于记录当前总资产
      const account = await client.getFuturesAccount();
      const totalBalance = account.totalBalance;
      
      //  计算总手续费（开仓 + 平仓）用于数据库记录
      // 需要获取合约乘数
      const dbQuantoMultiplier = await getQuantoMultiplier(contract);
      
      // 开仓手续费 = 开仓名义价值 * 0.05%
      const dbOpenFee = entryPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // 平仓手续费 = 平仓名义价值 * 0.05%
      const dbCloseFee = actualExitPrice * actualCloseSize * dbQuantoMultiplier * 0.0005;
      // 总手续费
      const totalFee = dbOpenFee + dbCloseFee;
      
      // 🔥 关键验证：检查盈亏计算是否正确
      const notionalValue = actualExitPrice * actualCloseSize * dbQuantoMultiplier;
      const priceChangeCheck = side === "long" 
        ? (actualExitPrice - entryPrice) 
        : (entryPrice - actualExitPrice);
      const expectedPnl = priceChangeCheck * actualCloseSize * dbQuantoMultiplier - totalFee;
      
      // 检测盈亏是否被错误地设置为名义价值
      if (Math.abs(pnl - notionalValue) < Math.abs(pnl - expectedPnl)) {
        logger.error(`🚨 检测到盈亏计算异常！`);
        logger.error(`  当前pnl: ${pnl.toFixed(2)} USDT 接近名义价值 ${notionalValue.toFixed(2)} USDT`);
        logger.error(`  预期pnl: ${expectedPnl.toFixed(2)} USDT`);
        logger.error(`  开仓价: ${entryPrice}, 平仓价: ${actualExitPrice}, 数量: ${actualCloseSize}, 合约乘数: ${dbQuantoMultiplier}`);
        logger.error(`  价格变动: ${priceChangeCheck.toFixed(4)}, 手续费: ${totalFee.toFixed(4)}`);
        
        // 强制修正为正确值
        pnl = expectedPnl;
        logger.warn(`  已自动修正pnl为: ${pnl.toFixed(2)} USDT`);
      }
      
      // 详细日志记录（用于debug）
      logger.info(`【平仓盈亏详情】${symbol} ${side}`);
      logger.info(`  开仓价: ${entryPrice.toFixed(4)}, 平仓价: ${actualExitPrice.toFixed(4)}, 数量: ${actualCloseSize}张`);
      logger.info(`  价格变动: ${priceChangeCheck.toFixed(4)}, 合约乘数: ${dbQuantoMultiplier}`);
      logger.info(`  毛盈亏: ${(priceChangeCheck * actualCloseSize * dbQuantoMultiplier).toFixed(2)} USDT`);
      logger.info(`  开仓手续费: ${dbOpenFee.toFixed(4)} USDT, 平仓手续费: ${dbCloseFee.toFixed(4)} USDT`);
      logger.info(`  总手续费: ${totalFee.toFixed(4)} USDT`);
      logger.info(`  净盈亏: ${pnl.toFixed(2)} USDT`);
      
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

      // 记录平仓交易
      // side: 原持仓方向（long/short）
      // 实际执行方向: long平仓=卖出, short平仓=买入
      // pnl: 净盈亏（已扣除手续费）
      // fee: 总手续费（开仓+平仓）
      // 映射状态：finished -> filled, open -> pending
      const dbStatus = finalOrderStatus === 'finished' ? 'filled' : 'pending';

      await dbClient.execute({
        sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          order.id?.toString() || "",
          symbol,
          side,             // 原持仓方向（便于统计某个币种的多空盈亏）
          "close",
          actualExitPrice,   // 使用实际成交价格
          actualCloseSize,   // 使用实际成交数量
          leverage,
          pnl,              // 净盈亏（已扣除手续费）
          totalFee,         // 总手续费（开仓+平仓）
          new Date().toISOString(),
          dbStatus,
          'manual',         // Manual close by LLM
          entryOrderId,     // 🔥 Link to entry order
        ],
      });

      // 如果全部平仓，从持仓表删除；否则不操作（交由同步任务更新）
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
        closedSize: actualCloseSize,  // 使用实际成交数量
        entryPrice,
        exitPrice: actualExitPrice,   // 使用实际成交价格
        leverage,
        pnl,                          // 净盈亏（已扣除手续费）
        fee: totalFee,                // 总手续费
        totalBalance,
        message: `成功平仓 ${symbol} ${actualCloseSize} 张，入场价 ${formatPrice(entryPrice)}，平仓价 ${formatPrice(actualExitPrice)}，净盈亏 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (已扣手续费 ${totalFee.toFixed(2)} USDT)，当前总资产 ${totalBalance.toFixed(2)} USDT`,
      };
    } catch (error: any) {
      logger.error(`平仓失败: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        message: `平仓失败: ${error.message}`,
      };
    }
  },
});

/**
 * 取消订单工具
 */
export const cancelOrderTool = createTool({
  name: "cancelOrder",
  description: "取消指定的挂单",
  parameters: z.object({
    orderId: z.string().describe("订单ID"),
  }),
  execute: async ({ orderId }) => {
    const client = createExchangeClient();

    try {
      await client.cancelOrder(orderId);

      return {
        success: true,
        orderId,
        message: `订单 ${orderId} 已取消`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `取消订单失败: ${error.message}`,
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

      // 9. Use different API based on exchange
      const exchangeName = client.getExchangeName();

      let orderId: string;

      if (exchangeName === 'Binance') {
        // Binance: Use CCXT TAKE_PROFIT_MARKET order
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

        orderId = order.id;
        logger.info(`[Binance] Take-profit order created: ${symbol} ${position.side} ${tpQuantity}@${takeProfitPrice} (order ID: ${orderId})`);


      } else if (exchangeName === 'Gate.io') {
        // Gate.io: Use Price Trigger Order
        const gateAdapter = client as any;
        const gateClient = gateAdapter.getUnderlyingClient();
        const contract = client.normalizeSymbol(symbol);

        // Gate.io uses signed quantity (negative = sell/close long, positive = buy/close short)
        const size = position.side === 'long' ? -tpQuantity : tpQuantity;

        // Create price trigger order
        // rule: 1 = price >= trigger, 2 = price <= trigger
        const rule = position.side === 'long' ? 1 : 2; // long: >= TP price, short: <= TP price

        const trigger = await gateClient.createPriceTriggerOrder({
          contract: contract,
          size: size,
          triggerPrice: takeProfitPrice,
          orderPrice: undefined, // market order
          rule: rule,
        });

        orderId = trigger.id?.toString() || 'unknown';
        logger.info(`[Gate.io] Take-profit order created: ${symbol} ${position.side} ${tpQuantity}@${takeProfitPrice} (trigger ID: ${orderId})`);

      } else {
        return {
          success: false,
          message: `Unsupported exchange: ${exchangeName}`,
        };
      }

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

      // 7. Use different API based on exchange
      const exchangeName = client.getExchangeName();

      if (exchangeName === 'Binance') {
        // Binance: Use CCXT STOP_MARKET order
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

        logger.info(`[Binance] Stop-loss order created: ${symbol} ${position.side} ${stopQuantity}@${stopPrice} (order ID: ${order.id})`);

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

      } else if (exchangeName === 'Gate.io') {
        // Gate.io: Use Price Trigger Order
        const gateAdapter = client as any;
        const gateClient = gateAdapter.getUnderlyingClient();
        const contract = client.normalizeSymbol(symbol);

        // Gate.io uses signed quantity (negative = sell/close long, positive = buy/close short)
        const size = position.side === 'long' ? -stopQuantity : stopQuantity;

        // Create price trigger order
        // rule: 1 = price >= trigger, 2 = price <= trigger
        const rule = position.side === 'long' ? 2 : 1; // long: <= stop price, short: >= stop price

        const trigger = await gateClient.createPriceTriggerOrder({
          contract: contract,
          size: size,
          triggerPrice: stopPrice,
          orderPrice: undefined, // market order
          rule: rule,
        });

        logger.info(`[Gate.io] Stop-loss order created: ${symbol} ${position.side} ${stopQuantity}@${stopPrice} (trigger ID: ${trigger.id})`);

        // 8. Add new SL to the array and save to database
        const orderId = trigger.id?.toString() || 'unknown';
        const newSL: StopLossOrder = {
          price: stopPrice,
          percentage: percentage,
          orderId: orderId,
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
          orderId: orderId,
          symbol,
          side: position.side,
          stopPrice,
          quantity: stopQuantity,
          percentage,
          totalSLs: slCount,
          totalCoverage: coveredPercent,
          message: `✅ Stop-loss set: ${symbol} ${position.side.toUpperCase()} SL${slCount} @ ${formatPrice(stopPrice)} (${percentage}% = ${stopQuantity.toFixed(4)} contracts). Total coverage: ${coveredPercent.toFixed(0)}% across ${slCount} SLs.`,
        };

      } else {
        return {
          success: false,
          message: `Unsupported exchange: ${exchangeName}`,
        };
      }

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

