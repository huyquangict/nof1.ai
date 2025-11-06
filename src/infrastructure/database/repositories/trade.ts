/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Trade Repository - Handles all database operations for trades table
 */

import type { Trade } from '../../../database/schema';
import { BaseRepository } from './base';

export class TradeRepository extends BaseRepository {
  constructor(db: any, logger: any) {
    super(db, logger, 'trades');
  }

  async findAllTrades(): Promise<Trade[]> {
    return super.findAll<Trade>();
  }

  async findBySymbol(symbol: string): Promise<Trade[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE symbol = ? ORDER BY timestamp DESC`,
      [symbol]
    );
    return result.rows.map((row: any) => this.mapRow<Trade>(row));
  }

  async findByEntryOrderId(entryOrderId: string): Promise<Trade[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} WHERE entry_order_id = ? ORDER BY timestamp DESC`,
      [entryOrderId]
    );
    return result.rows.map((row: any) => this.mapRow<Trade>(row));
  }

  async findRecent(limit: number = 10): Promise<Trade[]> {
    const result = await this.execute(
      `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    return result.rows.map((row: any) => this.mapRow<Trade>(row));
  }

  async create(trade: Omit<Trade, 'id'>): Promise<Trade> {
    const sql = `
      INSERT INTO ${this.tableName} (
        order_id, symbol, side, type, price, quantity, leverage,
        pnl, fee, timestamp, status, close_reason, entry_order_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.execute(sql, [
      trade.order_id, trade.symbol, trade.side, trade.type, trade.price,
      trade.quantity, trade.leverage, trade.pnl ?? null, trade.fee ?? null,
      trade.timestamp, trade.status, trade.close_reason ?? null,
      trade.entry_order_id ?? null,
    ]);

    return (await this.findById<Trade>(await this.getLastInsertId()))!;
  }

  private async getLastInsertId(): Promise<number> {
    const result = await this.execute('SELECT last_insert_rowid() as id');
    return Number(result.rows[0].id);
  }
}
