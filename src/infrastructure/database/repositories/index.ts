/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Repository Factory
 *
 * Central module for creating repository instances.
 */

import type { Client as LibSQLClient } from '@libsql/client';
import type { TradingLogger } from '../../logger';
import { PositionRepository } from './position';
import { TradeRepository } from './trade';
import { AccountRepository } from './account';

/**
 * Create position repository
 */
export function createPositionRepository(
  db: LibSQLClient,
  logger: TradingLogger
): PositionRepository {
  return new PositionRepository(db, logger);
}

/**
 * Create trade repository
 */
export function createTradeRepository(
  db: LibSQLClient,
  logger: TradingLogger
): TradeRepository {
  return new TradeRepository(db, logger);
}

/**
 * Create account repository
 */
export function createAccountRepository(
  db: LibSQLClient,
  logger: TradingLogger
): AccountRepository {
  return new AccountRepository(db, logger);
}

/**
 * Create all repositories from container
 *
 * @example
 * ```typescript
 * import { createRepositories } from './infrastructure/database/repositories';
 * import { createContainer } from './container';
 *
 * const container = createContainer();
 * const repos = createRepositories(container.database, container.logger);
 *
 * const positions = await repos.position.findAll();
 * ```
 */
export function createRepositories(db: LibSQLClient, logger: TradingLogger) {
  return {
    position: createPositionRepository(db, logger),
    trade: createTradeRepository(db, logger),
    account: createAccountRepository(db, logger),
  };
}

// Re-export repository classes and base
export { BaseRepository } from './base';
export { PositionRepository } from './position';
export { TradeRepository } from './trade';
export { AccountRepository } from './account';
