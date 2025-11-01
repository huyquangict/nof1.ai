/**
 * Decision Parser - Extracts and executes trading decisions from LLM text
 * Fallback for when LLM doesn't use tools properly
 */

import { createExchangeClient } from '../services/exchange/ExchangeFactory';
import { createPinoLogger } from '@voltagent/logger';
import { dbClient } from '../db/client';

const logger = createPinoLogger({ name: 'decision-parser' });

interface ParsedDecision {
  action: 'open' | 'close';
  symbol: string;
  side?: 'long' | 'short';
  amount?: number;
  leverage?: number;
  reason: string;
}

/**
 * Parse trading decisions from LLM text output
 */
export function parseDecisions(text: string): ParsedDecision[] {
  const decisions: ParsedDecision[] = [];

  // Normalize text
  const normalizedText = text.toLowerCase();

  // Pattern 1: Look for explicit decision statements
  // "open LTC long at 15x leverage with 10 USDT"
  // "close BTC position"

  const symbols = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'bch', 'doge', 'ltc', 'hbar'];

  for (const symbol of symbols) {
    // Check for OPEN decisions
    const openPatterns = [
      // "open LTC long at 15x leverage with 10 USDT"
      new RegExp(`open\\s+${symbol}\\s+(long|short)\\s+(?:at\\s+)?(\\d+)x?\\s+leverage\\s+(?:with\\s+)?(\\d+(?:\\.\\d+)?)\\s+usdt`, 'gi'),
      // "LTC LONG: 10 USDT at 15x leverage"
      new RegExp(`${symbol}\\s+(long|short):\\s+(\\d+(?:\\.\\d+)?)\\s+usdt\\s+at\\s+(\\d+)x`, 'gi'),
      // "Execute LTC long position: Amount 10 USDT, Leverage 15x"
      new RegExp(`execute\\s+${symbol}\\s+(long|short).*?amount\\s+(\\d+(?:\\.\\d+)?)\\s+usdt.*?leverage\\s+(\\d+)x`, 'gi'),
      // More flexible: "LTC long 10 USDT 15x"
      new RegExp(`${symbol}\\s+(long|short)\\s+(\\d+(?:\\.\\d+)?)\\s+usdt\\s+(\\d+)x`, 'gi'),
    ];

    for (const pattern of openPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const side = match[1] as 'long' | 'short';
        // Different patterns have different capture group orders
        let amount: number, leverage: number;

        if (pattern.source.includes('open\\s+')) {
          // Pattern 1: open LTC long at 15x with 10 USDT
          leverage = parseInt(match[2]);
          amount = parseFloat(match[3]);
        } else if (pattern.source.includes(':\\s+')) {
          // Pattern 2: LTC LONG: 10 USDT at 15x
          amount = parseFloat(match[2]);
          leverage = parseInt(match[3]);
        } else if (pattern.source.includes('execute')) {
          // Pattern 3: Execute LTC long Amount 10 USDT Leverage 15x
          amount = parseFloat(match[2]);
          leverage = parseInt(match[3]);
        } else {
          // Pattern 4: LTC long 10 USDT 15x
          amount = parseFloat(match[2]);
          leverage = parseInt(match[3]);
        }

        decisions.push({
          action: 'open',
          symbol: symbol.toUpperCase(),
          side,
          amount,
          leverage,
          reason: match[0],
        });

        logger.info(`Parsed OPEN decision: ${symbol.toUpperCase()} ${side} ${amount} USDT at ${leverage}x`);
      }
    }

    // Check for CLOSE decisions
    const closePatterns = [
      new RegExp(`close\\s+${symbol}\\s+(long|short)?\\s*position`, 'gi'),
      new RegExp(`${symbol}\\s+close`, 'gi'),
      new RegExp(`exit\\s+${symbol}`, 'gi'),
    ];

    for (const pattern of closePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push({
          action: 'close',
          symbol: symbol.toUpperCase(),
          reason: match[0],
        });

        logger.info(`Parsed CLOSE decision: ${symbol.toUpperCase()}`);
      }
    }
  }

  return decisions;
}

/**
 * Execute parsed decisions
 */
export async function executeDecisions(decisions: ParsedDecision[]): Promise<void> {
  if (decisions.length === 0) {
    logger.info('No decisions to execute');
    return;
  }

  const exchangeClient = createExchangeClient();

  for (const decision of decisions) {
    try {
      if (decision.action === 'open' && decision.side && decision.amount && decision.leverage) {
        logger.info(`Executing OPEN: ${decision.symbol} ${decision.side} ${decision.amount} USDT at ${decision.leverage}x`);

        // Get current price
        const ticker = await exchangeClient.getFuturesTicker(decision.symbol);
        const currentPrice = ticker.lastPrice;

        // Get market info for precision
        const markets = await exchangeClient.getMarkets();
        const market = markets.find(m => m.symbol === `${decision.symbol}/USDT`);

        if (!market) {
          logger.error(`Market not found for ${decision.symbol}`);
          continue;
        }

        // Calculate quantity with proper precision
        const positionValue = decision.amount * decision.leverage;
        const rawQuantity = positionValue / currentPrice;

        // Get step size from market info
        const stepSize = market.info?.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize || 0.001;
        const stepSizeFloat = parseFloat(stepSize);

        // Round to step size
        const quantity = Math.floor(rawQuantity / stepSizeFloat) * stepSizeFloat;

        // Validate minimum quantity
        const minQty = market.limits?.amount?.min || 0.001;
        if (quantity < minQty) {
          logger.error(`Quantity ${quantity} below minimum ${minQty} for ${decision.symbol}`);
          continue;
        }

        // Validate minimum notional
        const notional = quantity * currentPrice;
        const minNotional = market.limits?.cost?.min || 5;
        if (notional < minNotional) {
          logger.error(`Notional ${notional} below minimum ${minNotional} for ${decision.symbol}`);
          continue;
        }

        logger.info(`Opening position: ${decision.symbol} ${decision.side} ${quantity} units at ${currentPrice} (${notional.toFixed(2)} USDT)`);

        // Set leverage
        await exchangeClient.setLeverage(decision.symbol, decision.leverage);

        // Open position
        const order = await exchangeClient.openPosition(
          decision.symbol,
          decision.side,
          quantity,
          currentPrice
        );

        logger.info(`✅ Position opened successfully: ${JSON.stringify(order)}`);

        // Save to database
        await dbClient.execute({
          sql: `INSERT INTO positions
                (symbol, side, quantity, entry_price, current_price, leverage, opened_at, unrealized_pnl)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            decision.symbol,
            decision.side,
            quantity,
            currentPrice,
            currentPrice,
            decision.leverage,
            new Date().toISOString(),
            0,
          ],
        });

        // Record trade
        await dbClient.execute({
          sql: `INSERT INTO trades
                (symbol, type, side, price, quantity, leverage, fee, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            decision.symbol,
            'open',
            decision.side,
            currentPrice,
            quantity,
            decision.leverage,
            notional * 0.0005, // Assume 0.05% fee
            new Date().toISOString(),
          ],
        });

      } else if (decision.action === 'close') {
        logger.info(`Executing CLOSE: ${decision.symbol}`);

        // Get position from database
        const positionResult = await dbClient.execute({
          sql: 'SELECT * FROM positions WHERE symbol = ? LIMIT 1',
          args: [decision.symbol],
        });

        if (!positionResult.rows.length) {
          logger.warn(`No position found for ${decision.symbol}`);
          continue;
        }

        const position: any = positionResult.rows[0];

        // Get current price
        const ticker = await exchangeClient.getFuturesTicker(decision.symbol);
        const currentPrice = ticker.lastPrice;

        // Close position
        await exchangeClient.closePosition(
          decision.symbol,
          position.side,
          position.quantity,
          currentPrice
        );

        // Calculate P&L
        const priceChange = position.side === 'long'
          ? currentPrice - position.entry_price
          : position.entry_price - currentPrice;
        const pnl = priceChange * position.quantity;

        logger.info(`✅ Position closed successfully: ${decision.symbol} P&L: ${pnl.toFixed(2)} USDT`);

        // Update database
        await dbClient.execute({
          sql: 'DELETE FROM positions WHERE symbol = ?',
          args: [decision.symbol],
        });

        // Record trade
        const notional = position.quantity * currentPrice;
        await dbClient.execute({
          sql: `INSERT INTO trades
                (symbol, type, side, price, quantity, leverage, fee, pnl, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            decision.symbol,
            'close',
            position.side,
            currentPrice,
            position.quantity,
            position.leverage,
            notional * 0.0005,
            pnl,
            new Date().toISOString(),
          ],
        });
      }

    } catch (error: any) {
      logger.error(`Failed to execute decision for ${decision.symbol}: ${error.message}`);
      logger.error(error);
    }
  }
}
