/**
 * Centralized PnL Calculation Utility
 *
 * This module provides consistent, accurate P&L calculation methods
 * used throughout the trading system. All P&L calculations should
 * use these utilities to ensure consistency across:
 * - Manual position closes
 * - SL/TP/drawdown triggers
 * - AI learning system
 * - Account management tools
 * - Risk management
 */

import { createPinoLogger } from "@voltagent/logger";
import { getQuantoMultiplier } from "./contractUtils";

const logger = createPinoLogger({
  name: "pnl-calculator",
  level: "info",
});

export interface PositionData {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
}

export interface PnLResult {
  grossPnl: number;          // Raw P&L without fees
  netPnl: number;            // P&L after trading fees
  priceChange: number;       // Price change per unit
  priceChangePercent: number; // Percentage change
  entryNotional: number;     // Total entry value (USDT)
  exitNotional: number;      // Total exit value (USDT)
  totalFees: number;         // Combined entry + exit fees
  pnlPercent: number;        // Return percentage
}

export interface FeeConfig {
  makerFee?: number;         // Maker fee rate (default: 0.0002)
  takerFee?: number;         // Taker fee rate (default: 0.0005)
  feeType?: 'percentage' | 'fixed'; // Fee calculation type
}

/**
 * Default fee configuration (Binance Futures rates)
 */
const DEFAULT_FEE_CONFIG: FeeConfig = {
  makerFee: 0.0002,   // 0.02%
  takerFee: 0.0005,   // 0.05%
  feeType: 'percentage',
};

/**
 * Calculate comprehensive P&L for a position
 *
 * @param position - Position data
 * @param feeConfig - Fee configuration (optional)
 * @param useTakerFee - Use taker fee by default (market orders)
 * @returns Detailed P&L calculation result
 */
export async function calculatePnL(
  position: PositionData,
  feeConfig: FeeConfig = DEFAULT_FEE_CONFIG,
  useTakerFee: boolean = true
): Promise<PnLResult> {
  const { symbol, side, entryPrice, exitPrice, quantity, leverage } = position;

  // Get contract multiplier (quanto)
  const contract = `${symbol}_USDT`;
  const quantoMultiplier = await getQuantoMultiplier(contract);

  // Calculate price change
  const priceChange = side === 'long'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  // Calculate notional values
  const entryNotional = entryPrice * quantity * quantoMultiplier;
  const exitNotional = exitPrice * quantity * quantoMultiplier;

  // Calculate fees
  const feeRate = useTakerFee ? (feeConfig.takerFee || DEFAULT_FEE_CONFIG.takerFee!)
                             : (feeConfig.makerFee || DEFAULT_FEE_CONFIG.makerFee!);
  const entryFee = entryNotional * feeRate;
  const exitFee = exitNotional * feeRate;
  const totalFees = entryFee + exitFee;

  // Calculate P&L
  const grossPnl = priceChange * quantity * quantoMultiplier;
  const netPnl = grossPnl - totalFees;

  // Calculate percentage returns
  const priceChangePercent = (priceChange / entryPrice) * 100;
  const pnlPercent = (netPnl / entryNotional) * 100;

  logger.debug(`P&L calculated for ${symbol} ${side}:`, {
    symbol,
    side,
    entryPrice,
    exitPrice,
    quantity,
    leverage,
    quantoMultiplier,
    priceChange,
    grossPnl,
    totalFees,
    netPnl,
    pnlPercent,
  });

  return {
    grossPnl,
    netPnl,
    priceChange,
    priceChangePercent,
    entryNotional,
    exitNotional,
    totalFees,
    pnlPercent,
  };
}

/**
 * Calculate simple P&L (without fees) for quick calculations
 *
 * @param position - Position data
 * @returns Simple P&L calculation
 */
export async function calculateSimplePnL(
  position: Pick<PositionData, 'symbol' | 'side' | 'entryPrice' | 'exitPrice' | 'quantity'>
): Promise<number> {
  const { symbol, side, entryPrice, exitPrice, quantity } = position;

  // Get contract multiplier (quanto)
  const contract = `${symbol}_USDT`;
  const quantoMultiplier = await getQuantoMultiplier(contract);

  // Calculate price change and P&L
  const priceChange = side === 'long'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  return priceChange * quantity * quantoMultiplier;
}

/**
 * Calculate leverage-adjusted P&L percentage
 * This is the percentage that considers leverage effect
 *
 * @param priceChangePercent - Raw price change percentage
 * @param leverage - Leverage multiplier
 * @returns Leverage-adjusted P&L percentage
 */
export function calculateLeverageAdjustedPnLPercent(
  priceChangePercent: number,
  leverage: number
): number {
  return priceChangePercent * leverage;
}

/**
 * Calculate unrealized P&L for current positions
 *
 * @param position - Current position data
 * @param currentPrice - Current market price
 * @param feeConfig - Fee configuration
 * @returns P&L result for unrealized position
 */
export async function calculateUnrealizedPnL(
  position: Omit<PositionData, 'exitPrice'> & { currentPrice: number },
  feeConfig: FeeConfig = DEFAULT_FEE_CONFIG
): Promise<PnLResult> {
  const { currentPrice, ...positionData } = position;

  return calculatePnL(
    {
      ...positionData,
      exitPrice: currentPrice,
    },
    feeConfig,
    false // Use maker fee for unrealized calculations
  );
}

/**
 * Validate P&L calculation inputs
 *
 * @param position - Position data to validate
 * @throws Error if invalid data
 */
export function validatePositionData(position: Partial<PositionData>): void {
  if (!position.symbol || typeof position.symbol !== 'string') {
    throw new Error('Invalid symbol: must be a non-empty string');
  }

  if (!['long', 'short'].includes(position.side!)) {
    throw new Error('Invalid side: must be "long" or "short"');
  }

  if (typeof position.entryPrice !== 'number' || position.entryPrice <= 0) {
    throw new Error('Invalid entryPrice: must be a positive number');
  }

  if (typeof position.exitPrice !== 'number' || position.exitPrice <= 0) {
    throw new Error('Invalid exitPrice: must be a positive number');
  }

  if (typeof position.quantity !== 'number' || position.quantity <= 0) {
    throw new Error('Invalid quantity: must be a positive number');
  }

  if (typeof position.leverage !== 'number' || position.leverage < 1) {
    throw new Error('Invalid leverage: must be a positive number >= 1');
  }
}

/**
 * Get P&L statistics for multiple trades
 *
 * @param trades - Array of P&L results
 * @returns P&L statistics
 */
export function calculatePnLStats(trades: PnLResult[]): {
  totalGrossPnl: number;
  totalNetPnl: number;
  totalFees: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
} {
  const winningTrades = trades.filter(t => t.netPnl > 0);
  const losingTrades = trades.filter(t => t.netPnl < 0);

  const totalGrossPnl = trades.reduce((sum, t) => sum + t.grossPnl, 0);
  const totalNetPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.totalFees, 0);

  const winCount = winningTrades.length;
  const lossCount = losingTrades.length;
  const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;

  const averageWin = winCount > 0
    ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winCount
    : 0;

  const averageLoss = lossCount > 0
    ? losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / lossCount
    : 0;

  const profitFactor = averageLoss < 0
    ? Math.abs(averageWin * winCount / (averageLoss * lossCount))
    : 0;

  return {
    totalGrossPnl,
    totalNetPnl,
    totalFees,
    winCount,
    lossCount,
    winRate,
    averageWin,
    averageLoss,
    profitFactor,
  };
}