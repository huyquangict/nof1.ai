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
 * 账户管理工具
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createExchangeClient } from "../../services/exchange";
import { createClient } from "@libsql/client";
import { RISK_PARAMS } from "../../config/riskParams";
import { getQuantoMultiplier } from "../../utils/contractUtils";

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
 * 获取账户余额工具
 */
export const getAccountBalanceTool = createTool({
  name: "getAccountBalance",
  description: "获取账户余额和资金信息",
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
        message: `获取账户余额失败: ${error.message}`,
      };
    }
  },
});

/**
 * 获取当前持仓工具
 */
export const getPositionsTool = createTool({
  name: "getPositions",
  description: "获取当前所有持仓信息",
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
        count: formattedPositions.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `获取持仓失败: ${error.message}`,
      };
    }
  },
});

/**
 * 获取未成交订单工具
 */
export const getOpenOrdersTool = createTool({
  name: "getOpenOrders",
  description: "获取所有未成交的挂单",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).optional().describe("可选：仅获取指定币种的订单"),
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
        count: formattedOrders.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `获取未成交订单失败: ${error.message}`,
      };
    }
  },
});

/**
 * 检查订单状态工具
 */
export const checkOrderStatusTool = createTool({
  name: "checkOrderStatus",
  description: "检查指定订单的详细状态，包括成交价格、成交数量等",
  parameters: z.object({
    orderId: z.string().describe("订单ID"),
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
        message: `订单 ${orderId} 状态: ${orderDetail.status}, 已成交 ${filledSize}/${totalSize} 张 (${totalSize > 0 ? (filledSize / totalSize * 100).toFixed(1) : '0'}%), 成交价 ${formatPrice(fillPrice)}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `获取订单状态失败: ${error.message}`,
      };
    }
  },
});

/**
 * 计算风险敞口工具
 */
export const calculateRiskTool = createTool({
  name: "calculateRisk",
  description: "计算当前账户的风险敞口和仓位情况",
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
      
      // 计算每个持仓的风险（需要异步获取合约乘数）
      const positionRisks = await Promise.all(
        positions.map(async (p) => {
          const size = p.quantity;
          const entryPrice = p.entryPrice;
          const leverage = p.leverage;
          const liquidationPrice = p.liquidationPrice;
          const currentPrice = p.currentPrice;
          const pnl = p.unrealizedPnl;

          // 获取合约乘数（修复：正确计算名义价值）
          const quantoMultiplier = await getQuantoMultiplier(p.exchangeSymbol);

          // 正确计算名义价值：张数 × 入场价格 × 合约乘数
          const notionalValue = size * entryPrice * quantoMultiplier;
          const margin = notionalValue / leverage;

          // 计算风险百分比（到强平的距离）
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
      
      // 从数据库获取初始资金
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
        message: `计算风险失败: ${error.message}`,
      };
    }
  },
});

/**
 * 同步持仓到数据库工具
 */
export const syncPositionsTool = createTool({
  name: "syncPositions",
  description: "同步交易所持仓数据到本地数据库",
  parameters: z.object({}),
  execute: async () => {
    const client = createExchangeClient();

    try {
      const positions = await client.getPositions();

      // 清空本地持仓表
      await dbClient.execute("DELETE FROM positions");

      // 插入当前持仓
      for (const p of positions) {
        await dbClient.execute({
          sql: `INSERT INTO positions
                (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
                 leverage, side, entry_order_id, opened_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            p.symbol,
            p.quantity,
            p.entryPrice,
            p.currentPrice,
            p.liquidationPrice,
            p.unrealizedPnl,
            p.leverage,
            p.side,
            "synced",
            new Date().toISOString(),
          ],
        });
      }

      return {
        success: true,
        syncedCount: positions.length,
        message: "持仓同步完成",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `同步持仓失败: ${error.message}`,
      };
    }
  },
});

