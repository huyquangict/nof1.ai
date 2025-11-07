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
   * Get trading pause state
   */
  app.get("/api/trading/pause", async (c) => {
    try {
      const result = await dbClient.execute({
        sql: "SELECT value FROM system_config WHERE key = 'trading_paused'",
        args: [],
      });

      const isPaused = result.rows.length > 0 && result.rows[0].value === '1';

      return c.json({
        paused: isPaused,
        message: isPaused ? "Trading is paused - LLM will not open new positions" : "Trading is active"
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Toggle trading pause state
   */
  app.post("/api/trading/pause", async (c) => {
    try {
      const body = await c.req.json();
      const { paused } = body;

      if (typeof paused !== 'boolean') {
        return c.json({ error: "Invalid paused value, must be boolean" }, 400);
      }

      // Update or insert pause state in database
      await dbClient.execute({
        sql: `INSERT INTO system_config (key, value, updated_at)
              VALUES ('trading_paused', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = datetime('now')`,
        args: [paused ? '1' : '0'],
      });

      logger.info(`🔄 Trading ${paused ? 'PAUSED' : 'RESUMED'} by user`);

      return c.json({
        success: true,
        paused,
        message: paused
          ? "Trading paused - LLM will not open new positions. Existing positions and risk management remain active."
          : "Trading resumed - LLM can now open new positions"
      });
    } catch (error: any) {
      logger.error("Failed to update pause state:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get reverse trade state
   */
  app.get("/api/trading/reverse", async (c) => {
    try {
      const result = await dbClient.execute({
        sql: "SELECT value FROM system_config WHERE key = 'reverse_positions'",
        args: [],
      });

      const isReversed = result.rows.length > 0 && result.rows[0].value === '1';

      return c.json({
        reversed: isReversed,
        message: isReversed
          ? "Reverse mode ON - LLM LONG → System SHORT, LLM SHORT → System LONG"
          : "Normal mode - LLM decisions executed as-is"
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Toggle reverse trade state
   */
  app.post("/api/trading/reverse", async (c) => {
    try {
      const body = await c.req.json();
      const { reversed } = body;

      if (typeof reversed !== 'boolean') {
        return c.json({ error: "Invalid reversed value, must be boolean" }, 400);
      }

      // Update or insert reverse state in database
      await dbClient.execute({
        sql: `INSERT INTO system_config (key, value, updated_at)
              VALUES ('reverse_positions', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = datetime('now')`,
        args: [reversed ? '1' : '0'],
      });

      logger.info(`🔄 Reverse mode ${reversed ? 'ENABLED' : 'DISABLED'} by user`);

      return c.json({
        success: true,
        reversed,
        message: reversed
          ? "Reverse mode ENABLED - LLM LONG → System SHORT, LLM SHORT → System LONG (Contrarian trading)"
          : "Reverse mode DISABLED - LLM decisions will be executed as-is (Normal trading)"
      });
    } catch (error: any) {
      logger.error("Failed to update reverse state:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get custom LLM instructions
   */
  app.get("/api/trading/custom-instructions", async (c) => {
    try {
      const result = await dbClient.execute({
        sql: "SELECT value FROM system_config WHERE key = 'custom_instructions'",
        args: [],
      });

      const instructions = result.rows.length > 0 ? (result.rows[0].value as string) : '';

      return c.json({
        instructions,
        message: instructions
          ? "Custom instructions loaded"
          : "No custom instructions set"
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Save custom LLM instructions
   */
  app.post("/api/trading/custom-instructions", async (c) => {
    try {
      const body = await c.req.json();
      const { instructions } = body;

      if (typeof instructions !== 'string') {
        return c.json({ error: "Invalid instructions value, must be string" }, 400);
      }

      // Update or insert custom instructions in database
      await dbClient.execute({
        sql: `INSERT INTO system_config (key, value, updated_at)
              VALUES ('custom_instructions', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = datetime('now')`,
        args: [instructions],
      });

      logger.info(`💬 Custom LLM instructions updated (${instructions.length} characters)`);

      return c.json({
        success: true,
        instructions,
        message: instructions
          ? "Custom instructions saved - will be included in next AI decision"
          : "Custom instructions cleared"
      });
    } catch (error: any) {
      logger.error("Failed to update custom instructions:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get AI learning system status and statistics
   */
  app.get("/api/learning/status", async (c) => {
    try {
      // Get learning enabled state
      const learningEnabledResult = await dbClient.execute({
        sql: "SELECT value FROM system_config WHERE key = 'learning_enabled'",
        args: [],
      });
      const learningEnabled = learningEnabledResult.rows.length > 0 && learningEnabledResult.rows[0].value === '1';

      // Get total reflections
      const reflectionsResult = await dbClient.execute("SELECT COUNT(*) as count FROM trading_reflections");
      const totalReflections = (reflectionsResult.rows[0] as any).count;

      // Get active lessons
      const lessonsResult = await dbClient.execute("SELECT COUNT(*) as count FROM learned_lessons WHERE is_active = 1");
      const activeLessons = (lessonsResult.rows[0] as any).count;

      // Get pending reviews (reflections without feedback)
      const pendingResult = await dbClient.execute("SELECT COUNT(*) as count FROM trading_reflections WHERE feedback_score IS NULL");
      const pendingReviews = (pendingResult.rows[0] as any).count;

      // Calculate average lesson effectiveness
      const effectivenessResult = await dbClient.execute({
        sql: "SELECT AVG(effectiveness_rate) as avg_effectiveness FROM learned_lessons WHERE is_active = 1 AND effectiveness_rate IS NOT NULL",
        args: [],
      });
      const avgEffectiveness = effectivenessResult.rows[0] ? ((effectivenessResult.rows[0] as any).avg_effectiveness || 0) : 0;

      return c.json({
        learningEnabled,
        totalReflections,
        activeLessons,
        pendingReviews,
        avgEffectiveness: parseFloat((avgEffectiveness * 100).toFixed(1)),
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Toggle AI learning system
   */
  app.post("/api/learning/toggle", async (c) => {
    try {
      const body = await c.req.json();
      const { enabled } = body;

      if (typeof enabled !== 'boolean') {
        return c.json({ error: "Invalid enabled value, must be boolean" }, 400);
      }

      await dbClient.execute({
        sql: `INSERT INTO system_config (key, value, updated_at)
              VALUES ('learning_enabled', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = datetime('now')`,
        args: [enabled ? '1' : '0'],
      });

      logger.info(`🧠 AI Learning ${enabled ? 'ENABLED' : 'DISABLED'} by user`);

      return c.json({
        success: true,
        enabled,
        message: enabled
          ? "AI Learning ENABLED - System will record predictions, calculate feedback, and generate lessons"
          : "AI Learning DISABLED - No new reflections or lessons will be created"
      });
    } catch (error: any) {
      logger.error("Failed to toggle learning:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Update learning configuration
   */
  app.post("/api/learning/config", async (c) => {
    try {
      const body = await c.req.json();
      const { lessonCount, minSuccessRate, lessonAgeDays } = body;

      if (lessonCount !== undefined) {
        await dbClient.execute({
          sql: `INSERT INTO system_config (key, value, updated_at)
                VALUES ('lesson_count', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          args: [lessonCount.toString()],
        });
      }

      if (minSuccessRate !== undefined) {
        await dbClient.execute({
          sql: `INSERT INTO system_config (key, value, updated_at)
                VALUES ('min_success_rate', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          args: [minSuccessRate.toString()],
        });
      }

      if (lessonAgeDays !== undefined) {
        await dbClient.execute({
          sql: `INSERT INTO system_config (key, value, updated_at)
                VALUES ('lesson_age_days', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          args: [lessonAgeDays.toString()],
        });
      }

      logger.info(`📝 Learning config updated: count=${lessonCount}, minSuccess=${minSuccessRate}%, age=${lessonAgeDays}d`);

      return c.json({
        success: true,
        message: "Learning configuration updated",
        config: { lessonCount, minSuccessRate, lessonAgeDays }
      });
    } catch (error: any) {
      logger.error("Failed to update learning config:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get top lessons
   */
  app.get("/api/learning/lessons", async (c) => {
    try {
      const limit = parseInt(c.req.query("limit") || "10");

      const result = await dbClient.execute({
        sql: `SELECT * FROM learned_lessons
              WHERE is_active = 1
              ORDER BY (success_rate * 0.5 + COALESCE(effectiveness_rate, 0) * 0.3 +
                       CASE confidence_level WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.7 ELSE 0.4 END * 0.2) DESC
              LIMIT ?`,
        args: [limit],
      });

      const lessons = result.rows.map((row: any) => ({
        id: row.id,
        category: row.lesson_category,
        text: row.lesson_text,
        successRate: row.success_rate,
        avgPnl: row.avg_pnl,
        confidenceLevel: row.confidence_level,
        applicableSymbols: row.applicable_symbols,
        timesApplied: row.times_applied || 0,
        timesHelpful: row.times_helpful || 0,
        effectivenessRate: row.effectiveness_rate || 0,
        createdAt: row.created_at,
      }));

      return c.json({ lessons });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  /**
   * Get recent reflections
   */
  app.get("/api/learning/reflections", async (c) => {
    try {
      const limit = parseInt(c.req.query("limit") || "5");
      const offset = parseInt(c.req.query("offset") || "0");
      const filter = c.req.query("filter") || "all"; // all, accurate, inaccurate, pending

      // Build WHERE clause based on filter
      let whereClause = "";
      if (filter === "accurate") {
        whereClause = "WHERE feedback_score >= 8";
      } else if (filter === "inaccurate") {
        whereClause = "WHERE feedback_score <= 4";
      } else if (filter === "pending") {
        whereClause = "WHERE feedback_score IS NULL";
      }

      // Get total count for pagination
      const countSql = `SELECT COUNT(*) as total FROM trading_reflections ${whereClause}`;
      const countResult = await dbClient.execute({ sql: countSql, args: [] });
      const totalCount = (countResult.rows[0] as any).total;

      // Get paginated reflections
      const sql = `SELECT * FROM trading_reflections ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      const args: any[] = [limit, offset];

      const result = await dbClient.execute({ sql, args });

      const reflections = result.rows.map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        symbol: row.symbol,
        decisionType: row.decision_type,
        vision: row.vision,
        confidenceScore: row.confidence_score,
        reasoning: row.reasoning,
        priceAtDecision: row.price_at_decision,
        targetPrice: row.target_price,
        actualPrice: row.actual_price,
        priceChangePercent: row.price_change_percent,
        predictionAccuracy: row.prediction_accuracy,
        feedbackScore: row.feedback_score,
        outcomeType: row.outcome_type,
        pnlResult: row.pnl_result,
      }));

      return c.json({
        reflections,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
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

