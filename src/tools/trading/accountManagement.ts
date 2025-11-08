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
 * Account management tools
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createExchangeClient } from "../../services/exchange";
import { createClient } from "@libsql/client";
import { RISK_PARAMS } from "../../config/riskParams";
import { getQuantoMultiplier } from "../../utils/contractUtils";
import { calculatePnL } from "../../utils/pnlCalculator";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({ name: "account-management-tools" });

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
 * Get account balance tool
 */
export const getAccountBalanceTool = createTool({
  name: "getAccountBalance",
  description: "Get account balance and funding information",
  parameters: z.object({}),
  execute: async () => {
    const client = createExchangeClient();
    
    try {
      const account = await client.getFuturesAccount();

      return {
        currency: account.currency,
        totalBalance: account.totalBalance,
        availableBalance: account.availableBalance,
        positionMargin: account.positionMargin,
        orderMargin: account.orderMargin,
        unrealisedPnl: account.unrealisedPnl,
        timestamp: new Date(account.timestamp).toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `Failed to get account balance: ${error.message}`,
      };
    }
  },
});

/**
 * Get current holdings tool
 */
export const getPositionsTool = createTool({
  name: "getPositions",
  description: "get/fetchall current position information",
  parameters: z.object({}),
  execute: async () => {
    const client = createExchangeClient();

    try {
      const positions = await client.getPositions();

      const formattedPositions = positions.map((p) => ({
        contract: p.exchangeSymbol,
        size: p.side === 'long' ? p.quantity : -p.quantity,
        leverage: p.leverage,
        entryPrice: p.entryPrice,
        markPrice: p.currentPrice,
        liquidationPrice: p.liquidationPrice,
        unrealisedPnl: p.unrealizedPnl,
        realisedPnl: p.realizedPnl,
        margin: p.margin,
        side: p.side,
      }));

      return {
        positions: formattedPositions,
        quantity: formattedPositions.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `get/fetchposition failed: ${error.message}`,
      };
    }
  },
});

/**
 * get/fetchunfilled orders tool
 */
export const getOpenOrdersTool = createTool({
  name: "getOpenOrders",
  description: "Get all unfilled pending orders",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).optional().describe("optional: only fetch specified symbol order"),
  }),
  execute: async ({ symbol }) => {
    const client = createExchangeClient();

    try {
      const orders = await client.getOpenOrders(symbol);

      const formattedOrders = orders.map((o) => ({
        orderId: o.id,
        contract: client.normalizeSymbol(o.symbol),
        size: o.side === 'long' ? o.quantity : -o.quantity,
        price: o.price,
        left: o.remaining,
        status: o.status,
        side: o.side,
        isReduceOnly: o.isReduceOnly,
        createdAt: Math.floor(o.timestamp / 1000),
      }));

      return {
        orders: formattedOrders,
        quantity: formattedOrders.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `failed to fetch unfilled orders: ${error.message}`,
      };
    }
  },
});

/**
 * check order status tool
 */
export const checkOrderStatusTool = createTool({
  name: "checkOrderStatus",
  description: "check specified order detailed status, including filled price, filled quantity, etc",
  parameters: z.object({
    orderId: z.string().describe("order ID"),
  }),
  execute: async ({ orderId }) => {
    const client = createExchangeClient();

    try {
      const orderDetail = await client.getOrder(orderId);

      const totalSize = orderDetail.quantity;
      const filledSize = orderDetail.filled;
      const leftSize = orderDetail.remaining;
      const fillPrice = orderDetail.price;

      return {
        success: true,
        orderId: orderDetail.id,
        contract: client.normalizeSymbol(orderDetail.symbol),
        status: orderDetail.status,
        totalSize,
        filledSize,
        leftSize,
        fillPrice,
        price: orderDetail.price,
        createdAt: Math.floor(orderDetail.timestamp / 1000),
        finishedAt: orderDetail.status === 'finished' ? Math.floor(orderDetail.timestamp / 1000) : undefined,
        isFullyFilled: leftSize === 0,
        fillPercentage: totalSize > 0 ? (filledSize / totalSize * 100).toFixed(2) : "0",
        message: `order ${orderId} status: ${orderDetail.status}, filled ${filledSize}/${totalSize}  contracts (${totalSize > 0 ? (filledSize / totalSize * 100).toFixed(1) : '0'}%), fill price ${formatPrice(fillPrice)}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `failed to fetch order status: ${error.message}`,
      };
    }
  },
});

/**
 * calculate risk exposure tool
 */
export const calculateRiskTool = createTool({
  name: "calculateRisk",
  description: "calculate current account risk exposure and position size situation",
  parameters: z.object({}),
  execute: async () => {
    const client = createExchangeClient();

    try {
      const [account, positions] = await Promise.all([
        client.getFuturesAccount(),
        client.getPositions(),
      ]);

      const unrealisedPnl = account.unrealisedPnl;
      const totalBalance = account.totalBalance;
      const availableBalance = account.availableBalance;
      
      // calculate per position risk (need to async fetch contract multiplier)
      const positionRisks = await Promise.all(
        positions.map(async (p) => {
          const size = p.quantity;
          const entryPrice = p.entryPrice;
          const leverage = p.leverage;
          const liquidationPrice = p.liquidationPrice;
          const currentPrice = p.currentPrice;
          const pnl = p.unrealizedPnl;

          // fetch contract multiplier (fix: correctly calculate notional value)
          const quantoMultiplier = await getQuantoMultiplier(p.exchangeSymbol);

          // correctly calculate notional value: contracts × entry price × contract multiplier
          const notionalValue = size * entryPrice * quantoMultiplier;
          const margin = notionalValue / leverage;

          // calculate risk percentage (to forced close distance)
          const riskPercent = currentPrice > 0
            ? Math.abs((currentPrice - liquidationPrice) / currentPrice) * 100
            : 0;

          return {
            contract: p.exchangeSymbol,
            notionalValue,
            margin,
            leverage,
            pnl,
            riskPercent,
            side: p.side,
          };
        })
      );
      
      const totalNotional = positionRisks.reduce((sum: number, p: any) => sum + p.notionalValue, 0);
      const totalMargin = positionRisks.reduce((sum: number, p: any) => sum + p.margin, 0);
      const usedMarginPercent = totalBalance > 0 ? (totalMargin / totalBalance) * 100 : 0;
      
      // fetch initial capital from database
      const initialBalanceResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialBalanceResult.rows[0]
        ? Number.parseFloat(initialBalanceResult.rows[0].total_value as string)
        : 100;
      
      const returnPercent = initialBalance > 0 
        ? ((totalBalance - initialBalance) / initialBalance) * 100 
        : 0;
      
      let riskLevel = "low";
      if (usedMarginPercent > 80) {
        riskLevel = "high";
      } else if (usedMarginPercent > 50) {
        riskLevel = "medium";
      }

      return {
        totalBalance,
        availableBalance,
        unrealisedPnl,
        totalNotional,
        totalMargin,
        usedMarginPercent,
        returnPercent,
        positionCount: positionRisks.length,
        positions: positionRisks,
        riskLevel,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `calculate risk failed: ${error.message}`,
      };
    }
  },
});

/**
 * sync positions to database tool
 * 🔥 ID-BASED TRACKING: Uses entry_order_id, sl_order_id, tp_orders to verify everything
 */
export const syncPositionsTool = createTool({
  name: "syncPositions",
  description: "sync exchange position data to local database, use order ID to verify position and stop-loss take-profit status",
  parameters: z.object({}),
  execute: async () => {
    const client = createExchangeClient();

    try {
      logger.info("🔄 Starting ID-based position sync...");

      // 1️⃣ Get current positions from exchange
      const exchangePositions = await client.getPositions();
      logger.info(`📊 Exchange has ${exchangePositions.length} active positions`);

      // 2️⃣ Get ALL existing positions from database with their IDs
      const existingDataResult = await dbClient.execute(
        "SELECT symbol, quantity, entry_price, current_price, side, leverage, tp_orders, sl_orders, sl_order_id, tp_order_id, sl_percentage, tp_percentage, stop_loss, profit_target, entry_order_id, opened_at, confidence, risk_usd, peak_pnl_percent, liquidation_price, unrealized_pnl FROM positions"
      );

      logger.info(`💾 Database has ${existingDataResult.rows.length} position records`);

      // 3️⃣ Check each DB position's SL/TP order status by ID
      const validPositions: Map<string, any> = new Map(); // key = symbol
      const triggeredOrders: Array<{ symbol: string, orderId: string, type: 'SL' | 'TP', status: string }> = [];

      for (const row of existingDataResult.rows) {
        const dbPos = row as any;
        const symbol = dbPos.symbol;
        logger.info(`\n🔍 Checking DB position: ${symbol} (entry_order_id: ${dbPos.entry_order_id})`);

        // ✅ Verify entry order (if we have entry_order_id and it's not "synced")
        if (dbPos.entry_order_id && dbPos.entry_order_id !== "synced" && dbPos.entry_order_id !== "") {
          try {
            const entryOrder = await client.getOrder(dbPos.entry_order_id);
            logger.info(`  ✅ Entry order ${dbPos.entry_order_id}: ${entryOrder.status} (filled: ${entryOrder.filled}/${entryOrder.quantity})`);

            if (entryOrder.status === 'cancelled' || entryOrder.status === 'rejected') {
              logger.warn(`  ⚠️  Entry order was ${entryOrder.status} - position is invalid`);
              continue; // Skip this position
            }
          } catch (error: any) {
            logger.warn(`  ⚠️  Could not verify entry order ${dbPos.entry_order_id}: ${error.message}`);
            // Continue anyway - might be old order ID that exchange no longer has
          }
        }

        // 🛑 Check SL orders status (array of {orderId, price, percentage, triggered} objects)
        if (dbPos.sl_orders && dbPos.sl_orders !== "") {
          try {
            const slOrdersArray = JSON.parse(dbPos.sl_orders);
            const stillActiveSL: any[] = [];

            for (const sl of slOrdersArray) {
              const slOrderId = sl.orderId || sl; // Handle both object format and string format
              try {
                const slOrder = await client.getOrder(slOrderId, symbol); // 🔧 Pass symbol for Binance STOP_MARKET orders
                logger.info(`  🛑 SL order ${slOrderId}: ${slOrder.status} (filled: ${slOrder.filled}/${slOrder.quantity})`);

                if (slOrder.status === 'filled' || slOrder.status === 'finished') {
                  logger.warn(`  🔥 STOP-LOSS TRIGGERED for ${symbol}! Order ${slOrderId} was filled`);
                  triggeredOrders.push({ symbol, orderId: slOrderId, type: 'SL', status: slOrder.status });

                  // Record SL trigger close trade
                  await recordSlTpTrigger(client, dbPos, slOrder, 'SL');

                  // Mark as triggered but keep in array
                  if (typeof sl === 'object') {
                    sl.triggered = true;
                  }
                  // Position should be closed or partially closed - check if all SLs triggered
                } else if (slOrder.status === 'open' || slOrder.status === 'pending') {
                  stillActiveSL.push(sl); // Keep original object format
                } else if (slOrder.status === 'cancelled') {
                  logger.warn(`  ⚠️  SL order ${slOrderId} was cancelled - removing from tracking`);
                  // Don't add to stillActiveSL
                } else {
                  // Unknown status (e.g., NEW, PARTIALLY_FILLED, etc.) - keep order to be safe
                  logger.warn(`  ⚠️  SL order ${slOrderId} has unexpected status: ${slOrder.status} - keeping in tracking`);
                  stillActiveSL.push(sl);
                }
              } catch (error: any) {
                logger.warn(`  ⚠️  Could not verify SL order ${slOrderId}: ${error.message}`);
                stillActiveSL.push(sl); // Keep it - might just be API error
              }
            }

            // Update SL orders list to only active ones
            dbPos.sl_orders = stillActiveSL.length > 0 ? JSON.stringify(stillActiveSL) : null;

            if (stillActiveSL.length === 0 && slOrdersArray.length > 0) {
              logger.info(`  ✅ All SL orders filled/cancelled - clearing SL tracking`);
              dbPos.stop_loss = null;
              // If all SLs triggered, position should be closed - don't continue
              if (slOrdersArray.some((sl: any) => sl.triggered)) {
                continue;
              }
            }
          } catch (error: any) {
            logger.warn(`  ⚠️  Could not parse sl_orders JSON: ${error.message}`);
          }
        }
        else if (dbPos.sl_order_id && dbPos.sl_order_id !== "") {
          try {
            const slOrder = await client.getOrder(dbPos.sl_order_id, symbol); // 🔧 Pass symbol for Binance
            logger.info(`  🛑 Old SL order ${dbPos.sl_order_id}: ${slOrder.status} (filled: ${slOrder.filled}/${slOrder.quantity})`);

            if (slOrder.status === 'filled' || slOrder.status === 'finished') {
              logger.warn(`  🔥 STOP-LOSS TRIGGERED for ${symbol}! Order ${dbPos.sl_order_id} was filled`);
              triggeredOrders.push({ symbol, orderId: dbPos.sl_order_id, type: 'SL', status: slOrder.status });

              // Record SL trigger close trade
              await recordSlTpTrigger(client, dbPos, slOrder, 'SL');

              // Position should be closed - don't keep in validPositions
              continue;
            } else if (slOrder.status === 'cancelled') {
              logger.warn(`  ⚠️  Old SL order was cancelled - removing SL tracking`);
              dbPos.sl_order_id = null;
              dbPos.stop_loss = null;
            }
          } catch (error: any) {
            logger.warn(`  ⚠️  Could not verify old SL order ${dbPos.sl_order_id}: ${error.message}`);
            // Keep the SL order ID - might just be API error
          }
        }

        // 🎯 Check TP orders status (array of {orderId, price, percentage, triggered} objects)
        if (dbPos.tp_orders && dbPos.tp_orders !== "") {
          try {
            const tpOrdersArray = JSON.parse(dbPos.tp_orders);
            const stillActiveTP: any[] = [];

            for (const tp of tpOrdersArray) {
              const tpOrderId = tp.orderId || tp; // Handle both object format and string format
              try {
                const tpOrder = await client.getOrder(tpOrderId, symbol); // 🔧 Pass symbol for Binance TAKE_PROFIT_MARKET orders
                logger.info(`  🎯 TP order ${tpOrderId}: ${tpOrder.status} (filled: ${tpOrder.filled}/${tpOrder.quantity})`);

                if (tpOrder.status === 'filled' || tpOrder.status === 'finished') {
                  logger.warn(`  🔥 TAKE-PROFIT TRIGGERED for ${symbol}! Order ${tpOrderId} was filled`);
                  triggeredOrders.push({ symbol, orderId: tpOrderId, type: 'TP', status: tpOrder.status });

                  // Record TP trigger close trade (might be partial)
                  await recordSlTpTrigger(client, dbPos, tpOrder, 'TP');

                  // Mark as triggered but keep in array
                  if (typeof tp === 'object') {
                    tp.triggered = true;
                  }
                  // Don't add to stillActiveTP
                } else if (tpOrder.status === 'open' || tpOrder.status === 'pending') {
                  stillActiveTP.push(tp); // Keep original object format
                } else if (tpOrder.status === 'cancelled') {
                  logger.warn(`  ⚠️  TP order ${tpOrderId} was cancelled - removing from tracking`);
                  // Don't add to stillActiveTP
                } else {
                  // Unknown status (e.g., NEW, PARTIALLY_FILLED, etc.) - keep order to be safe
                  logger.warn(`  ⚠️  TP order ${tpOrderId} has unexpected status: ${tpOrder.status} - keeping in tracking`);
                  stillActiveTP.push(tp);
                }
              } catch (error: any) {
                logger.warn(`  ⚠️  Could not verify TP order ${tpOrderId}: ${error.message}`);
                stillActiveTP.push(tp); // Keep it - might just be API error
              }
            }

            // Update TP orders list to only active ones
            dbPos.tp_orders = stillActiveTP.length > 0 ? JSON.stringify(stillActiveTP) : null;

            if (stillActiveTP.length === 0 && tpOrdersArray.length > 0) {
              logger.info(`  ✅ All TP orders filled/cancelled - clearing TP tracking`);
              dbPos.profit_target = null;
            }
          } catch (error: any) {
            logger.warn(`  ⚠️  Could not parse tp_orders JSON: ${error.message}`);
          }
        }

        // ✅ Position is still valid
        validPositions.set(symbol, dbPos);
        logger.info(`  ✅ Position ${symbol} verified and valid`);
      }

      logger.info(`\n✅ Verified ${validPositions.size} valid positions in database`);
      logger.info(`🔥 Detected ${triggeredOrders.length} triggered SL/TP orders`);

      // 4️⃣ Match exchange positions with database positions
      // Clear and rebuild positions table
      await dbClient.execute("DELETE FROM positions");

      let syncedCount = 0;
      for (const exchangePos of exchangePositions) {
        const symbol = exchangePos.symbol;
        const dbPos = validPositions.get(symbol);

        if (dbPos) {
          // ✅ Position exists in both DB and exchange - update with exchange data + keep our tracking IDs
          logger.info(`  ♻️  Syncing existing position: ${symbol}`);

          await dbClient.execute({
            sql: `INSERT INTO positions
                  (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
                   leverage, side, entry_order_id, opened_at, tp_orders, sl_orders, sl_order_id, tp_order_id,
                   sl_percentage, tp_percentage, stop_loss, profit_target, confidence, risk_usd, peak_pnl_percent)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              symbol,
              exchangePos.quantity,  // 🔥 Use exchange quantity (source of truth)
              dbPos.entry_price || exchangePos.entryPrice,  // Prefer DB entry price (more accurate)
              exchangePos.currentPrice,
              exchangePos.liquidationPrice,
              exchangePos.unrealizedPnl,
              exchangePos.leverage,
              exchangePos.side,
              dbPos.entry_order_id,  // 🔥 Keep our entry order ID
              dbPos.opened_at,
              dbPos.tp_orders,  // 🔥 Keep verified TP orders
              dbPos.sl_orders,  // 🔥 Keep verified SL orders array
              dbPos.sl_order_id,  // 🔥 Keep verified SL order ID (old format)
              dbPos.tp_order_id,
              dbPos.sl_percentage,
              dbPos.tp_percentage,
              dbPos.stop_loss,  // 🔥 Keep our SL price
              dbPos.profit_target,  // 🔥 Keep our TP price
              dbPos.confidence,
              dbPos.risk_usd,
              dbPos.peak_pnl_percent || 0,
            ],
          });
          syncedCount++;
        } else {
          // ⚠️ Position exists on exchange but NOT in our database
          // This happens when position was opened outside our system or after database reset
          logger.warn(`  ⚠️  Found untracked position on exchange: ${symbol} ${exchangePos.side} ${exchangePos.quantity}`);

          await dbClient.execute({
            sql: `INSERT INTO positions
                  (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
                   leverage, side, entry_order_id, opened_at, peak_pnl_percent)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              symbol,
              exchangePos.quantity,
              exchangePos.entryPrice,
              exchangePos.currentPrice,
              exchangePos.liquidationPrice,
              exchangePos.unrealizedPnl,
              exchangePos.leverage,
              exchangePos.side,
              "external",  // Mark as externally created
              new Date().toISOString(),
              0,
            ],
          });
          syncedCount++;
        }
      }

      // 5️⃣ Check for positions in DB that are NOT on exchange anymore
      const exchangeSymbols = new Set(exchangePositions.map(p => p.symbol));
      for (const [symbol, dbPos] of validPositions.entries()) {
        if (!exchangeSymbols.has(symbol)) {
          logger.warn(`⚠️  Position ${symbol} exists in DB but NOT on exchange - was likely closed externally`);

          // Try to get current price and record retrospective close
          try {
            const ticker = await client.getFuturesTicker(symbol);
            const exitPrice = ticker.markPrice;
            const entryPrice = dbPos.entry_price || exitPrice;
            const quantity = dbPos.quantity || 0;
            const side = dbPos.side || 'long';
            const leverage = dbPos.leverage || 1;

            // Calculate estimated PnL using centralized calculator
            const pnlResult = await calculatePnL({
              symbol,
              side,
              entryPrice,
              exitPrice,
              quantity,
              leverage,
            }, undefined, false); // Use maker fee for unknown close reason
            const pnl = pnlResult.netPnl;
            const totalFee = pnlResult.totalFees;

            // Record close trade with entry_order_id link
            await dbClient.execute({
              sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
                    VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
              args: [
                'sync_cleanup',
                symbol,
                side,
                exitPrice,
                quantity,
                leverage,
                pnl,
                totalFee,
                new Date().toISOString(),
                'unknown', // Position was closed but we don't know how (SL/TP/manual)
                dbPos.entry_order_id || null  // 🔥 Link to entry order
              ]
            });

            logger.info(`  ✅ Recorded retrospective close: entry=${entryPrice}, exit=${exitPrice}, PnL=${pnl.toFixed(2)} USDT`);
          } catch (error: any) {
            logger.error(`  Failed to record retrospective close for ${symbol}: ${error.message}`);
          }
        }
      }

      logger.info(`\n✅ Position sync complete:`);
      logger.info(`   - Synced positions: ${syncedCount}`);
      logger.info(`   - Triggered SL/TP: ${triggeredOrders.length}`);

      return {
        success: true,
        syncedCount,
        triggeredCount: triggeredOrders.length,
        triggeredOrders,
        message: `✅ position sync complete: ${syncedCount} positions, ${triggeredOrders.length} triggered stop-loss/take-profit`,
      };
    } catch (error: any) {
      logger.error(`❌ Sync failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `syncposition failed: ${error.message}`,
      };
    }
  },
});

/**
 * Helper function to record SL/TP trigger close trade
 */
async function recordSlTpTrigger(
  client: any,
  dbPos: any,
  triggeredOrder: any,
  triggerType: 'SL' | 'TP'
) {
  try {
    const symbol = dbPos.symbol;
    const side = dbPos.side;
    const leverage = dbPos.leverage || 1;
    const entryPrice = dbPos.entry_price;
    const exitPrice = triggeredOrder.price || triggeredOrder.filled; // Actual fill price
    const quantity = triggeredOrder.filled; // Actual filled quantity

    // Calculate PnL using centralized calculator
    const pnlResult = await calculatePnL({
      symbol,
      side,
      entryPrice,
      exitPrice,
      quantity,
      leverage,
    }, undefined, true); // Use taker fee for SL/TP
    const pnl = pnlResult.netPnl;
    const totalFee = pnlResult.totalFees;

    // Record close trade with entry_order_id link
    await dbClient.execute({
      sql: `INSERT INTO trades (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status, close_reason, entry_order_id)
            VALUES (?, ?, ?, 'close', ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
      args: [
        triggeredOrder.id || 'unknown',
        symbol,
        side,
        exitPrice,
        quantity,
        leverage,
        pnl,
        totalFee,
        new Date().toISOString(),
        triggerType === 'SL' ? 'stop_loss' : 'take_profit',
        dbPos.entry_order_id || null  // 🔥 Link to entry order
      ]
    });

    logger.info(`  ✅ Recorded ${triggerType} trigger close: entry=${entryPrice}, exit=${exitPrice}, qty=${quantity}, PnL=${pnl.toFixed(2)} USDT`);
  } catch (error: any) {
    logger.error(`  Failed to record ${triggerType} trigger: ${error.message}`);
  }
}

/**
 * Calculate Stop-Loss and Take-Profit Prices Tool
 * Calculates optimal SL/TP prices based on environment configuration settings.
 * Uses PnL percentages from .env (POSITION_STOP_LOSS_PNL_PERCENT, POSITION_TP1/2/3_PNL_PERCENT)
 */
export const calculateSlTpPricesTool = createTool({
  name: "calculateSlTpPrices",
  description: "Calculate stop-loss and take-profit prices for positions. IMPORTANT: Use this tool to get SL/TP prices - NEVER calculate manually! Supports: 1) Initial SL/TP (uses env config), 2) Trailing stops (provide targetStopLossPnl%). The tool calculates prices based on: entry price, position side (long/short), leverage, and PnL percentages. ALWAYS use entry_price for trailing stops to ensure stop is on correct side.",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("Symbol/coin code"),
    side: z.enum(["long", "short"]).describe("Position side: long or short"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe("Position leverage"),
    entryPrice: z.number().optional().describe("Entry price (optional, will use current price if not provided)"),
    targetStopLossPnl: z.number().optional().describe("Target stop-loss PnL % for trailing stops (e.g., 3, 8, 15). If not provided, uses env default (20%). For trailing stops: use 3% to lock +3% profit, 8% to lock +8%, etc."),
  }),
  execute: async ({ symbol, side, leverage, entryPrice, targetStopLossPnl }) => {
    const client = createExchangeClient();

    try {
      // Get current price if entry price not provided
      let price = entryPrice;
      if (!price) {
        const ticker = await client.getFuturesTicker(symbol);
        price = ticker.lastPrice;
      }

      // Get PnL percentages from environment or use custom values for trailing stops
      const slPnlPercent = targetStopLossPnl ?? parseFloat(process.env.POSITION_STOP_LOSS_PNL_PERCENT || "20");
      const tp1PnlPercent = parseFloat(process.env.POSITION_TP1_PNL_PERCENT || "15");
      const tp2PnlPercent = parseFloat(process.env.POSITION_TP2_PNL_PERCENT || "25");
      const tp3PnlPercent = parseFloat(process.env.POSITION_TP3_PNL_PERCENT || "40");

      // Convert PnL % to price change % (PnL already includes leverage effect)
      // Formula: price_change_% = PnL_% / leverage
      const slPriceChangePercent = slPnlPercent / leverage;
      const tp1PriceChangePercent = tp1PnlPercent / leverage;
      const tp2PriceChangePercent = tp2PnlPercent / leverage;
      const tp3PriceChangePercent = tp3PnlPercent / leverage;

      let stopLossPrice: number;
      let tp1Price: number;
      let tp2Price: number;
      let tp3Price: number;

      if (side === 'long') {
        // Long position:
        // SL: price goes down → negative PnL → stop price < entry
        // TP: price goes up → positive PnL → TP price > entry
        stopLossPrice = price * (1 - slPriceChangePercent / 100);
        tp1Price = price * (1 + tp1PriceChangePercent / 100);
        tp2Price = price * (1 + tp2PriceChangePercent / 100);
        tp3Price = price * (1 + tp3PriceChangePercent / 100);
      } else {
        // Short position:
        // SL: price goes up → negative PnL → stop price > entry
        // TP: price goes down → positive PnL → TP price < entry
        stopLossPrice = price * (1 + slPriceChangePercent / 100);
        tp1Price = price * (1 - tp1PriceChangePercent / 100);
        tp2Price = price * (1 - tp2PriceChangePercent / 100);
        tp3Price = price * (1 - tp3PriceChangePercent / 100);
      }

      return {
        success: true,
        symbol,
        side,
        leverage,
        entryPrice: price,
        stopLoss: {
          price: stopLossPrice,
          pnlPercent: -slPnlPercent,
          priceChangePercent: side === 'long' ? -slPriceChangePercent : slPriceChangePercent,
          percentage: 100,
        },
        takeProfits: [
          {
            level: 1,
            price: tp1Price,
            pnlPercent: tp1PnlPercent,
            priceChangePercent: side === 'long' ? tp1PriceChangePercent : -tp1PriceChangePercent,
            percentage: 30,
          },
          {
            level: 2,
            price: tp2Price,
            pnlPercent: tp2PnlPercent,
            priceChangePercent: side === 'long' ? tp2PriceChangePercent : -tp2PriceChangePercent,
            percentage: 40,
          },
          {
            level: 3,
            price: tp3Price,
            pnlPercent: tp3PnlPercent,
            priceChangePercent: side === 'long' ? tp3PriceChangePercent : -tp3PriceChangePercent,
            percentage: 30,
          },
        ],
        message: `📊 SL/TP Calculation for ${symbol} ${side.toUpperCase()} @ ${formatPrice(price)} (${leverage}x):\n` +
          `🛑 Stop-Loss: ${formatPrice(stopLossPrice)} (-${slPnlPercent}% PnL, ${side === 'long' ? '-' : '+'}${slPriceChangePercent.toFixed(2)}% price)\n` +
          `🎯 TP1 (30%): ${formatPrice(tp1Price)} (+${tp1PnlPercent}% PnL, ${side === 'long' ? '+' : '-'}${tp1PriceChangePercent.toFixed(2)}% price)\n` +
          `🎯 TP2 (40%): ${formatPrice(tp2Price)} (+${tp2PnlPercent}% PnL, ${side === 'long' ? '+' : '-'}${tp2PriceChangePercent.toFixed(2)}% price)\n` +
          `🎯 TP3 (30%): ${formatPrice(tp3Price)} (+${tp3PnlPercent}% PnL, ${side === 'long' ? '+' : '-'}${tp3PriceChangePercent.toFixed(2)}% price)`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Failed to calculate SL/TP prices: ${error.message}`,
      };
    }
  },
});

/**
 * Get market fundamentals (market cap, volume, rank) from Binance
 * IMPORTANT: This uses an unofficial Binance API and may be rate-limited or change
 */
export const getMarketFundamentalsTool = createTool({
  name: "getMarketFundamentals",
  description: "Get market fundamentals for trading symbols including market cap, 24h volume, market rank, circulating supply, and daily change. Use this to assess coin size, liquidity, and relative risk. Larger market cap = more stable, higher volume = better liquidity. Call this once at start of each trading cycle to understand the fundamental landscape.",
  parameters: z.object({
    symbols: z.array(z.enum(RISK_PARAMS.TRADING_SYMBOLS)).optional().describe("Symbols to get data for (optional, defaults to all trading symbols)"),
  }),
  execute: async ({ symbols }) => {
    try {
      const symbolsToFetch = symbols || RISK_PARAMS.TRADING_SYMBOLS;

      // Fetch data from Binance unofficial API
      const response = await fetch("https://www.binance.com/bapi/apex/v1/friendly/apex/marketing/complianceSymbolList", {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success || !data.data) {
        throw new Error("Invalid response from Binance API");
      }

      // Filter to only our trading symbols
      const allCoins = data.data;
      const results: any[] = [];

      for (const symbol of symbolsToFetch) {
        // Binance uses BTCUSDT format
        const binanceSymbol = `${symbol}USDT`;
        const coinData = allCoins.find((c: any) => c.symbol === binanceSymbol);

        if (coinData) {
          results.push({
            symbol,
            name: coinData.name,
            fullName: coinData.fullName,
            price: coinData.price,
            marketCap: coinData.marketCap,
            marketCapFormatted: formatMarketCap(coinData.marketCap),
            volume24h: coinData.volume,
            volume24hFormatted: formatMarketCap(coinData.volume),
            rank: coinData.rank,
            dayChange: coinData.dayChange,
            circulatingSupply: coinData.circulatingSupply,
            maxSupply: coinData.maxSupply,
            marketCapDominance: coinData.marketCapDominance,
            tags: coinData.tags || [],
          });
        }
      }

      // Sort by rank
      results.sort((a, b) => a.rank - b.rank);

      // Calculate total market cap and dominance
      const totalMarketCap = results.reduce((sum, coin) => sum + (coin.marketCap || 0), 0);

      // Add relative metrics
      for (const coin of results) {
        coin.dominancePercent = totalMarketCap > 0
          ? ((coin.marketCap / totalMarketCap) * 100).toFixed(2)
          : "0.00";
      }

      // Format summary message
      let summary = "📊 Market Fundamentals Summary:\n\n";
      for (const coin of results) {
        const supplyInfo = coin.maxSupply
          ? `${(coin.circulatingSupply / coin.maxSupply * 100).toFixed(1)}% of max`
          : "No max supply";

        summary += `${coin.symbol} (${coin.fullName}) - Rank #${coin.rank}\n`;
        summary += `  💰 Market Cap: $${coin.marketCapFormatted} (${coin.dominancePercent}% of portfolio)\n`;
        summary += `  📊 24h Volume: $${coin.volume24hFormatted}\n`;
        summary += `  📈 24h Change: ${coin.dayChange >= 0 ? '+' : ''}${coin.dayChange.toFixed(2)}%\n`;
        summary += `  💎 Supply: ${formatNumber(coin.circulatingSupply)} (${supplyInfo})\n`;
        if (coin.tags.length > 0) {
          summary += `  🏷️ Tags: ${coin.tags.join(", ")}\n`;
        }
        summary += '\n';
      }

      // Add analysis insights
      summary += "💡 Analysis Insights:\n";
      const largeCapCoins = results.filter(c => c.marketCap > 100_000_000_000); // > $100B
      const midCapCoins = results.filter(c => c.marketCap >= 10_000_000_000 && c.marketCap <= 100_000_000_000); // $10B-$100B
      const smallCapCoins = results.filter(c => c.marketCap < 10_000_000_000); // < $10B

      summary += `  - Large Cap (>$100B): ${largeCapCoins.map(c => c.symbol).join(", ") || "None"} → Lower risk, lower volatility\n`;
      summary += `  - Mid Cap ($10B-$100B): ${midCapCoins.map(c => c.symbol).join(", ") || "None"} → Balanced risk/reward\n`;
      summary += `  - Small Cap (<$10B): ${smallCapCoins.map(c => c.symbol).join(", ") || "None"} → Higher risk, higher potential returns\n`;

      // Volume analysis
      const avgVolume = results.reduce((sum, c) => sum + c.volume24h, 0) / results.length;
      const highVolumeCoins = results.filter(c => c.volume24h > avgVolume * 1.5);
      if (highVolumeCoins.length > 0) {
        summary += `  - High liquidity: ${highVolumeCoins.map(c => c.symbol).join(", ")} → Easier to enter/exit positions\n`;
      }

      return {
        success: true,
        data: results,
        summary,
        totalMarketCap,
        averageVolume: avgVolume,
        message: summary,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Failed to fetch market fundamentals: ${error.message}. This uses an unofficial API and may be temporarily unavailable.`,
      };
    }
  },
});

/**
 * Format large numbers (market cap, volume) to human-readable format
 */
function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  return value.toFixed(2);
}

/**
 * Format numbers with commas
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

