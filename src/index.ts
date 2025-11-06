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

import "dotenv/config";
import { createPinoLogger } from "@voltagent/logger";
import { serve } from "@hono/node-server";
import { createApiRoutes } from "./api/routes";
import { startTradingLoop, initTradingSystem } from "./scheduler/tradingLoop";
import { startAccountRecorder } from "./scheduler/accountRecorder";
import { runProfitManager } from "./scheduler/profitManager";
import { initDatabase } from "./database/init";
import { RISK_PARAMS } from "./config/riskParams";

// 设置时区为中国time(Asia/Shanghai,UTC+8)
process.env.TZ = 'Asia/Shanghai';

// Create logger instance (using China timezone)
const logger = createPinoLogger({
  name: "ai-btc",
  level: "info",
  formatters: {
    timestamp: () => {
      // Using system timezone setting, already set to Asia/Shanghai
      const now = new Date();
      // 正确格式化:Use toLocaleString to get China time, then convert to ISO format
      const chinaOffset = 8 * 60; // 中国时区偏移(分钟)
      const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
      const chinaTime = new Date(utc + (chinaOffset * 60 * 1000));
      return `, "time": "${chinaTime.toISOString().replace('Z', '+08:00')}"`;
    }
  }
});

// 全局服务器实例
let server: any = null;

/**
 * 主函数
 */
async function main() {
  logger.info("Starting AI Cryptocurrency Auto-Trading System");

  // 1. Initialize database
  logger.info("Initializing database...");
  await initDatabase();

  // 2. Initialize trading system configuration
  await initTradingSystem();

  // 3. Start API server
  logger.info("🌐 Starting Web Server...");
  const apiRoutes = createApiRoutes();

  const port = Number.parseInt(process.env.PORT || "3141");

  server = serve({
    fetch: apiRoutes.fetch,
    port,
  });

  logger.info(`Web server started: http://localhost:${port}`);
  logger.info(`Dashboard: http://localhost:${port}/`);

  // 4. Start profit manager (fast loop - 30 seconds)
  logger.info("💰 Starting profit manager...");
  const profitManagerInterval = 30 * 1000; // 30 seconds
  setInterval(() => {
    runProfitManager(logger as any).catch((error) => {
      logger.error("Profit manager error:", error);
    });
  }, profitManagerInterval);
  // Run immediately once
  runProfitManager(logger as any).catch((error) => {
    logger.error("Profit manager initial run error:", error);
  });

  // 5. Start trading loop
  logger.info("Starting trading loop...");
  startTradingLoop();

  // 6. Start account recorder
  logger.info("Starting account recorder...");
  startAccountRecorder();

  logger.info("\n" + "=".repeat(80));
  logger.info("System Started Successfully!");
  logger.info("=".repeat(80));
  logger.info(`\nDashboard: http://localhost:${port}/`);
  logger.info(`Profit Manager Interval: ${profitManagerInterval / 1000} seconds`);
  logger.info(`Trading Interval: ${process.env.TRADING_INTERVAL_MINUTES || 5} minutes`);
  logger.info(`Account Record Interval: ${process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || 10} minutes`);
  logger.info(`Trading Symbols: ${RISK_PARAMS.TRADING_SYMBOLS.join(', ')}`);
  logger.info(`Max Leverage: ${RISK_PARAMS.MAX_LEVERAGE}x`);
  logger.info(`Max Positions: ${RISK_PARAMS.MAX_POSITIONS}`);
  logger.info(`\n🔴 Stop Loss: ${process.env.ACCOUNT_STOP_LOSS_USDT || 50} USDT (close all & exit)`);
  logger.info(`🟢 Take Profit: ${process.env.ACCOUNT_TAKE_PROFIT_USDT || 10000} USDT (close all & exit)`);
  logger.info("\nPress Ctrl+C to stop the system\n");
}

// Error handling
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled promise rejection:", { reason });
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`\n\nReceived ${signal} signal, shutting down system...`);

  try {
    // Close server
    if (server) {
      logger.info("Closing web server...");
      server.close();
      logger.info("Web server closed");
    }

    logger.info("System shut down safely");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error as any);
    process.exit(1);
  }
}

// 监听退出信号
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// startshould用
await main();
