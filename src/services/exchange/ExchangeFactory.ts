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
 * Exchange Factory
 *
 * Provides a singleton instance of the configured exchange client.
 * Supports multiple exchanges through the IExchangeClient interface.
 */

import { createPinoLogger } from "@voltagent/logger";
import { IExchangeClient } from './IExchangeClient';
import { GateAdapter } from './GateAdapter';
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
 * Create or get the singleton exchange client instance
 *
 * The exchange is determined by the EXCHANGE environment variable:
 * - "gateio" or "gate" -> Gate.io (default)
 * - "binance" -> Binance (future support)
 *
 * Testnet is determined by USE_TESTNET environment variable (for new exchanges)
 * or GATE_USE_TESTNET for Gate.io (backward compatibility)
 *
 * @returns IExchangeClient instance
 */
export function createExchangeClient(): IExchangeClient {
  // Return existing instance if available
  if (exchangeClientInstance) {
    return exchangeClientInstance;
  }

  // Determine which exchange to use
  const exchange = (process.env.EXCHANGE || 'gateio').toLowerCase();

  // Log exchange selection
  logger.info(`Initializing exchange client: ${exchange}`);

  switch (exchange) {
    case 'gateio':
    case 'gate':
      exchangeClientInstance = createGateClient();
      break;

    case 'binance':
      exchangeClientInstance = createBinanceClient();
      break;

    default:
      logger.warn(`Unknown exchange: ${exchange}, falling back to Gate.io`);
      exchangeClientInstance = createGateClient();
      break;
  }

  logger.info(`Exchange client initialized: ${exchangeClientInstance.getExchangeName()} (testnet: ${exchangeClientInstance.isTestnet()})`);

  return exchangeClientInstance;
}

/**
 * Create Gate.io exchange client
 * Maintains backward compatibility with existing GATE_* environment variables
 */
function createGateClient(): IExchangeClient {
  const apiKey = process.env.GATE_API_KEY;
  const apiSecret = process.env.GATE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Gate.io credentials not configured. Please set GATE_API_KEY and GATE_API_SECRET environment variables.'
    );
  }

  // Support both USE_TESTNET (new) and GATE_USE_TESTNET (backward compatibility)
  const testnet = process.env.USE_TESTNET === 'true' || process.env.GATE_USE_TESTNET === 'true';

  return new GateAdapter(apiKey, apiSecret, testnet);
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
 * Get the current exchange name without creating an instance
 * @returns Exchange name from environment or 'gateio' as default
 */
export function getConfiguredExchange(): string {
  return (process.env.EXCHANGE || 'gateio').toLowerCase();
}

/**
 * Check if testnet is configured
 * @returns true if testnet is enabled
 */
export function isTestnetConfigured(): boolean {
  const exchange = getConfiguredExchange();

  switch (exchange) {
    case 'gateio':
    case 'gate':
      return process.env.USE_TESTNET === 'true' || process.env.GATE_USE_TESTNET === 'true';

    case 'binance':
      return process.env.USE_TESTNET === 'true';

    default:
      return false;
  }
}
