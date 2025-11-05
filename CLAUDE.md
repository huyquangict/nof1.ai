# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

open-nof1.ai is an AI-driven cryptocurrency automated trading system built on the VoltAgent framework. The system gives AI models (DeepSeek V3.2, Grok4, Claude, etc.) full autonomy over market analysis and trading decisions, minimizing hardcoded rules. The architecture connects AI agents to Gate.io exchange APIs through a tool-based interface.

## Development Commands

### Core Development
```bash
npm run dev              # Development mode with hot reload (tsx watch)
npm run build            # Build production bundle (tsdown)
npm start                # Run production build
npm run lint             # Check code style (biome)
npm run lint:fix         # Auto-fix linting issues
npm run typecheck        # TypeScript type checking
```

### Trading System
```bash
npm run trading:start    # Start trading system
npm run trading:stop     # Stop by killing port
npm run trading:restart  # Stop and restart
```

### Database Management
```bash
npm run db:init          # Initialize database schema
npm run db:reset         # Reset database (WARNING: deletes all data)
npm run db:status        # Check database status
npm run db:sync          # Sync positions from Gate.io
npm run db:sync-positions # Sync only positions data
npm run db:check-consistency # Verify data consistency
npm run db:close-and-reset   # Close positions, reset, and restart
```

### Production Deployment
```bash
# PM2 (production)
npm run pm2:start        # Start with PM2
npm run pm2:restart      # Restart trading process
npm run pm2:logs         # View logs
npm run pm2:stop         # Stop process

# Docker
npm run docker:build     # Build Docker image
npm run docker:up        # Start with docker-compose
npm run docker:down      # Stop containers
npm run docker:prod:up   # Production deployment
```

## Architecture

### System Flow
1. **Entry Point** (`src/index.ts`): Initializes database, starts web server (Hono), launches trading loop and monitoring schedulers
2. **Trading Loop** (`src/scheduler/tradingLoop.ts`): Executes every N minutes (configurable), collects market data, calls AI agent for decisions
3. **Trading Agent** (`src/agents/tradingAgent.ts`): VoltAgent-powered AI that receives market context and makes trading decisions via tools
4. **Trading Tools** (`src/tools/trading/`): AI-callable functions for executing trades, querying positions, getting market data
5. **Gate Client** (`src/services/gateClient.ts`): Wrapper around Gate.io API for futures trading
6. **Database** (`src/database/schema.ts`): LibSQL (SQLite) storing positions, trades, signals, decisions, account history

### Key Components

**Trading Strategies** (`src/agents/tradingAgent.ts`):
- `ultra-short`: 5-minute cycles, quick entry/exit, medium-high risk
- `swing-trend`: 20-minute cycles, captures medium-term trends, medium-low risk (code-level protection enabled)
- `conservative`: Low risk, low leverage, capital protection priority
- `balanced`: Risk-reward balance (default)
- `aggressive`: High risk, high leverage, high returns

Only `swing-trend` strategy has **code-level protection** enabled (trailing stops and stop losses in `src/scheduler/trailingStopMonitor.ts` and `src/scheduler/stopLossMonitor.ts`). Other strategies rely on AI for all risk management.

**Risk Management** (`src/config/riskParams.ts`):
- Maximum leverage, positions, holding hours
- Extreme stop-loss protection (last safety net before liquidation)
- Account-level drawdown protection
- Trading symbols whitelist

**Monitoring Schedulers**:
- `trailingStopMonitor.ts`: Checks every 10 seconds for trailing stop conditions (swing-trend only)
- `stopLossMonitor.ts`: Checks every 10 seconds for stop-loss conditions (swing-trend only)
- `accountRecorder.ts`: Records account balance history

### Data Flow for AI Decisions

The AI agent receives comprehensive market context in `generateTradingPrompt()`:
- **Multi-timeframe analysis**: 1m, 3m, 5m, 15m, 30m, 1h candlestick data
- **Technical indicators**: EMA20/50, MACD, RSI7/14, volume, ATR
- **Time-series data**: Recent 10 data points of price/indicators for trend analysis
- **Account info**: Balance, available, unrealized P&L, return %, Sharpe ratio
- **Current positions**: Symbol, side, leverage, entry price, P&L, opened time
- **Trade history**: Last 10 trades with outcomes
- **Recent decisions**: Previous AI decision for continuity

The AI responds by calling tools like `openPosition`, `closePosition`, `getMarketData`, etc.

## Git Commit Requirements

**CRITICAL: All commit messages MUST use Chinese descriptions with English type prefixes.**

Format:
```
<type>[optional scope]: <description in Chinese>

[optional body in Chinese]
```

Types:
- `feat`: 添加新功能
- `fix`: 修复bug
- `refactor`: 重构代码
- `perf`: 性能优化
- `docs`: 修改文档
- `style`: 代码样式调整（不影响功能）
- `test`: 修改测试
- `chore`: 非业务性代码修改
- `build`: 构建系统修改
- `ci`: CI流程修改

Examples:
```bash
feat: 添加移动止盈监控器
fix(交易工具): 修复止损订单创建失败的问题
refactor: 优化市场数据收集流程以减少API调用
```

**Never commit before manually reviewing code.** Do not use `--no-verify` or skip hooks.

## Environment Configuration

Key variables in `.env`:

### Trading Parameters
- `TRADING_INTERVAL_MINUTES`: Trading cycle interval (5 for ultra-short, 20 for swing-trend)
- `TRADING_STRATEGY`: Strategy type (ultra-short, swing-trend, conservative, balanced, aggressive)
- `MAX_LEVERAGE`: Maximum leverage multiplier
- `MAX_POSITIONS`: Maximum concurrent positions
- `MAX_HOLDING_HOURS`: Force close after this many hours
- `INITIAL_BALANCE`: Starting capital for P&L calculations
- `ACCOUNT_STOP_LOSS_USDT`: Account-level stop-loss (closes all positions and exits)
- `ACCOUNT_TAKE_PROFIT_USDT`: Account-level take-profit (closes all positions and exits)

### API Credentials
- `GATE_API_KEY`, `GATE_API_SECRET`: Gate.io API credentials
- `GATE_USE_TESTNET`: Use testnet (true) or mainnet (false)
- `OPENAI_API_KEY`: AI model API key (supports OpenRouter, OpenAI, DeepSeek, etc.)
- `OPENAI_BASE_URL`: API base URL (e.g., https://openrouter.ai/api/v1)
- `AI_MODEL_NAME`: Model identifier (e.g., deepseek/deepseek-v3.2-exp, x-ai/grok-4-fast)

## Important Concepts

### Position Management
- Database positions (`positions` table) store metadata (stop-loss/take-profit order IDs, opened time, peak P&L)
- Real-time position data should always be fetched from Gate.io API
- `syncPositionsFromGate()` reconciles Gate.io state with database records

### P&L Calculation
Gate.io's `account.total` excludes unrealized P&L:
- `totalBalance` = realized P&L only
- `returnPercent` = (totalBalance - initialBalance) / initialBalance * 100
- Frontend must add `unrealisedPnl` for complete picture

The system includes `fixHistoricalPnlRecords()` to correct any miscalculated P&L in trade history.

### Code-Level vs AI-Driven Protection

**Swing-Trend Strategy** (code-level protection):
- Trailing stops execute automatically every 10 seconds in `trailingStopMonitor.ts`
- Stop-loss rules execute automatically every 10 seconds in `stopLossMonitor.ts`
- 5-stage trailing stop: 4% → 8% → 12% → 16% → 20%+ with increasing lock-in percentages
- Stop-loss based on risk level: low-risk positions (-8%), medium (-12%), high (-15%)

**Other Strategies** (AI-driven):
- AI fully controls stop-loss and take-profit decisions
- System only enforces extreme stop-loss (default -30%) to prevent liquidation
- AI must manage risk through tool calls

### Account Safety Mechanisms
Regardless of strategy, the system enforces:
1. **Extreme stop-loss**: Force close if position P&L ≤ -30% (prevents liquidation)
2. **Maximum holding time**: Force close after MAX_HOLDING_HOURS
3. **Account-level thresholds**: Exit system if balance ≤ ACCOUNT_STOP_LOSS_USDT or ≥ ACCOUNT_TAKE_PROFIT_USDT
4. **Drawdown protection**: Warning/restriction/force-close based on peak drawdown percentages

## Testing and Debugging

### Testnet First
Always test strategies on Gate.io testnet (`GATE_USE_TESTNET=true`) before mainnet deployment. Testnet allows risk-free experimentation.

### Common Issues
- **Position sync mismatch**: Run `npm run db:sync` to reconcile
- **Incorrect P&L in history**: Run `npm run db:check-consistency` or let `fixHistoricalPnlRecords()` auto-correct
- **API rate limits**: Gate.io has rate limits; the code includes retry logic with exponential backoff
- **Empty positions from API**: May be API delay; system skips sync if Gate returns 0 positions but DB has positions

### Monitoring
- Web dashboard: `http://localhost:3100` (shows real-time positions, account, decisions)
- Logs: Use `npm run pm2:logs` or check console output in dev mode
- Database queries: Direct SQL queries on `.voltagent/trading.db` for debugging

## Code Structure Notes

- **Contract utilities** (`src/utils/contractUtils.ts`): Handle quanto multipliers for P&L calculations (BTC/ETH use 0.0001, others use 1)
- **Time utilities** (`src/utils/timeUtils.ts`): System uses Asia/Shanghai timezone (UTC+8)
- **Multi-timeframe analysis** (`src/services/multiTimeframeAnalysis.ts`): Aggregates indicators across timeframes for AI context
- **API routes** (`src/api/routes.ts`): Hono-based REST API for web dashboard

## Contributor Notes

- This is an AGPL-3.0 licensed project; any modifications must be open-sourced
- The system is designed for **minimal human intervention** - avoid adding hardcoded trading rules
- When modifying strategies, test thoroughly on testnet with small amounts
- Database migrations are manual; see `src/database/` for migration scripts (e.g., `add-peak-pnl-column.ts`)
