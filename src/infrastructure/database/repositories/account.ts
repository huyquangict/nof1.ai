/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Account Repository - Handles all database operations for account_history table
 */

import type { AccountHistory } from '../../../database/schema';
import { BaseRepository } from './base';

export class AccountRepository extends BaseRepository {
  constructor(db: any, logger: any) {
    super(db, logger, 'account_history');
  }

  async findAllAccountHistory(): Promise<AccountHistory[]> {
    return super.findAll<AccountHistory>();
  }

  async findRecent(limit: number = 100): Promise<AccountHistory[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    return result.rows.map((row: any) => this.mapRow<AccountHistory>(row));
  }

  async findLatest(): Promise<AccountHistory | null> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT 1`
    );
    return result.rows.length > 0 ? this.mapRow<AccountHistory>(result.rows[0]) : null;
  }

  async create(account: Omit<AccountHistory, 'id'>): Promise<AccountHistory> {
    const sql = `
      INSERT INTO ${this.tableName} (
        timestamp, total_value, available_cash, unrealized_pnl,
        realized_pnl, return_percent, sharpe_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await this.execute(sql, [
      account.timestamp, account.total_value, account.available_cash,
      account.unrealized_pnl, account.realized_pnl, account.return_percent,
      account.sharpe_ratio ?? null,
    ]);

    return (await this.findLatest())!;
  }

  async countAll(): Promise<number> {
    return super.count();
  }
}
