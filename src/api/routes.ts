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
 * API Routes
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { createExchangeClient } from "../services/exchange";
import { createPinoLogger } from "@voltagent/logger";
import { jwtAuth, generateToken } from "../middleware/auth";

const logger = createPinoLogger({
  name: "api-routes",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

// Admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";

export function createApiRoutes() {
  const app = new Hono();

  // Disable caching for static files in development
  app.use("/*", async (c, next) => {
    await next();
    // Set cache-control headers to prevent caching
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
  });

  // Static file service - requires absolute paths
  app.use("/*", serveStatic({ root: "./public" }));

  /**
   * Login endpoint - Generate JWT token
   */
  app.post("/api/auth/login", async (c) => {
    try {
      const body = await c.req.json();
      const { username, password } = body;

      // Validate credentials
      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = generateToken(username);

        return c.json({
          success: true,
          token,
          expiresIn: process.env.JWT_EXPIRES_IN || "7d",
          message: "Login successful",
        });
      }

      return c.json({ error: "Invalid credentials" }, 401);
    } catch (error: any) {
      return c.json({ error: "Invalid request" }, 400);
    }
  });

  /**
   * Verify token endpoint
   */
  app.get("/api/auth/verify", jwtAuth, async (c) => {
    const userId = (c as any).get("userId") as string;
    return c.json({
      valid: true,
      userId,
      message: "Token is valid",
    });
  });

  // Apply JWT authentication to all API routes (except auth endpoints)
  // DISABLED FOR LOCAL USE: Re-enable if deploying to production
  // app.use("/api/*", async (c, next) => {
  //   // Skip auth for login and verify endpoints
  //   if (c.req.path.startsWith("/api/auth/")) {
  //     return next();
  //   }
  //   return jwtAuth(c, next);
  // });

  /**
   * Get account overview
   *
   * Exchange account structure:
   * - account.total = available + positionMargin
   * - account.total does not includeunrealized PnL
   * - actual total balance = account.total + unrealisedPnl
   * 
   * API return description:
   * - totalBalance: does not includeunrealized PnL total balance(used to calculate realized profit)
   * - unrealisedPnl: currently holding unrealized PnL
   * 
   * Frontend display:
   * - total balance display = totalBalance + unrealisedPnl(real-time reflect position PnL)
   */
  app.get("/api/account", async (c) => {
    try {
      const exchangeClient = createExchangeClient();
      const account = await exchangeClient.getFuturesAccount();
      
      // fetch initial capital from database
      const initialResult = await dbClient.execute(
        "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
      );
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : 100;
      
      // Adapter already includes unrealized PnL in totalBalance
      const totalBalance = account.totalBalance;
      const unrealisedPnl = account.unrealisedPnl;

      // return rate = (total balance - initial capital) / initial capital * 100
      const returnPercent = ((totalBalance - initialBalance) / initialBalance) * 100;
      
      return c.json({
        totalBalance,
        availableBalance: account.availableBalance,
        positionMargin: account.positionMargin,
        unrealisedPnl,
        returnPercent,
        initialBalance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get current holdings - fetch real-time data from exchange
   */
  app.get("/api/positions", async (c) => {
    try {
      const exchangeClient = createExchangeClient();
      const exchangePositions = await exchangeClient.getPositions();

      // fetch from databasestop-loss take-profit information and order ID
      const dbResult = await dbClient.execute("SELECT symbol, stop_loss, profit_target, tp_orders, sl_orders, entry_order_id, sl_order_id FROM positions");
      const dbPositionsMap = new Map(
        dbResult.rows.map((row: any) => [row.symbol, row])
      );

      // Format positions (positions are already filtered by adapter)
      const positions = exchangePositions.map((p) => {
          const dbPos = dbPositionsMap.get(p.symbol);

          // Parse tp_orders JSON if available
          let tpOrders = null;
          if (dbPos?.tp_orders) {
            try {
              tpOrders = JSON.parse(dbPos.tp_orders as string);
            } catch (e) {
              // Failed to parse, ignore
            }
          }

          // Parse sl_orders JSON if available
          let slOrders = null;
          if (dbPos?.sl_orders) {
            try {
              slOrders = JSON.parse(dbPos.sl_orders as string);
            } catch (e) {
              // Failed to parse, ignore
            }
          }

          return {
            symbol: p.symbol,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            liquidationPrice: p.liquidationPrice,
            unrealizedPnl: p.unrealizedPnl,
            leverage: p.leverage,
            side: p.side,
            openValue: p.margin,
            profitTarget: dbPos?.profit_target ? Number(dbPos.profit_target) : null,
            stopLoss: dbPos?.stop_loss ? Number(dbPos.stop_loss) : null,
            tpOrders: tpOrders,
            slOrders: slOrders, // 🔥 Multiple SL orders array
            openedAt: new Date(p.timestamp).toISOString(),
            // 🔥 ID-based tracking fields
            entryOrderId: dbPos?.entry_order_id || null,
            slOrderId: dbPos?.sl_order_id || null, // Deprecated: use slOrders instead
          };
        });
      
      return c.json({ positions });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Manual close position
   */
  app.post("/api/positions/:symbol/close", async (c) => {
    try {
      const symbol = c.req.param("symbol");
      const body = await c.req.json();
      const percentage = body.percentage || 100;

      logger.info(`Manual close request: ${symbol}, ${percentage}%`);

      // Import closePosition tool
      const { closePositionTool } = await import("../tools/trading/tradeExecution");

      // Execute close
      const result = await closePositionTool.execute?.({ symbol, percentage });

      if (result && (result as any).success) {
        return c.json({
          success: true,
          message: (result as any).message,
          data: result
        });
      } else {
        return c.json({
          success: false,
          error: (result as any).message || "Failed to close position"
        }, 400);
      }
    } catch (error: any) {
      logger.error(`Manual close failed: ${error.message}`, error);
      return c.json({
        success: false,
        error: error.message
      }, 500);
    }
  });

  /**
   * Get account value history (for charting)
   */
  app.get("/api/history", async (c) => {
    try {
      const limitParam = c.req.query("limit");
      const hoursParam = c.req.query("hours") || "8"; // Default: show last 8 hours

      let result;
      if (limitParam) {
        // If passed limit parameter, use LIMIT clause
        const limit = Number.parseInt(limitParam);
        result = await dbClient.execute({
          sql: `SELECT timestamp, total_value, unrealized_pnl, return_percent
                FROM account_history
                ORDER BY timestamp DESC
                LIMIT ?`,
          args: [limit],
        });
      } else {
        // default return recent N hours data (avoid x-axis overflow)
        // assume recording every 10 minutes, 8 hours = 48records, fetch 60 to ensure coverage
        const hours = Number.parseInt(hoursParam);
        const estimatedRecords = Math.ceil(hours * 6); // 6 records per hour (10-minute interval)

        result = await dbClient.execute({
          sql: `SELECT timestamp, total_value, unrealized_pnl, return_percent
                FROM account_history
                ORDER BY timestamp DESC
                LIMIT ?`,
          args: [estimatedRecords],
        });
      }

      const history = result.rows.map((row: any) => ({
        timestamp: new Date(row.timestamp as string).getTime(), // Convert ISO string to milliseconds
        totalValue: Number.parseFloat(row.total_value as string) || 0,
        unrealizedPnl: Number.parseFloat(row.unrealized_pnl as string) || 0,
        returnPercent: Number.parseFloat(row.return_percent as string) || 0,
      })).reverse(); // reverse, make time from old to new

      return c.json({ history });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get trade records - fetch historical position size from database (closed positions records)
   */
  app.get("/api/trades", async (c) => {
    try {
      const limit = Number.parseInt(c.req.query("limit") || "10");
      const symbol = c.req.query("symbol"); // optional, filter specific symbol
      
      // fetch historical trade records from database
      let sql = `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`;
      let args: any[] = [limit];
      
      if (symbol) {
        sql = `SELECT * FROM trades WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`;
        args = [symbol, limit];
      }
      
      const result = await dbClient.execute({
        sql,
        args,
      });
      
      if (!result.rows || result.rows.length === 0) {
        return c.json({ trades: [] });
      }
      
      // convert database format to frontend needs format
      const trades = result.rows.map((row: any) => {
        return {
          id: row.id,
          orderId: row.order_id,
          entryOrderId: row.entry_order_id || null, // 🔥 Link to entry order (for close trades)
          symbol: row.symbol,
          side: row.side, // long/short
          type: row.type, // open/close
          price: Number.parseFloat(row.price || "0"),
          quantity: Number.parseFloat(row.quantity || "0"),
          leverage: Number.parseInt(row.leverage || "1"),
          pnl: row.pnl ? Number.parseFloat(row.pnl) : null,
          fee: Number.parseFloat(row.fee || "0"),
          timestamp: row.timestamp,
          status: row.status,
          closeReason: row.close_reason, // How position was closed (manual, stop_loss, take_profit, take_profit_partial, time_limit, drawdown)
        };
      });
      
      return c.json({ trades });
    } catch (error: any) {
      logger.error("Failed to fetch historical trades:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get Agent decision logs
   */
  app.get("/api/logs", async (c) => {
    try {
      const limit = c.req.query("limit") || "20";
      
      const result = await dbClient.execute({
        sql: `SELECT * FROM agent_decisions 
              ORDER BY timestamp DESC 
              LIMIT ?`,
        args: [Number.parseInt(limit)],
      });
      
      const logs = result.rows.map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        iteration: row.iteration,
        decision: row.decision,
        actionsTaken: row.actions_taken,
        accountValue: row.account_value,
        positionsCount: row.positions_quantity,
      }));
      
      return c.json({ logs });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get trading statistics
   */
  app.get("/api/stats", async (c) => {
    try {
      // Count total trades - use pnl IS NOT NULL to ensure these are completed close position trades
      const totalTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as quantity FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalTrades = (totalTradesResult.rows[0] as any).quantity;
      
      // quantity profitable trades
      const winTradesResult = await dbClient.execute(
        "SELECT COUNT(*) as quantity FROM trades WHERE type = 'close' AND pnl IS NOT NULL AND pnl > 0"
      );
      const winTrades = (winTradesResult.rows[0] as any).quantity;
      
      // calculate win rate
      const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
      
      // calculate total PnL
      const pnlResult = await dbClient.execute(
        "SELECT SUM(pnl) as total_pnl FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const totalPnl = (pnlResult.rows[0] as any).total_pnl || 0;
      
      // get maximum single profit and loss
      const maxWinResult = await dbClient.execute(
        "SELECT MAX(pnl) as max_win FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxWin = (maxWinResult.rows[0] as any).max_win || 0;
      
      const maxLossResult = await dbClient.execute(
        "SELECT MIN(pnl) as max_loss FROM trades WHERE type = 'close' AND pnl IS NOT NULL"
      );
      const maxLoss = (maxLossResult.rows[0] as any).max_loss || 0;
      
      return c.json({
        totalTrades,
        winTrades,
        lossTrades: totalTrades - winTrades,
        winRate,
        totalPnl,
        maxWin,
        maxLoss,
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * get multiple symbols real-time prices
   */
  app.get("/api/prices", async (c) => {
    try {
      const symbolsParam = c.req.query("symbols") || "BTC,ETH,SOL,BNB,DOGE,XRP";
      const symbols = symbolsParam.split(",").map(s => s.trim());

      const exchangeClient = createExchangeClient();
      const prices: Record<string, number> = {};

      // concurrently fetch all symbol prices
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const ticker = await exchangeClient.getFuturesTicker(symbol);
            prices[symbol] = ticker.lastPrice;
          } catch (error: any) {
            logger.error(`get/fetch ${symbol} price failed:`, error);
            prices[symbol] = 0;
          }
        })
      );
      
      return c.json({ prices });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  return app;
}

