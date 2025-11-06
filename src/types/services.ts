/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 */

/**
 * Service Layer Type Definitions
 *
 * Types for service layer parameters and results.
 */

import type { Position, Trade } from '../database/schema';

// ============================================================================
// Position Service Types
// ============================================================================

export interface OpenPositionParams {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  leverage: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  confidence?: number;
  riskUsd?: number;
}

export interface OpenPositionResult {
  success: boolean;
  position?: Position;
  order?: {
    orderId: string;
    symbol: string;
    side: 'long' | 'short';
    price: number;
    quantity: number;
  };
  stopLoss?: {
    orderId: string;
    price: number;
    percentage: number;
  };
  error?: string;
  message: string;
}

export interface ClosePositionParams {
  symbol: string;
  reason: 'manual' | 'stop_loss' | 'take_profit' | 'take_profit_partial' | 'time_limit' | 'drawdown';
  partialQuantity?: number;
}

export interface ClosePositionResult {
  success: boolean;
  trade?: Trade;
  order?: {
    orderId: string;
    symbol: string;
    side: 'long' | 'short';
    price: number;
    quantity: number;
  };
  pnl?: {
    amount: number;
    percentage: number;
  };
  error?: string;
  message: string;
}

export interface UpdateStopLossParams {
  symbol: string;
  newStopLossPercent: number;
  reason?: string;
}

export interface UpdateTakeProfitParams {
  symbol: string;
  takeProfitOrders: Array<{
    price: number;
    quantity: number;
  }>;
  reason?: string;
}

// ============================================================================
// Order Service Types
// ============================================================================

export interface PlaceOrderParams {
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}

export interface PlaceOrderResult {
  success: boolean;
  orderId?: string;
  price?: number;
  quantity?: number;
  error?: string;
  message: string;
}

export interface CancelOrderParams {
  symbol: string;
  orderId: string;
}

export interface CancelOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  message: string;
}

export interface SetStopLossOrderParams {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  stopLossPrice: number;
  entryPrice: number;
}

export interface SetStopLossOrderResult {
  success: boolean;
  orderId?: string;
  stopLossPrice?: number;
  error?: string;
  message: string;
}

// ============================================================================
// Risk Service Types
// ============================================================================

export interface RiskCheckParams {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  leverage: number;
  entryPrice: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reasons: string[];
  riskMetrics: {
    positionSizeUsd: number;
    accountBalance: number;
    positionSizePercent: number;
    maxLeverage: number;
    currentPositionCount: number;
    maxPositions: number;
    accountDrawdownPercent: number;
  };
}

export interface PositionRiskMetrics {
  symbol: string;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  peakPnlPercent: number;
  currentPrice: number;
  entryPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  holdingTimeHours: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  shouldClose: boolean;
  closeReason?: string;
}

export interface AccountRiskMetrics {
  totalValue: number;
  availableCash: number;
  unrealizedPnl: number;
  realizedPnl: number;
  returnPercent: number;
  drawdownPercent: number;
  positionCount: number;
  leverageUtilization: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

// ============================================================================
// Account Service Types
// ============================================================================

export interface AccountBalance {
  totalValue: number;
  availableCash: number;
  unrealizedPnl: number;
  usedMargin: number;
  freeMargin: number;
}

export interface AccountSnapshot {
  timestamp: string;
  totalValue: number;
  availableCash: number;
  unrealizedPnl: number;
  realizedPnl: number;
  returnPercent: number;
  sharpeRatio?: number;
}

// ============================================================================
// Market Data Service Types
// ============================================================================

export interface MarketDataParams {
  symbol: string;
  timeframe?: string;
  limit?: number;
}

export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  fundingRate?: number;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  symbol: string;
  timeframe: string;
  ema20: number;
  ema50: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  rsi7: number;
  rsi14: number;
  atr: number;
  volume: number;
}

// ============================================================================
// Sync Service Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  syncedPositions: number;
  syncedOrders: number;
  errors: string[];
  message: string;
}

export interface PositionSyncResult {
  symbol: string;
  synced: boolean;
  changes?: {
    quantity?: { old: number; new: number };
    price?: { old: number; new: number };
    pnl?: { old: number; new: number };
  };
  error?: string;
}
