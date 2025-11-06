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
 * Position Repository
 *
 * Handles all database operations for positions table.
 */

import type { Position } from '../../../database/schema';
import { BaseRepository } from './base';

/**
 * Position repository for managing position records
 */
export class PositionRepository extends BaseRepository {
  constructor(db: any, logger: any) {
    super(db, logger, 'positions');
  }

  /**
   * Find all positions
   */
  async findAllPositions(): Promise<Position[]> {
    return super.findAll<Position>(['tp_orders', 'sl_orders']);
  }

  /**
   * Find position by symbol
   */
  async findBySymbol(symbol: string): Promise<Position | null> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE symbol = ?`,
      [symbol]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow<Position>(result.rows[0], ['tp_orders', 'sl_orders']);
  }

  /**
   * Find all profitable positions
   */
  async findProfitable(minPnlPercent: number = 0): Promise<Position[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE unrealized_pnl / (entry_price * quantity * leverage) * 100 >= ?`,
      [minPnlPercent]
    );

    return result.rows.map((row: any) => this.mapRow<Position>(row, ['tp_orders', 'sl_orders']));
  }

  /**
   * Find positions by side
   */
  async findBySide(side: 'long' | 'short'): Promise<Position[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE side = ?`,
      [side]
    );

    return result.rows.map((row: any) => this.mapRow<Position>(row, ['tp_orders', 'sl_orders']));
  }

  /**
   * Create new position
   */
  async create(position: Omit<Position, 'id'>): Promise<Position> {
    const sql = `
      INSERT INTO ${this.tableName} (
        symbol, quantity, entry_price, current_price, liquidation_price,
        unrealized_pnl, leverage, side, profit_target, stop_loss,
        tp_order_id, sl_order_id, tp_percentage, sl_percentage,
        tp_orders, sl_orders, entry_order_id, opened_at,
        confidence, risk_usd, peak_pnl_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const tpOrders = position.tp_orders ? JSON.stringify(position.tp_orders) : null;
    const slOrders = position.sl_orders ? JSON.stringify(position.sl_orders) : null;

    await this.execute(sql, [
      position.symbol,
      position.quantity,
      position.entry_price,
      position.current_price,
      position.liquidation_price,
      position.unrealized_pnl,
      position.leverage,
      position.side,
      position.profit_target ?? null,
      position.stop_loss ?? null,
      position.tp_order_id ?? null,
      position.sl_order_id ?? null,
      position.tp_percentage ?? null,
      position.sl_percentage ?? null,
      tpOrders,
      slOrders,
      position.entry_order_id,
      position.opened_at,
      position.confidence ?? null,
      position.risk_usd ?? null,
      position.peak_pnl_percent ?? 0,
    ]);

    this.logger.info(`Position created: ${position.symbol}`, {
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
    });

    // Return the created position
    const created = await this.findBySymbol(position.symbol);
    return created!;
  }

  /**
   * Update position
   */
  async update(symbol: string, updates: Partial<Omit<Position, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    // Build UPDATE SET clause dynamically
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'tp_orders' || key === 'sl_orders') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return; // Nothing to update
    }

    values.push(symbol);

    const sql = `UPDATE ${this.tableName} SET ${fields.join(', ')} WHERE symbol = ?`;
    await this.execute(sql, values);

    this.logger.debug(`Position updated: ${symbol}`, {
      symbol,
      fieldsUpdated: Object.keys(updates),
    });
  }

  /**
   * Delete position by symbol
   */
  async deleteBySymbol(symbol: string): Promise<void> {
    await this.execute(`DELETE FROM ${this.tableName} WHERE symbol = ?`, [symbol]);

    this.logger.info(`Position deleted: ${symbol}`, { symbol });
  }

  /**
   * Update TP orders
   */
  async updateTpOrders(symbol: string, tpOrders: any[]): Promise<void> {
    await this.update(symbol, { tp_orders: tpOrders });
  }

  /**
   * Update SL orders
   */
  async updateSlOrders(symbol: string, slOrders: any[]): Promise<void> {
    await this.update(symbol, { sl_orders: slOrders });
  }

  /**
   * Count total positions
   */
  async countAll(): Promise<number> {
    return super.count();
  }

  /**
   * Delete all positions
   */
  async deleteAll(): Promise<void> {
    await this.execute(`DELETE FROM ${this.tableName}`);
    this.logger.warn('All positions deleted');
  }
}
