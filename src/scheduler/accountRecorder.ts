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
 * Account Recorder - Record account assets every 10 minutes (including unrealized PnL)
 */
import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { createExchangeClient } from "../services/exchange";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createPinoLogger({
  name: "account-recorder",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * Record account assets including unrealized PnL
 */
async function recordAccountAssets() {
  try {
    const exchangeClient = createExchangeClient();

    // Get account information from exchange
    const account = await exchangeClient.getFuturesAccount();

    // Extract account data (adapter already includes unrealized PnL in totalBalance)
    const totalBalance = account.totalBalance;
    const availableBalance = account.availableBalance;
    const unrealisedPnl = account.unrealisedPnl;
    
    // Get initial balance from database
    const initialResult = await dbClient.execute(
      "SELECT total_value FROM account_history ORDER BY timestamp ASC LIMIT 1"
    );
    const initialBalance = initialResult.rows[0]
      ? Number.parseFloat(initialResult.rows[0].total_value as string)
      : totalBalance; // Use current balance as initial if no history exists
    
    // Calculate realized PnL and return percentage
    const realizedPnl = totalBalance - initialBalance;
    const returnPercent = initialBalance > 0 
      ? (realizedPnl / initialBalance) * 100 
      : 0;
    
    // Save to database
    await dbClient.execute({
      sql: `INSERT INTO account_history 
            (timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        getChinaTimeISO(),
        totalBalance,
        availableBalance,
        unrealisedPnl,
        realizedPnl,
        returnPercent,
      ],
    });
    
    logger.info(
      `📊 Account recorded: Total=${totalBalance.toFixed(2)} USDT, ` +
      `Available=${availableBalance.toFixed(2)} USDT, ` +
      `Unrealized PnL=${unrealisedPnl >= 0 ? '+' : ''}${unrealisedPnl.toFixed(2)} USDT, ` +
      `Return=${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%`
    );
  } catch (error) {
    logger.error("Failed to record account assets:", error as any);
  }
}

/**
 * Start account recorder
 */
export function startAccountRecorder() {
  const intervalMinutes = Number.parseInt(
    process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || "10"
  );
  
  logger.info(`Starting account recorder, interval: ${intervalMinutes} minutes`);
  
  // Execute immediately on startup
  recordAccountAssets();
  
  // Schedule periodic recording
  const cronExpression = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpression, () => {
    recordAccountAssets();
  });
  
  logger.info(`Account recorder scheduled: ${cronExpression}`);
}

