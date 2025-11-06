/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Service Layer Factory
 *
 * Central module for creating and managing service instances.
 */

import { PositionService } from './PositionService';
import { RiskService } from './RiskService';
import { AccountService } from './AccountService';

import type { IExchangeClient } from '../../services/exchange/IExchangeClient';
import type { TradingLogger } from '../../infrastructure/logger';
import type { SystemConfig } from '../../types/config';
import type { Client as LibSQLClient } from '@libsql/client';
import { createRepositories } from '../../infrastructure/database/repositories';

// Re-export service classes
export { PositionService } from './PositionService';
export { RiskService } from './RiskService';
export { AccountService } from './AccountService';

// Re-export service types
export type {
  OpenPositionParams,
  OpenPositionResult,
  ClosePositionParams,
  ClosePositionResult,
  UpdateStopLossParams,
  UpdateTakeProfitParams,
  RiskCheckParams,
  RiskCheckResult,
  PositionRiskMetrics,
  AccountRiskMetrics,
  AccountBalance,
  AccountSnapshot,
} from '../../types/services';

/**
 * Service container interface
 */
export interface ServiceContainer {
  position: PositionService;
  risk: RiskService;
  account: AccountService;
}

/**
 * Create all services with shared dependencies
 *
 * @param exchangeClient - Exchange client instance
 * @param database - Database client instance
 * @param logger - Trading logger instance
 * @param config - System configuration
 * @returns ServiceContainer with all services
 *
 * @example
 * ```typescript
 * import { createServices } from './application/services';
 * import { createContainer } from './container';
 *
 * const container = createContainer();
 * const services = createServices(
 *   container.exchangeClient,
 *   container.database,
 *   container.logger,
 *   container.config
 * );
 *
 * // Use services
 * const result = await services.position.openPosition({
 *   symbol: 'BTC',
 *   side: 'long',
 *   quantity: 0.1,
 *   leverage: 10,
 * });
 * ```
 */
export function createServices(
  exchangeClient: IExchangeClient,
  database: LibSQLClient,
  logger: TradingLogger,
  config: SystemConfig
): ServiceContainer {
  // Create repositories
  const repos = createRepositories(database, logger);

  // Create services with dependencies
  const positionService = new PositionService(
    exchangeClient,
    repos.position,
    repos.trade,
    logger,
    config
  );

  const riskService = new RiskService(
    exchangeClient,
    repos.position,
    repos.account,
    logger,
    config
  );

  const accountService = new AccountService(
    exchangeClient,
    repos.account,
    repos.position,
    logger,
    config
  );

  return {
    position: positionService,
    risk: riskService,
    account: accountService,
  };
}

/**
 * Factory function for creating a single PositionService instance
 */
export function createPositionService(
  exchangeClient: IExchangeClient,
  database: LibSQLClient,
  logger: TradingLogger,
  config: SystemConfig
): PositionService {
  const repos = createRepositories(database, logger);
  return new PositionService(exchangeClient, repos.position, repos.trade, logger, config);
}

/**
 * Factory function for creating a single RiskService instance
 */
export function createRiskService(
  exchangeClient: IExchangeClient,
  database: LibSQLClient,
  logger: TradingLogger,
  config: SystemConfig
): RiskService {
  const repos = createRepositories(database, logger);
  return new RiskService(exchangeClient, repos.position, repos.account, logger, config);
}

/**
 * Factory function for creating a single AccountService instance
 */
export function createAccountService(
  exchangeClient: IExchangeClient,
  database: LibSQLClient,
  logger: TradingLogger,
  config: SystemConfig
): AccountService {
  const repos = createRepositories(database, logger);
  return new AccountService(exchangeClient, repos.account, repos.position, logger, config);
}
