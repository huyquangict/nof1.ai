# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

open-nof1.ai is an AI-powered cryptocurrency automated trading system built on the VoltAgent framework. It features AI-driven decision-making for perpetual futures trading on multiple exchanges (currently Gate.io, with Binance support in development), supporting both testnet and mainnet environments.

**Key Technologies:**
- Framework: VoltAgent (AI agent orchestration)
- AI Provider: OpenAI-compatible APIs (OpenRouter, DeepSeek, Claude, etc.)
- Exchange: Multi-exchange support via abstraction layer (Gate.io ✅, Binance 🔜)
- Database: LibSQL/SQLite for local persistence
- Runtime: Node.js 20+ with TypeScript

## Essential Commands

### Development and Testing
```bash
# Development mode with hot reload
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build

# Run production build
npm start
```

### Trading System Operations
```bash
# Start trading system (foreground)
npm run trading:start

# Stop trading system
npm run trading:stop

# Restart trading system
npm run trading:restart
```

### Database Operations
```bash
# Initialize database schema
npm run db:init

# Reset database (clear all data)
npm run db:reset

# Sync data from Gate.io
npm run db:sync

# Sync only position data
npm run db:sync-positions

# Check database consistency
npm run db:check-consistency
```

### Process Management (PM2)
```bash
# Start as daemon process
npm run pm2:start

# View real-time logs
npm run pm2:logs

# Monitor processes
npm run pm2:monit

# Restart process
npm run pm2:restart

# Stop process
npm run pm2:stop
```

### Docker Operations
```bash
# Quick start container
npm run docker:start

# Stop container
npm run docker:stop

# View container logs
npm run docker:logs

# Build Docker image
npm run docker:build
```

## Architecture Overview

### Core System Flow

1. **Trading Loop** (`src/scheduler/tradingLoop.ts`):
   - Executes at configurable intervals (default: 5 minutes)
   - Collects multi-timeframe market data (1m, 3m, 5m, 15m, 30m, 1h)
   - Fetches account information and positions
   - **Performs mandatory risk checks BEFORE AI execution** (36-hour limit, stop-loss, trailing take-profit, drawdown protection)
   - Generates comprehensive prompt with market data, positions, and account info
   - Invokes trading agent for decision-making
   - Executes trades via trading tools
   - Records decisions and updates database

2. **Trading Agent** (`src/agents/tradingAgent.ts`):
   - Configurable strategies: conservative, balanced, aggressive
   - Dynamic leverage and position sizing based on signal strength
   - Multi-timeframe analysis (5m, 15m, 1h, 4h)
   - Risk management with trailing stops and position limits
   - Detailed prompts include all market data to minimize tool calls

3. **Exchange Abstraction Layer** (`src/services/exchange/`) - **NEW**:
   - `IExchangeClient`: Common interface for all exchanges
   - `GateAdapter`: Gate.io implementation (wraps existing GateClient)
   - `BinanceAdapter`: Binance support (Phase 3, using CCXT)
   - `ExchangeFactory`: Singleton factory for creating exchange clients
   - Standardized data types: Ticker, Candle, Position, Order, etc.
   - Symbol normalization: `BTC` ↔ `BTC_USDT` (Gate) or `BTC/USDT:USDT` (Binance)

4. **Exchange Client** (`src/services/gateClient.ts` + adapters):
   - Singleton pattern for API client (via ExchangeFactory)
   - Automatic retry logic for failed requests
   - Testnet/mainnet switching via environment variable
   - Order placement with validation and adjustment
   - Position and account management
   - **Note**: Direct use of `createGateClient()` is being phased out in favor of `createExchangeClient()`

5. **Trading Tools** (`src/tools/trading/`):
   - `openPosition`: Opens long/short positions (market orders only)
   - `closePosition`: Closes existing positions
   - `getAccountBalance`: Retrieves account information
   - `getPositions`: Fetches current positions
   - `getTechnicalIndicators`: Calculates EMA, MACD, RSI
   - `getFundingRate`: Gets perpetual contract funding rate
   - Additional tools for order management and risk calculation

### Database Schema (`src/database/schema.ts`)

Key tables:
- `trades`: Complete trade history (open/close, with PnL calculation)
- `positions`: Current active positions with entry, stop-loss, take-profit
- `account_history`: Historical account value snapshots
- `trading_signals`: Technical indicator records per symbol
- `agent_decisions`: AI decision logs for analysis
- `system_config`: Dynamic configuration storage

### Risk Management System

**Multiple layers of protection:**

1. **Position-Level Controls** (enforced BEFORE AI execution):
   - 36-hour maximum holding period (hard limit)
   - Dynamic stop-loss based on strategy and leverage
   - Trailing take-profit (locks in profits at +8%, +15%, +25% levels)
   - Peak drawdown protection (30% retracement from peak triggers close)

2. **Account-Level Controls**:
   - Drawdown warnings at 10% (from peak or initial balance)
   - New position blocking at 15% drawdown
   - Forced liquidation at 20% drawdown
   - Configurable stop-loss/take-profit thresholds in USDT

3. **Position Limits**:
   - Maximum simultaneous positions: 5 (configurable via `MAX_POSITIONS`)
   - No dual-direction positions on same symbol
   - Maximum leverage: configurable via `MAX_LEVERAGE` env variable
   - Position sizing: 15-32% of account value depending on strategy

## Configuration

### Critical Environment Variables

```bash
# Server
PORT=3141

# Trading Parameters
TRADING_INTERVAL_MINUTES=5
MAX_LEVERAGE=15                          # Maximum leverage multiplier
MAX_POSITIONS=5                          # Maximum simultaneous positions
INITIAL_BALANCE=2000

# Database
DATABASE_URL=file:./.voltagent/trading.db

# Exchange Selection (NEW - Multi-exchange support)
EXCHANGE=gateio                          # Options: gateio, binance (Phase 3)
USE_TESTNET=true                         # Unified testnet flag (recommended)

# Gate.io API
GATE_API_KEY=your_api_key
GATE_API_SECRET=your_api_secret
GATE_USE_TESTNET=true                    # Backward compatible (deprecated, use USE_TESTNET)

# Binance API (Phase 3 - Coming Soon)
# BINANCE_API_KEY=your_api_key
# BINANCE_API_SECRET=your_api_secret
# BINANCE_MARGIN_MODE=isolated           # Options: isolated, cross
# BINANCE_POSITION_MODE=oneway           # Options: oneway, hedge

# AI Model
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL_NAME=deepseek/deepseek-v3.2-exp

# Trading Strategy (conservative/balanced/aggressive)
TRADING_STRATEGY=balanced

# Risk Controls
ACCOUNT_DRAWDOWN_WARNING_PERCENT=10       # Warning threshold
ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT=15  # Block new positions
ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT=20   # Force close all positions
ACCOUNT_STOP_LOSS_USDT=50                 # Account-level stop loss
ACCOUNT_TAKE_PROFIT_USDT=10000            # Account-level take profit

# Supported Trading Symbols (comma-separated)
TRADING_SYMBOLS=BTC,ETH,SOL,XRP,BNB,BCH
```

### Strategy Configuration

Three built-in strategies with dynamic parameters based on `MAX_LEVERAGE`:

1. **Conservative**: 30-60% of max leverage, 15-22% position size, -3.5% to -2.5% stop-loss
2. **Balanced**: 60-85% of max leverage, 20-27% position size, -3% to -2% stop-loss
3. **Aggressive**: 85-100% of max leverage, 25-32% position size, -2.5% to -1.5% stop-loss

Strategy parameters auto-adjust when `MAX_LEVERAGE` changes.

## Important Implementation Details

### PnL Calculation with Leverage

The system uses **leveraged PnL percentage** throughout:
- Formula: `pnl_percent = (price_change_percent) × leverage`
- Example: 10x leverage, +0.5% price move = +5% PnL
- All stop-loss and take-profit thresholds use this leveraged percentage
- The `pnl_percent` field in positions table already includes leverage effect

### Position Management Rules

1. **No Dual-Direction Positions**: Cannot hold both long and short on same symbol
2. **Trend Reversal Protocol**: Must close existing position before opening opposite direction
3. **Add-to-Position**: Allowed when position is profitable and trend strengthens (max 2 additions, each ≤50% of original)
4. **36-Hour Maximum**: All positions automatically closed after 36 hours regardless of profit/loss

### Forced Risk Checks (Pre-AI Execution)

In `tradingLoop.ts`, BEFORE the AI agent runs:
1. Check all positions for 36-hour limit
2. Apply dynamic stop-loss based on strategy and leverage
3. Check trailing take-profit levels (+8%, +15%, +25%)
4. Verify peak drawdown protection (30% retracement)
5. Force close positions that violate any rule

This prevents the AI from ignoring risk management rules.

### Quanto Contract Multipliers

Some contracts use quanto multipliers (e.g., BNB, BCH use coin-based settlement):
- Standard USDT contracts: multiplier = 1
- Quanto contracts: Check via `getQuantoMultiplier()` in `utils/contractUtils.ts`
- PnL calculation: `(price_change) × quantity × quanto_multiplier`
- Always use multiplier in fee and PnL calculations

### Market Data Collection

Multi-timeframe candlestick data:
- 1m, 3m, 5m: Short-term signals
- 15m, 30m: Medium-term trends
- 1h: Long-term context

Technical indicators calculated per timeframe:
- EMA (20, 50 periods)
- MACD (12, 26, 9 parameters)
- RSI (7, 14 periods)
- Volume analysis
- ATR (for volatility)

### Prompt Engineering Strategy

The system generates comprehensive prompts in `generateTradingPrompt()`:
- Includes ALL technical indicators for all timeframes
- Provides complete account state and positions
- Shows recent trade history (last 10 trades)
- Includes previous AI decisions for continuity
- Format follows reference document `1.md` style

This minimizes tool calls during agent execution and ensures complete context.

## Testing and Deployment

### Always Start with Testnet

```bash
# Set in .env
GATE_USE_TESTNET=true
GATE_API_KEY=testnet_api_key
GATE_API_SECRET=testnet_api_secret

# Testnet provides virtual funds with no financial risk
# Validate strategy effectiveness before mainnet
```

### Transitioning to Mainnet

1. Thoroughly test on testnet for several days
2. Verify all risk controls function correctly
3. Update `.env` with mainnet credentials
4. Start with minimal capital (100-500 USDT recommended)
5. Monitor closely for first 24-48 hours
6. Gradually increase capital based on proven results

### Monitoring

- Web Dashboard: `http://localhost:3100` (or configured PORT)
- Real-time position tracking
- Account balance and PnL
- AI decision logs
- Trade history with PnL

## Development Guidelines

### Adding New Trading Symbols

1. Update `TRADING_SYMBOLS` in `.env`
2. Verify symbol is supported on Gate.io (`${SYMBOL}_USDT` contract)
3. Check if symbol uses quanto multipliers (update `contractUtils.ts` if needed)
4. No code changes needed - system auto-detects from config

### Modifying Risk Parameters

Risk parameters are in `src/config/riskParams.ts` and read from environment variables:
- `MAX_POSITIONS`: Maximum simultaneous positions
- `MAX_LEVERAGE`: Maximum leverage allowed
- `MAX_HOLDING_HOURS`: Maximum position holding time
- Drawdown thresholds: `ACCOUNT_DRAWDOWN_*_PERCENT`

All strategy parameters auto-adjust based on `MAX_LEVERAGE`.

### Working with Multi-Exchange Support (NEW)

The system uses an abstraction layer (`IExchangeClient`) for multi-exchange support:

**Using the Exchange Client:**
```typescript
// Import the factory (not direct Gate client)
import { createExchangeClient } from '../../services/exchange';

// Get exchange client (automatically uses configured exchange)
const client = createExchangeClient();

// All methods return standardized data types
const account = await client.getFuturesAccount();  // Returns: Account
const positions = await client.getPositions();      // Returns: Position[]
const ticker = await client.getFuturesTicker('BTC'); // Returns: Ticker

// Positions use standardized fields:
// position.symbol (normalized: "BTC")
// position.side ('long' | 'short')
// position.quantity (unsigned number)
// position.unrealizedPnl (not unrealisedPnl)
```

**Key Points:**
- Use `createExchangeClient()` instead of `createGateClient()`
- Symbols are normalized (`BTC` not `BTC_USDT`)
- Data structures are standardized across exchanges
- Exchange-specific handling is in adapters

**Migration Pattern:**
```typescript
// OLD (being phased out)
import { createGateClient } from '../../services/gateClient';
const client = createGateClient();
const positions = await client.getPositions();
// positions[0].contract = "BTC_USDT"
// positions[0].size = 10 (signed)

// NEW (recommended)
import { createExchangeClient } from '../../services/exchange';
const client = createExchangeClient();
const positions = await client.getPositions();
// positions[0].symbol = "BTC"
// positions[0].exchangeSymbol = "BTC_USDT"
// positions[0].side = 'long'
// positions[0].quantity = 10 (unsigned)
```

**Documentation:**
- Architecture: `docs/ARCHITECTURE_MULTI_EXCHANGE.md`
- Phase 1 Status: `docs/PHASE_1_COMPLETE.md`

### Database Migrations

For schema changes:
1. Modify `CREATE_TABLES_SQL` in `src/database/schema.ts`
2. Create migration script in `src/database/` if needed
3. Add npm script to `package.json` for migration
4. Test on copy of database first

Example: Adding `peak_pnl_percent` column:
```bash
npm run db:migrate:peak-pnl
```

### Testing Trading Logic

Use demo scripts in `scripts/`:
- `calculate-pnl-demo.ts`: Test PnL calculations
- `check-consistency.ts`: Verify database consistency
- `verify-all-trades.ts`: Validate trade records

Run with: `tsx --env-file=.env ./scripts/<script-name>.ts`

## Troubleshooting

### Common Issues

**Database Locked**:
```bash
npm run trading:stop
rm -f .voltagent/trading.db-shm
rm -f .voltagent/trading.db-wal
npm run trading:start
```

**API Rate Limits**:
- System has built-in retry logic (2 retries with exponential backoff)
- Adjust `TRADING_INTERVAL_MINUTES` if hitting limits frequently
- Check Gate.io API documentation for rate limits

**Position Sync Issues**:
- Gate.io API may have delays
- System will retry sync automatically
- Use `npm run db:sync-positions` for manual sync

**PnL Calculation Errors**:
- Verify quanto multipliers for all symbols
- Check if symbol uses coin-based vs USDT-based settlement
- Run `scripts/fix-historical-pnl.ts` to recalculate

### Logging

- Real-time logs: Displayed in console when running `npm run trading:start`
- PM2 logs: `npm run pm2:logs`
- Log level: Set in `createPinoLogger()` calls (default: "info")
- All logs include China timezone (UTC+8)

## License and Contribution

Licensed under AGPL-3.0:
- Modifications must be open-sourced
- Network use requires source code disclosure
- No warranty provided

Follow Conventional Commits for commit messages:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- refactor: Code refactoring
- test: Test additions/modifications
