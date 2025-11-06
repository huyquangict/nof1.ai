/**
 * open-nof1.ai - AI 加密货币自动交易系统
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
 * 合约工具函数
 */
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "contract-utils",
  level: "info",
});

// 合约乘数缓存（避免重复API调用）
const quantoMultiplierCache = new Map<string, number>();

/**
 * 默认合约乘数映射
 * 从交易所 API 获取失败时使用
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
 * 获取合约乘数（quanto multiplier）
 * 
 * 合约乘数表示：1张合约代表多少个币
 * 例如：BTC_USDT合约，1张 = 0.0001 BTC
 *
 * 优先从交易所 API 获取，失败时使用默认值
 * 支持缓存以减少API调用次数
 * 
 * @param contract 合约名称，如 "BTC_USDT"
 * @param useCache 是否使用缓存（默认true）
 * @returns 合约乘数
 */
export async function getQuantoMultiplier(
  contract: string,
  useCache: boolean = true
): Promise<number> {
  // 检查缓存
  if (useCache && quantoMultiplierCache.has(contract)) {
    const cached = quantoMultiplierCache.get(contract)!;
    logger.debug(`使用缓存的 ${contract} 合约乘数: ${cached}`);
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
 * 清除缓存（用于测试或强制刷新）
 */
export function clearQuantoMultiplierCache(contract?: string) {
  if (contract) {
    quantoMultiplierCache.delete(contract);
    logger.debug(`清除 ${contract} 合约乘数缓存`);
  } else {
    quantoMultiplierCache.clear();
    logger.debug(`清除所有合约乘数缓存`);
  }
}

/**
 * 预加载常用合约的乘数（可选，用于启动时预热缓存）
 */
export async function preloadQuantoMultipliers(contracts: string[]): Promise<void> {
  logger.info(`预加载 ${contracts.length} 个合约的乘数...`);
  
  const results = await Promise.allSettled(
    contracts.map(contract => getQuantoMultiplier(contract, true))
  );
  
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  logger.info(`成功预加载 ${successCount}/${contracts.length} 个合约乘数`);
}

