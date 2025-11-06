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
import { createContainer } from "../container";
import { createServices } from "../application/services";

// Initialize container and services
const container = createContainer();
const { logger, config } = container;
const services = createServices(
  container.exchangeClient,
  container.database,
  container.logger,
  container.config
);

/**
 * Record account assets including unrealized PnL
 */
async function recordAccountAssets() {
  try {
    // Use AccountService to create snapshot
    const snapshot = await services.account.createSnapshot();

    logger.accountSnapshot({
      balance: snapshot.total_value,
      equity: snapshot.total_value,
      marginAvailable: snapshot.available_cash,
      pnlTotal: snapshot.realized_pnl + snapshot.unrealized_pnl,
    });
  } catch (error) {
    logger.error(error as Error, { operation: 'recordAccountAssets' });
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
