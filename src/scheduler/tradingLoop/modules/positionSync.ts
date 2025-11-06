/**
 * Position Synchronizer Module
 * Handles synchronization of positions between exchange and database
 * Note: SL/TP detection is handled by profit manager (runs every 30s)
 */

import { createPinoLogger } from "@voltagent/logger";
import type { Client } from "@libsql/client";
import type { IExchangeClient, Position } from "../../../services/exchange/IExchangeClient";

const logger = createPinoLogger({
  name: "position-sync",
  level: "info",
});

/**
 * Position synchronizer class - handles all position sync logic
 */
export class PositionSynchronizer {
  constructor(
    private exchangeClient: IExchangeClient,
    private database: Client
  ) {}

  /**
   * Main synchronization method
   * Syncs positions from exchange to database (prices, quantities only)
   * Note: SL/TP detection is handled by profit manager (runs every 30s)
   */
  async syncPositions(cachedPositions?: Position[]): Promise<void> {
    try {
      // Fetch positions (use cached if available)
      const positions = cachedPositions || await this.exchangeClient.getPositions();

      // Get existing DB positions
      const dbResult = await this.database.execute(
        "SELECT symbol, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, stop_loss, profit_target, entry_order_id, opened_at, peak_pnl_percent FROM positions"
      );
      const dbPositionsMap = new Map(
        dbResult.rows.map((row: any) => [row.symbol, row])
      );

      // Safety check: Don't clear DB if exchange returns 0 but DB has positions (API delay)
      if (positions.length === 0 && dbResult.rows.length > 0) {
        logger.warn(
          `Warning: Exchange returned 0 positions, but database has ${dbResult.rows.length} positions, possibly API delay, skipping sync`
        );
        return;
      }

      // Remove closed positions from database
      // Note: Profit manager already detected and recorded SL/TP triggers
      const exchangeSymbols = new Set(positions.map(p => p.symbol));
      for (const dbRow of dbResult.rows) {
        const dbSymbol = (dbRow as any).symbol;
        if (!exchangeSymbols.has(dbSymbol)) {
          logger.debug(`Removing closed position from database: ${dbSymbol}`);
          await this.database.execute({
            sql: 'DELETE FROM positions WHERE symbol = ?',
            args: [dbSymbol]
          });
        }
      }

      // Update or insert positions
      for (const pos of positions) {
        await this.upsertPosition(pos, dbPositionsMap);
      }

      logger.debug(`Synced ${positions.length} position(s) from exchange`);
    } catch (error) {
      logger.error("Failed to sync positions:", error as any);
    }
  }

  /**
   * Update or insert a position into the database, preserving metadata
   */
  private async upsertPosition(
    pos: Position,
    dbPositionsMap: Map<string, any>
  ): Promise<void> {
    const symbol = pos.symbol;
    let entryPrice = pos.entryPrice;
    let currentPrice = pos.currentPrice;
    const leverage = pos.leverage;
    const side = pos.side;
    const quantity = pos.quantity;
    const unrealizedPnl = pos.unrealizedPnl;
    let liquidationPrice = pos.liquidationPrice;

    // Fill in missing prices
    if (entryPrice === 0 || currentPrice === 0) {
      try {
        const ticker = await this.exchangeClient.getFuturesTicker(symbol);
        if (currentPrice === 0) {
          currentPrice = ticker.markPrice;
        }
        if (entryPrice === 0) {
          entryPrice = currentPrice;
        }
      } catch (error) {
        logger.error(`Failed to fetch ${symbol} ticker:`, error as any);
      }
    }

    // Calculate liquidation price if missing
    if (liquidationPrice === 0 && entryPrice > 0) {
      liquidationPrice = side === "long"
        ? entryPrice * (1 - 0.9 / leverage)
        : entryPrice * (1 + 0.9 / leverage);
    }

    const dbPos = dbPositionsMap.get(symbol);

    // Preserve original entry_order_id and opened_at
    const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;

    await this.database.execute({
      sql: `INSERT INTO positions
            (symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl,
             leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, sl_percentage, tp_percentage, tp_orders, sl_orders, entry_order_id, opened_at, peak_pnl_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        symbol,
        quantity,
        entryPrice,
        currentPrice,
        liquidationPrice,
        unrealizedPnl,
        leverage,
        side,
        dbPos?.stop_loss || null,
        dbPos?.profit_target || null,
        dbPos?.sl_order_id || null,
        dbPos?.tp_order_id || null,
        dbPos?.sl_percentage || null,
        dbPos?.tp_percentage || null,
        dbPos?.tp_orders || null,
        dbPos?.sl_orders || null,
        entryOrderId,
        dbPos?.opened_at || new Date().toISOString(),
        dbPos?.peak_pnl_percent || 0,
      ],
    });
  }
}

/**
 * Factory function to create position synchronizer
 */
export function createPositionSynchronizer(
  exchangeClient: IExchangeClient,
  database: Client
): PositionSynchronizer {
  return new PositionSynchronizer(exchangeClient, database);
}
