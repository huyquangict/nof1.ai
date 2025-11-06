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
 * Base Repository
 *
 * Provides common database operations for all repositories.
 * Implements the Repository Pattern to abstract data access.
 */

import type { Client as LibSQLClient } from '@libsql/client';
import type { TradingLogger } from '../../logger';

/**
 * Base repository class with common database operations
 *
 * All specific repositories should extend from this class.
 */
export abstract class BaseRepository {
  protected readonly db: LibSQLClient;
  protected readonly logger: TradingLogger;
  protected readonly tableName: string;

  constructor(db: LibSQLClient, logger: TradingLogger, tableName: string) {
    this.db = db;
    this.logger = logger;
    this.tableName = tableName;
  }

  /**
   * Execute a SQL query with parameters
   */
  protected async execute(sql: string, params?: any[]): Promise<any> {
    try {
      this.logger.debug(`Executing query on ${this.tableName}`, {
        table: this.tableName,
        sql: sql.substring(0, 100),
      });

      const result = await this.db.execute({
        sql,
        args: params ?? [],
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        operation: 'database_query',
        table: this.tableName,
        sql: sql.substring(0, 100),
      });
      throw error;
    }
  }

  /**
   * Map database row to object, parsing JSON fields
   */
  protected mapRow<T>(row: any, jsonFields?: string[]): T {
    const mapped: any = { ...row };

    // Parse JSON fields
    if (jsonFields) {
      for (const field of jsonFields) {
        if (mapped[field] && typeof mapped[field] === 'string') {
          try {
            mapped[field] = JSON.parse(mapped[field]);
          } catch {
            // Keep as string if JSON parse fails
          }
        }
      }
    }

    return mapped as T;
  }

  /**
   * Find all records in the table
   */
  protected async findAll<T>(jsonFields?: string[]): Promise<T[]> {
    const result = await this.execute(`SELECT * FROM ${this.tableName}`);
    return result.rows.map((row: any) => this.mapRow<T>(row, jsonFields));
  }

  /**
   * Find record by ID
   */
  protected async findById<T>(id: number | string, jsonFields?: string[]): Promise<T | null> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow<T>(result.rows[0], jsonFields);
  }

  /**
   * Count records in the table
   */
  protected async count(whereClause?: string, params?: any[]): Promise<number> {
    const sql = whereClause
      ? `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereClause}`
      : `SELECT COUNT(*) as count FROM ${this.tableName}`;

    const result = await this.execute(sql, params);
    return Number(result.rows[0].count);
  }

  /**
   * Delete record by ID
   */
  protected async deleteById(id: number | string): Promise<void> {
    await this.execute(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);

    this.logger.debug(`Deleted record from ${this.tableName}`, {
      table: this.tableName,
      id,
    });
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  async commit(): Promise<void> {
    await this.execute('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  async rollback(): Promise<void> {
    await this.execute('ROLLBACK');
  }
}
