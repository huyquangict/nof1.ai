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
 * Container Types
 *
 * Type definitions for the dependency injection container.
 */

import type { Client as LibSQLClient } from '@libsql/client';
import type { IExchangeClient } from '../services/exchange/IExchangeClient';
import type { SystemConfig } from './config';
import type { TradingLogger } from '../infrastructure/logger';

/**
 * Application container interface
 *
 * This container holds all major dependencies for the trading system.
 * Services, tools, and other components receive their dependencies
 * through this container instead of using singletons.
 */
export interface AppContainer {
  /**
   * System configuration
   */
  config: SystemConfig;

  /**
   * Exchange client for API operations
   */
  exchangeClient: IExchangeClient;

  /**
   * Database connection
   */
  database: LibSQLClient;

  /**
   * Logger instance
   */
  logger: TradingLogger;
}

/**
 * Container creation options
 */
export interface ContainerOptions {
  /**
   * Override config (useful for testing)
   */
  config?: SystemConfig;

  /**
   * Override exchange client (useful for testing with mocks)
   */
  exchangeClient?: IExchangeClient;

  /**
   * Override database (useful for testing)
   */
  database?: LibSQLClient;

  /**
   * Override logger (useful for testing)
   */
  logger?: TradingLogger;
}

/**
 * Partial container for optional dependencies
 */
export type PartialContainer = Partial<AppContainer>;
