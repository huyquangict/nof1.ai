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
 * Contract utility functions
 */
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "contract-utils",
  level: "info",
});

// Contract multiplier cache (avoid duplicate API calls)
const quantoMultiplierCache = new Map<string, number>();

/**
 * Default contract multiplier mapping
 * Used when fetching from exchange API fails
 */
const DEFAULT_MULTIPLIERS: Record<string, number> = {
  // USDT-margined perpetual contracts: 1 contract = 1 coin (1:1 ratio)
  'BTC': 1,       // 1 contract = 1 BTC
  'ETH': 1,       // 1 contract = 1 ETH
  'SOL': 1,       // 1 contract = 1 SOL
  'XRP': 1,       // 1 contract = 1 XRP
  'BNB': 1,       // 1 contract = 1 BNB
  'BCH': 1,       // 1 contract = 1 BCH
  'DOGE': 1,      // 1 contract = 1 DOGE
  'LTC': 1,       // 1 contract = 1 LTC
  'HBAR': 1,      // 1 contract = 1 HBAR
  'POL': 1,       // 1 contract = 1 POL
  'ASTER': 1,     // 1 contract = 1 ASTER
};

/**
 * Get contract multiplier (quanto multiplier)
 * 
 * contract multiplier represents: 1 contracts contract represents how many coins
 * for example: BTC_USDT contract, 1 contracts = 0.0001 BTC
 *
 * priority from exchange API fetch, use default value when failed
 * support caching to reduce API call quantity
 * 
 * @param contract contract name, such as "BTC_USDT"
 * @param useCache whether to use cache (default true)
 * @returns contract multiplier
 */
export async function getQuantoMultiplier(
  contract: string,
  useCache: boolean = true
): Promise<number> {
  // check cache
  if (useCache && quantoMultiplierCache.has(contract)) {
    const cached = quantoMultiplierCache.get(contract)!;
    logger.debug(`use cache  ${contract} contract multiplier: ${cached}`);
    return cached;
  }

  // Binance uses 1:1 ratio (1 contract = 1 coin)
  const symbol = contract.replace("_USDT", "");
  const multiplier = DEFAULT_MULTIPLIERS[symbol] || 1;
  logger.debug(`${contract} contract multiplier: ${multiplier} (1:1 ratio)`);

  // Cache result
  if (useCache) {
    quantoMultiplierCache.set(contract, multiplier);
  }

  return multiplier;
}

/**
 * clear cache (for testing or forced refresh)
 */
export function clearQuantoMultiplierCache(contract?: string) {
  if (contract) {
    quantoMultiplierCache.delete(contract);
    logger.debug(`clear ${contract} contract multiplier cache`);
  } else {
    quantoMultiplierCache.clear();
    logger.debug(`clear all contract multiplier cache`);
  }
}

/**
 * preload common contracts multipliers (optional, for warming cache at start)
 */
export async function preloadQuantoMultipliers(contracts: string[]): Promise<void> {
  logger.info(`preloading ${contracts.length} contract multipliers...`);
  
  const results = await Promise.allSettled(
    contracts.map(contract => getQuantoMultiplier(contract, true))
  );
  
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  logger.info(`successfully preloaded ${successCount}/${contracts.length} contract multiplier`);
}

