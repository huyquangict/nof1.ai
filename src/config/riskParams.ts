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
 * 基础风险参数配置（从环境变量读取，支持灵活配置）
 */

// 从环境变量读取交易symbol列表（逗号分隔）
const DEFAULT_TRADING_SYMBOLS = 'BTC,ETH,SOL,XRP,BNB,BCH,DOGE,LTC,HBAR,ASTER';
const tradingSymbolsStr = process.env.TRADING_SYMBOLS || DEFAULT_TRADING_SYMBOLS;
const tradingSymbols = tradingSymbolsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

// 从环境变量读取配置，提供默认值
export const RISK_PARAMS = {
  // max positions数
  MAX_POSITIONS: Number.parseInt(process.env.MAX_POSITIONS || '5', 10),
  
  // 最大leverage multiplier
  MAX_LEVERAGE: Number.parseInt(process.env.MAX_LEVERAGE || '15', 10),
  
  // 交易symbol列表（作为元组以支持 zod.enum）
  TRADING_SYMBOLS: tradingSymbols as [string, ...string[]],
  
  // max positions小时数
  MAX_HOLDING_HOURS: Number.parseInt(process.env.MAX_HOLDING_HOURS || '36', 10),
  
  // max positions周期数（根据position小时数自动计算：小时数 * 6，因为每10分钟一个周期）
  get MAX_HOLDING_CYCLES() {
    return this.MAX_HOLDING_HOURS * 6;
  },
  
  // accountdrawdownrisk control阈值
  // 禁止newopen position的drawdown阈值（达到此阈值时，只允许close position不允许open position）
  ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT || '15', 10),
  
  // 强制close position的drawdown阈值（达到此阈值时，立即close position所有position并stop交易）
  ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT || '20', 10),
  
  // warning提醒的drawdown阈值（达到此阈值时，提醒谨慎交易）
  ACCOUNT_DRAWDOWN_WARNING_PERCENT: Number.parseInt(process.env.ACCOUNT_DRAWDOWN_WARNING_PERCENT || '10', 10),
} as const;

