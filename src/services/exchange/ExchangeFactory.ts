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
 * Exchange Factory
 *
 * Provides a singleton instance of Binance exchange client.
 */

import { createPinoLogger } from "@voltagent/logger";
import { IExchangeClient } from './IExchangeClient';
import { BinanceAdapter } from './BinanceAdapter';

const logger = createPinoLogger({
  name: "exchange-factory",
  level: "info",
});

/**
 * Singleton instance of the exchange client
 */
let exchangeClientInstance: IExchangeClient | null = null;

/**
 * Create or get the singleton Binance exchange client instance
 *
 * Testnet is determined by USE_TESTNET environment variable
 *
 * @returns IExchangeClient instance (Binance)
 */
export function createExchangeClient(): IExchangeClient {
  // Return existing instance if available
  if (exchangeClientInstance) {
    return exchangeClientInstance;
  }

  // Log exchange initialization
  logger.info('Initializing Binance exchange client...');

  // Create Binance client
  exchangeClientInstance = createBinanceClient();

  logger.info(`Binance client initialized (testnet: ${exchangeClientInstance.isTestnet()})`);

  return exchangeClientInstance;
}

/**
 * Create Binance exchange client
 */
function createBinanceClient(): IExchangeClient {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Binance credentials not configured. Please set BINANCE_API_KEY and BINANCE_API_SECRET environment variables.'
    );
  }

  const testnet = process.env.USE_TESTNET === 'true';
  const marginMode = (process.env.BINANCE_MARGIN_MODE as 'isolated' | 'crossed') ?? 'isolated';

  return new BinanceAdapter({
    apiKey,
    apiSecret,
    testnet,
    marginMode,
  });
}

/**
 * Reset the exchange client instance
 * Useful for testing or when switching exchanges at runtime
 */
export function resetExchangeClient(): void {
  exchangeClientInstance = null;
  logger.info('Exchange client instance reset');
}

/**
 * Get the current exchange name
 * @returns Always returns 'binance'
 */
export function getConfiguredExchange(): string {
  return 'binance';
}

/**
 * Check if testnet is configured
 * @returns true if testnet is enabled
 */
export function isTestnetConfigured(): boolean {
  return process.env.USE_TESTNET === 'true';
}
