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
 * Base Container
 *
 * Implements the dependency injection container for the trading system.
 * Provides access to all major dependencies without using global singletons.
 */

import { createClient, type Client as LibSQLClient } from '@libsql/client';
import type { IExchangeClient } from '../services/exchange/IExchangeClient';
import { BinanceAdapter } from '../services/exchange/BinanceAdapter';
import { getConfig, type SystemConfig } from '../config';
import { createTradingLogger, type TradingLogger } from '../infrastructure/logger';
import type { AppContainer, ContainerOptions } from '../types/container';

/**
 * Container class that holds all application dependencies
 *
 * This replaces global singletons with a centralized dependency container.
 * Makes testing easier by allowing dependency injection.
 */
export class Container implements AppContainer {
  public readonly config: SystemConfig;
  public readonly exchangeClient: IExchangeClient;
  public readonly database: LibSQLClient;
  public readonly logger: TradingLogger;

  constructor(options?: ContainerOptions) {
    // Load or use provided config
    this.config = options?.config ?? getConfig();

    // Create or use provided logger
    this.logger = options?.logger ?? createTradingLogger('container');

    // Create or use provided exchange client
    this.exchangeClient = options?.exchangeClient ?? this.createExchangeClient();

    // Create or use provided database
    this.database = options?.database ?? this.createDatabase();

    this.logger.debug('Container initialized', {
      hasConfig: !!this.config,
      hasExchangeClient: !!this.exchangeClient,
      hasDatabase: !!this.database,
    });
  }

  /**
   * Create exchange client from configuration
   */
  private createExchangeClient(): IExchangeClient {
    const { exchange } = this.config;

    this.logger.debug('Creating exchange client', {
      exchange: exchange.name,
      testnet: exchange.testnet,
    });

    return new BinanceAdapter({
      apiKey: exchange.apiKey,
      apiSecret: exchange.apiSecret,
      testnet: exchange.testnet,
      marginMode: exchange.marginMode,
    });
  }

  /**
   * Create database connection from configuration
   */
  private createDatabase(): LibSQLClient {
    const { database } = this.config;

    this.logger.debug('Creating database connection', {
      url: database.url,
    });

    return createClient({
      url: database.url,
    });
  }

  /**
   * Create a child container with overridden dependencies
   *
   * Useful for creating isolated containers for testing.
   *
   * @example
   * ```typescript
   * const testContainer = container.fork({
   *   exchangeClient: mockExchangeClient,
   *   database: mockDatabase
   * });
   * ```
   */
  fork(overrides: ContainerOptions): Container {
    return new Container({
      config: overrides.config ?? this.config,
      exchangeClient: overrides.exchangeClient ?? this.exchangeClient,
      database: overrides.database ?? this.database,
      logger: overrides.logger ?? this.logger,
    });
  }

  /**
   * Dispose of container resources
   *
   * Closes database connections and cleans up resources.
   * Should be called when shutting down the application.
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing container resources');

    try {
      // Close database connection
      this.database.close();
      this.logger.debug('Database connection closed');
    } catch (error) {
      this.logger.error(error as Error, {
        operation: 'dispose_container',
        resource: 'database',
      });
    }
  }
}
