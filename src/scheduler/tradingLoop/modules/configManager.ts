/**
 * Config Manager Module
 * Handles trading configuration persistence
 */

import { createPinoLogger } from "@voltagent/logger";
import type { Client } from "@libsql/client";
import { getChinaTimeISO } from "../../../utils/timeUtils";

const logger = createPinoLogger({
  name: "config-manager",
  level: "info",
});

export interface AccountRiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
  syncOnStartup?: boolean;
}

/**
 * Config manager class - handles configuration persistence
 */
export class ConfigManager {
  constructor(
    private database: Client,
    private getRiskConfig: () => AccountRiskConfig
  ) {}

  /**
   * Sync risk configuration to database
   */
  async syncConfigToDatabase(): Promise<void> {
    try {
      const config = this.getRiskConfig();
      const timestamp = getChinaTimeISO();

      // Update or insert configuration
      await this.database.execute({
        sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
        args: ['account_stop_loss_usdt', config.stopLossUsdt.toString(), timestamp],
      });

      await this.database.execute({
        sql: `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
        args: ['account_take_profit_usdt', config.takeProfitUsdt.toString(), timestamp],
      });

      logger.info(
        `Configuration synced to database: stop loss=${config.stopLossUsdt} USDT, take profit=${config.takeProfitUsdt} USDT`
      );
    } catch (error) {
      logger.error("Failed to sync configuration to database:", error as any);
    }
  }

  /**
   * Load risk configuration from database
   * Returns the loaded config or null if not found
   */
  async loadConfigFromDatabase(): Promise<AccountRiskConfig | null> {
    try {
      const stopLossResult = await this.database.execute({
        sql: `SELECT value FROM system_config WHERE key = ?`,
        args: ['account_stop_loss_usdt'],
      });

      const takeProfitResult = await this.database.execute({
        sql: `SELECT value FROM system_config WHERE key = ?`,
        args: ['account_take_profit_usdt'],
      });

      if (stopLossResult.rows.length > 0 && takeProfitResult.rows.length > 0) {
        const config: AccountRiskConfig = {
          stopLossUsdt: Number.parseFloat(stopLossResult.rows[0].value as string),
          takeProfitUsdt: Number.parseFloat(takeProfitResult.rows[0].value as string),
        };

        logger.info(
          `Configuration loaded from database: stop loss=${config.stopLossUsdt} USDT, take profit=${config.takeProfitUsdt} USDT`
        );

        return config;
      }

      return null;
    } catch (error) {
      logger.warn(
        "Failed to load configuration from database, using environment variable configuration:",
        error as any
      );
      return null;
    }
  }

  /**
   * Get current risk configuration
   */
  getAccountRiskConfig(): AccountRiskConfig {
    return this.getRiskConfig();
  }
}

/**
 * Factory function to create config manager
 */
export function createConfigManager(
  database: Client,
  getRiskConfig: () => AccountRiskConfig
): ConfigManager {
  return new ConfigManager(database, getRiskConfig);
}
