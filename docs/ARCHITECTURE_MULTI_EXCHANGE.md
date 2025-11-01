# Multi-Exchange Support Architecture Review

## Current Architecture Analysis

### Strengths
1. **Clean Separation**: Trading logic (agent), data collection (scheduler), and exchange interaction (client) are well-separated
2. **Singleton Pattern**: `createGateClient()` provides a single client instance, easy to swap
3. **Tool Abstraction**: VoltAgent tools provide a clean interface between AI and exchange operations
4. **Risk Management**: Centralized risk checks independent of exchange implementation

### Current Dependencies on Gate.io
1. **Direct SDK Usage**: `gate-api` package used throughout
2. **Contract Naming**: `BTC_USDT` format hardcoded
3. **Position Data Structure**: Assumes Gate.io response format
4. **Quanto Multipliers**: Hardcoded for specific Gate.io contracts
5. **Testnet/Mainnet Switching**: Gate.io-specific URL patterns

## Key Challenges for Multi-Exchange Support

### 1. API Differences

| Aspect | Gate.io | Binance Futures (CCXT) |
|--------|---------|------------------------|
| Symbol Format | `BTC_USDT` | `BTC/USDT:USDT` |
| Position Mode | Single | One-way vs Hedge mode |
| Margin Mode | Per-position | Isolated vs Cross |
| Leverage Setting | Per-position | Per-symbol global |
| Size Units | Contracts | Base currency or contracts |
| Price Format | String | Number |
| Order Response | Immediate | May need polling |
| Testnet | Separate URL | Separate exchange ID |

### 2. Data Structure Differences

**Gate.io Position:**
```typescript
{
  contract: "BTC_USDT",
  size: "10",  // positive = long, negative = short
  entryPrice: "45000.5",
  leverage: "10",
  unrealisedPnl: "125.50"
}
```

**CCXT Binance Position:**
```typescript
{
  symbol: "BTC/USDT:USDT",
  contracts: 10,
  side: "long",  // explicit side
  entryPrice: 45000.5,
  leverage: 10,
  unrealizedPnl: 125.50
}
```

### 3. Feature Parity

| Feature | Gate.io | Binance | Notes |
|---------|---------|---------|-------|
| Perpetual Futures | ✅ | ✅ | Both support |
| Market Orders | ✅ | ✅ | Both support |
| Stop Loss Orders | ✅ | ✅ | Different implementations |
| Funding Rate | ✅ | ✅ | Both provide |
| Multi-timeframe Candles | ✅ | ✅ | CCXT standardizes |
| Quanto Contracts | ✅ | ⚠️ | Different contracts |

## Recommended Architecture: Exchange Adapter Pattern

### Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Trading Agent (AI)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────┐
│                  VoltAgent Trading Tools                    │
│  (Exchange-agnostic interface remains unchanged)           │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────┐
│               Exchange Factory (Singleton)                  │
│           getExchangeClient() -> IExchangeClient            │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
┌─────────▼────────┐   ┌─────────▼────────┐
│  GateAdapter     │   │  BinanceAdapter  │
│  (Gate.io SDK)   │   │  (CCXT)          │
└──────────────────┘   └──────────────────┘
```

### Core Interface: `IExchangeClient`

```typescript
// src/services/exchange/IExchangeClient.ts

export interface IExchangeClient {
  // Market Data
  getFuturesTicker(symbol: string): Promise<Ticker>;
  getFuturesCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getFundingRate(symbol: string): Promise<FundingRate>;
  getOrderBook(symbol: string, limit: number): Promise<OrderBook>;
  getContractInfo(symbol: string): Promise<ContractInfo>;

  // Account & Positions
  getFuturesAccount(): Promise<Account>;
  getPositions(): Promise<Position[]>;

  // Trading
  placeOrder(params: OrderParams): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<Order>;
  getOpenOrders(symbol?: string): Promise<Order[]>;
  setLeverage(symbol: string, leverage: number): Promise<void>;

  // Configuration
  getExchangeName(): string;
  isTestnet(): boolean;
  normalizeSymbol(symbol: string): string; // BTC -> BTC_USDT or BTC/USDT:USDT
  denormalizeSymbol(exchangeSymbol: string): string; // BTC_USDT -> BTC
}

// Standardized Data Types
export interface Ticker {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}

export interface Position {
  symbol: string;           // Normalized: "BTC"
  exchangeSymbol: string;   // Exchange format: "BTC_USDT" or "BTC/USDT:USDT"
  side: 'long' | 'short';
  quantity: number;         // Absolute value
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  margin: number;
  timestamp: number;
}

export interface OrderParams {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  price?: number;          // undefined = market order
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}
```

### Adapter Implementations

#### 1. Gate.io Adapter (Wrapper)

```typescript
// src/services/exchange/GateAdapter.ts

import { GateClient } from '../gateClient';
import { IExchangeClient, Position, Ticker } from './IExchangeClient';

export class GateAdapter implements IExchangeClient {
  private client: GateClient;

  constructor(apiKey: string, apiSecret: string, testnet: boolean) {
    this.client = new GateClient(apiKey, apiSecret);
  }

  async getFuturesTicker(symbol: string): Promise<Ticker> {
    const contract = this.normalizeSymbol(symbol);
    const raw = await this.client.getFuturesTicker(contract);

    return {
      symbol,
      lastPrice: parseFloat(raw.last || "0"),
      markPrice: parseFloat(raw.markPrice || raw.last || "0"),
      indexPrice: parseFloat(raw.indexPrice || "0"),
      change24h: parseFloat(raw.change_percentage || "0"),
      volume24h: parseFloat(raw.volume_24h || "0"),
      timestamp: Date.now(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const rawPositions = await this.client.getPositions();

    return rawPositions
      .filter(p => parseInt(p.size || "0") !== 0)
      .map(p => ({
        symbol: this.denormalizeSymbol(p.contract),
        exchangeSymbol: p.contract,
        side: parseInt(p.size || "0") > 0 ? 'long' : 'short',
        quantity: Math.abs(parseInt(p.size || "0")),
        entryPrice: parseFloat(p.entryPrice || "0"),
        currentPrice: parseFloat(p.markPrice || "0"),
        liquidationPrice: parseFloat(p.liqPrice || "0"),
        unrealizedPnl: parseFloat(p.unrealisedPnl || "0"),
        realizedPnl: parseFloat(p.realisedPnl || "0"),
        leverage: parseInt(p.leverage || "1"),
        margin: parseFloat(p.margin || "0"),
        timestamp: Date.now(),
      }));
  }

  normalizeSymbol(symbol: string): string {
    return `${symbol}_USDT`;
  }

  denormalizeSymbol(exchangeSymbol: string): string {
    return exchangeSymbol.replace('_USDT', '');
  }

  getExchangeName(): string {
    return 'gateio';
  }

  isTestnet(): boolean {
    return process.env.GATE_USE_TESTNET === 'true';
  }
}
```

#### 2. Binance Adapter (CCXT)

```typescript
// src/services/exchange/BinanceAdapter.ts

import ccxt from 'ccxt';
import { IExchangeClient, Position, Ticker } from './IExchangeClient';

export class BinanceAdapter implements IExchangeClient {
  private exchange: ccxt.binanceusdm;

  constructor(apiKey: string, apiSecret: string, testnet: boolean) {
    this.exchange = new ccxt.binanceusdm({
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: 'future',
        defaultMarginMode: 'isolated', // or 'cross'
      },
    });

    if (testnet) {
      this.exchange.setSandboxMode(true);
    }
  }

  async getFuturesTicker(symbol: string): Promise<Ticker> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    const ticker = await this.exchange.fetchTicker(ccxtSymbol);

    return {
      symbol,
      lastPrice: ticker.last || 0,
      markPrice: ticker.info?.markPrice || ticker.last || 0,
      indexPrice: ticker.info?.indexPrice || ticker.last || 0,
      change24h: ticker.percentage || 0,
      volume24h: ticker.quoteVolume || 0,
      timestamp: ticker.timestamp || Date.now(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const positions = await this.exchange.fetchPositions();

    return positions
      .filter(p => Math.abs(p.contracts || 0) > 0)
      .map(p => ({
        symbol: this.denormalizeSymbol(p.symbol),
        exchangeSymbol: p.symbol,
        side: p.side as 'long' | 'short',
        quantity: Math.abs(p.contracts || 0),
        entryPrice: p.entryPrice || 0,
        currentPrice: p.markPrice || 0,
        liquidationPrice: p.liquidationPrice || 0,
        unrealizedPnl: p.unrealizedPnl || 0,
        realizedPnl: 0, // CCXT doesn't provide this in position
        leverage: p.leverage || 1,
        margin: p.collateral || 0,
        timestamp: p.timestamp || Date.now(),
      }));
  }

  async placeOrder(params: OrderParams): Promise<Order> {
    const symbol = this.normalizeSymbol(params.symbol);

    // Set leverage first (if specified)
    if (params.leverage) {
      await this.setLeverage(params.symbol, params.leverage);
    }

    // Convert to CCXT order
    const side = params.side === 'long' ? 'buy' : 'sell';
    const type = params.price ? 'limit' : 'market';

    const order = await this.exchange.createOrder(
      symbol,
      type,
      side,
      params.quantity,
      params.price,
      {
        reduceOnly: params.reduceOnly || false,
      }
    );

    return {
      id: order.id,
      symbol: params.symbol,
      side: params.side,
      price: order.price || 0,
      quantity: order.amount,
      status: order.status,
      timestamp: order.timestamp || Date.now(),
    };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const ccxtSymbol = this.normalizeSymbol(symbol);
    await this.exchange.setLeverage(leverage, ccxtSymbol);
  }

  normalizeSymbol(symbol: string): string {
    return `${symbol}/USDT:USDT`;
  }

  denormalizeSymbol(exchangeSymbol: string): string {
    return exchangeSymbol.split('/')[0];
  }

  getExchangeName(): string {
    return 'binance';
  }

  isTestnet(): boolean {
    return this.exchange.testnet || false;
  }
}
```

### Exchange Factory

```typescript
// src/services/exchange/ExchangeFactory.ts

import { IExchangeClient } from './IExchangeClient';
import { GateAdapter } from './GateAdapter';
import { BinanceAdapter } from './BinanceAdapter';

let exchangeClientInstance: IExchangeClient | null = null;

export function createExchangeClient(): IExchangeClient {
  if (exchangeClientInstance) {
    return exchangeClientInstance;
  }

  const exchange = process.env.EXCHANGE || 'gateio';
  const testnet = process.env.USE_TESTNET === 'true';

  switch (exchange.toLowerCase()) {
    case 'gateio':
    case 'gate':
      const gateKey = process.env.GATE_API_KEY;
      const gateSecret = process.env.GATE_API_SECRET;
      if (!gateKey || !gateSecret) {
        throw new Error('Gate.io credentials not configured');
      }
      exchangeClientInstance = new GateAdapter(gateKey, gateSecret, testnet);
      break;

    case 'binance':
      const binanceKey = process.env.BINANCE_API_KEY;
      const binanceSecret = process.env.BINANCE_API_SECRET;
      if (!binanceKey || !binanceSecret) {
        throw new Error('Binance credentials not configured');
      }
      exchangeClientInstance = new BinanceAdapter(binanceKey, binanceSecret, testnet);
      break;

    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }

  return exchangeClientInstance;
}

// Reset function for testing
export function resetExchangeClient(): void {
  exchangeClientInstance = null;
}
```

## Migration Strategy

### Phase 1: Create Abstraction Layer (No Breaking Changes)
1. Create `IExchangeClient` interface
2. Implement `GateAdapter` as wrapper around existing `GateClient`
3. Create `ExchangeFactory`
4. **Keep existing `createGateClient()` for backward compatibility**

### Phase 2: Update Tools to Use Adapter
1. Replace `createGateClient()` with `createExchangeClient()` in tools
2. Update `tradingLoop.ts` to use adapter
3. Test thoroughly with Gate.io (should work identically)

### Phase 3: Add Binance Support
1. Add CCXT dependency: `npm install ccxt`
2. Implement `BinanceAdapter`
3. Add Binance-specific configuration
4. Test with Binance testnet

### Phase 4: Handle Exchange-Specific Features
1. Create exchange-specific config files
2. Update `contractUtils.ts` for Binance quanto contracts
3. Add exchange-specific risk parameters if needed

## Configuration Changes

### Environment Variables

```bash
# Exchange Selection
EXCHANGE=gateio              # Options: gateio, binance
USE_TESTNET=true

# Gate.io (existing)
GATE_API_KEY=xxx
GATE_API_SECRET=xxx

# Binance (new)
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=xxx
BINANCE_MARGIN_MODE=isolated # Options: isolated, cross
BINANCE_POSITION_MODE=oneway # Options: oneway, hedge
```

### Exchange-Specific Config

```typescript
// src/config/exchangeConfig.ts

export interface ExchangeConfig {
  name: string;
  supportedSymbols: string[];
  maxLeverage: number;
  minOrderSize: Record<string, number>;
  quantoMultipliers?: Record<string, number>;
  takerFee: number;
  makerFee: number;
}

export const EXCHANGE_CONFIGS: Record<string, ExchangeConfig> = {
  gateio: {
    name: 'Gate.io',
    supportedSymbols: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'BCH'],
    maxLeverage: 100,
    minOrderSize: {
      BTC: 1,
      ETH: 1,
      // ...
    },
    quantoMultipliers: {
      BNB: 0.01,
      BCH: 0.001,
    },
    takerFee: 0.0005,
    makerFee: 0.0002,
  },
  binance: {
    name: 'Binance',
    supportedSymbols: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'BCH'],
    maxLeverage: 125,
    minOrderSize: {
      BTC: 0.001,
      ETH: 0.001,
      // ...
    },
    takerFee: 0.0004,
    makerFee: 0.0002,
  },
};
```

## Testing Strategy

### 1. Unit Tests
- Test each adapter independently
- Mock exchange responses
- Verify data normalization

### 2. Integration Tests
- Test with both exchange testnets
- Verify order placement and cancellation
- Test position tracking
- Validate PnL calculations

### 3. Compatibility Tests
- Run existing tests with new adapter layer
- Ensure Gate.io functionality unchanged
- Compare outputs between direct client and adapter

### 4. Live Testing Checklist
- [ ] Connect to Binance testnet
- [ ] Fetch market data successfully
- [ ] Place and cancel orders
- [ ] Open and close positions
- [ ] Verify leverage settings
- [ ] Check PnL calculations
- [ ] Test forced risk checks
- [ ] Validate 36-hour position limits

## Potential Gotchas

### 1. Leverage Setting
- **Gate.io**: Leverage set per-position at order time
- **Binance**: Leverage set per-symbol globally, persists
- **Solution**: Always set leverage before placing order in Binance adapter

### 2. Position Sizing
- **Gate.io**: Uses "contracts" (varies by symbol)
- **Binance**: Can use contracts or notional value
- **Solution**: Standardize on contracts, convert in adapter

### 3. Order Status Polling
- **Gate.io**: Order fills usually reflected immediately
- **Binance**: May need to poll order status
- **Solution**: Add polling mechanism in Binance adapter

### 4. Rate Limits
- **Gate.io**: 300 requests/10 seconds (public), 900 requests/10 seconds (private)
- **Binance**: Weight-based system, varies by endpoint
- **Solution**: Implement rate limiting per exchange

### 5. Funding Rate Timing
- **Gate.io**: Every 8 hours
- **Binance**: Every 8 hours (same)
- **Note**: Timing may differ, check documentation

## Recommended Order of Implementation

1. ✅ **Review this document** (You are here)
2. Create interface and type definitions
3. Implement GateAdapter wrapper
4. Create ExchangeFactory
5. Update one tool file to test the pattern
6. Update all tools and trading loop
7. Add comprehensive tests
8. Implement BinanceAdapter
9. Test with Binance testnet
10. Update documentation
11. Deploy and monitor

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing Gate.io functionality | High | Keep backward compatibility, extensive testing |
| CCXT API differences | Medium | Thorough adapter testing, handle edge cases |
| Exchange-specific bugs | Medium | Gradual rollout, testnet first |
| Performance degradation | Low | Profile code, optimize adapters |
| Data format mismatches | High | Strict type checking, validation |

## Benefits of This Approach

1. **Clean Abstraction**: Tools remain unchanged, easy to add more exchanges
2. **Testability**: Can mock exchange clients easily
3. **Backward Compatible**: Existing Gate.io code continues working
4. **Future-Proof**: Easy to add Bybit, OKX, etc.
5. **Type Safety**: TypeScript interfaces enforce consistency
6. **Maintainability**: Exchange-specific code isolated in adapters

## Alternative Approaches (Not Recommended)

### ❌ Direct CCXT Everywhere
- Replace all Gate.io SDK usage with CCXT
- **Problem**: CCXT Gate.io support may have bugs/differences
- **Problem**: Lose Gate.io SDK features

### ❌ Parallel Implementations
- Keep Gate.io code, duplicate for Binance
- **Problem**: Code duplication, hard to maintain
- **Problem**: Tools become exchange-aware

### ❌ Single Mega-Client
- One client with if/else for each exchange
- **Problem**: Becomes unmaintainable quickly
- **Problem**: Violates single responsibility principle

## Conclusion

The **Exchange Adapter Pattern** is the recommended approach because it:
- Minimizes risk to existing functionality
- Provides clean separation of concerns
- Allows incremental migration
- Makes adding future exchanges straightforward
- Maintains type safety and testability

The implementation should be done in phases, starting with the abstraction layer and ensuring Gate.io continues working identically before adding Binance support.
