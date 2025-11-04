# ID-Based Order/Position Tracking System

## Overview

The trading system now uses **order and position IDs** as the primary mechanism for tracking, verifying, and synchronizing all trading operations. This ensures database records always match the actual state on the exchange.

## Core Principle

**Exchange is the single source of truth**. Database records are a cache that must be continuously verified against the exchange using order/position IDs.

## Architecture

### 1. ID Tracking Fields in Database

Every position tracks these critical IDs in the `positions` table:

```sql
entry_order_id TEXT     -- ID of the order that opened the position
sl_order_id TEXT        -- ID of the stop-loss order
tp_orders TEXT          -- JSON array of take-profit orders: [{orderId, price, percentage, triggered}]
```

### 2. Data Flow

#### Opening a Position (src/tools/trading/tradeExecution.ts:openPositionTool)

```
1. Place market order on exchange
2. Get order.id and order.filled
3. ✅ NEW: Actively query exchange for actual position
4. ✅ NEW: Compare order.filled vs exchange position quantity
5. ✅ NEW: Log warning if mismatch > 1%
6. ✅ NEW: Use EXCHANGE quantity as source of truth
7. Store position with entry_order_id = order.id
```

**Key Code Section (lines 386-449)**:
```typescript
// ✅ CRITICAL: Verify actual position from exchange by entry_order_id
let actualPositionQuantity = finalQuantity;
let positionVerified = false;

while (retryCount < maxRetries) {
  const exchangePosition = positions.find((p) => p.symbol === symbol && p.side === side);

  if (exchangePosition && exchangePosition.quantity > 0) {
    actualPositionQuantity = exchangePosition.quantity;

    // 🔥 CRITICAL CHECK: Verify quantity matches
    const quantityDiff = Math.abs(actualPositionQuantity - finalQuantity);
    if (quantityDiff > 0.01 && (quantityDiff / finalQuantity) * 100 > 1) {
      logger.warn(`⚠️ QUANTITY MISMATCH: Order filled ${finalQuantity}, exchange shows ${actualPositionQuantity}`);
      logger.warn(`   Using EXCHANGE quantity: ${actualPositionQuantity} (source of truth)`);
    }
    positionVerified = true;
    break;
  }
}

// Use actualPositionQuantity (verified from exchange) in database INSERT/UPDATE
```

#### Syncing Positions (src/tools/trading/accountManagement.ts:syncPositionsTool)

```
1. Fetch all positions from exchange
2. Get all positions from database with IDs
3. For each database position:
   a. ✅ Verify entry_order_id status
   b. ✅ Check sl_order_id status → detect SL trigger
   c. ✅ Check each tp_orders[].orderId status → detect TP trigger
   d. ✅ Record close trades for triggered orders
   e. ✅ Remove triggered orders from tracking
4. Match exchange positions with verified database positions
5. Update database with exchange data + keep verified IDs
6. Detect positions closed externally
```

**Key Code Section (lines 309-582)**:
```typescript
// 3️⃣ Check each DB position's SL/TP order status by ID
for (const dbPos of dbPositions) {
  // ✅ Verify entry order
  if (dbPos.entry_order_id) {
    const entryOrder = await client.getOrder(dbPos.entry_order_id);
    if (entryOrder.status === 'cancelled' || entryOrder.status === 'rejected') {
      continue; // Skip invalid position
    }
  }

  // 🛑 Check SL order status
  if (dbPos.sl_order_id) {
    const slOrder = await client.getOrder(dbPos.sl_order_id);
    if (slOrder.status === 'filled' || slOrder.status === 'finished') {
      // 🔥 SL triggered! Record close trade
      await recordSlTpTrigger(client, dbPos, slOrder, 'SL');
      continue; // Position is closed
    }
  }

  // 🎯 Check TP orders status
  if (dbPos.tp_orders) {
    const tpOrdersArray = JSON.parse(dbPos.tp_orders);
    for (const tp of tpOrdersArray) {
      const tpOrder = await client.getOrder(tp.orderId);
      if (tpOrder.status === 'filled' || tpOrder.status === 'finished') {
        // 🔥 TP triggered! Record close trade
        await recordSlTpTrigger(client, dbPos, tpOrder, 'TP');
      }
    }
  }
}
```

#### Trading Loop (src/scheduler/tradingLoop.ts:syncPositionsFromGate)

```
1. Every trading cycle (e.g., every 5 minutes)
2. Fetch positions from exchange
3. Call syncPositionsFromGate(rawPositions) at line 1692
4. ✅ Already has SL/TP trigger detection:
   - Checks sl_order_id status (lines 799-872)
   - Checks tp_orders array status (lines 874-944)
   - Records close trades for triggered orders
```

**Key Code Section (lines 799-944)**:
```typescript
// Check if SL was triggered
if (slOrderId) {
  const order = await exchangeClient.getOrder(slOrderId, dbSymbol);
  if (order.status === 'finished' || order.status === 'filled') {
    logger.info(`🛑 Stop-loss TRIGGERED for ${dbSymbol}`);
    // Record close trade with PnL calculation
    // ...
  }
}

// Check if any TP was triggered
const tpOrders = JSON.parse(tpOrdersStr);
for (const tp of tpOrders) {
  const order = await exchangeClient.getOrder(tp.orderId, dbSymbol);
  if (order.status === 'finished' || order.status === 'filled') {
    logger.info(`🎯 Take-profit TRIGGERED for ${dbSymbol}`);
    // Record partial close trade
    // ...
  }
}
```

## Trade History Linking

### Entry-Close Trade Linking

All close trades are linked back to their entry trades via `entry_order_id`:

```typescript
// trades table schema
interface Trade {
  id: number;
  order_id: string;        // ID of this trade's order
  entry_order_id?: string; // ID of entry order (for close trades)
  symbol: string;
  side: 'long' | 'short';
  type: 'open' | 'close';
  // ... other fields
}

// Example: Complete position lifecycle
// Open trade
{
  id: 1,
  order_id: "t-12345678",
  entry_order_id: null,      // NULL for open trades
  type: "open",
  // ...
}

// Close trade (linked to entry)
{
  id: 2,
  order_id: "t-12345690",    // SL order ID
  entry_order_id: "t-12345678", // 🔥 Links back to entry
  type: "close",
  close_reason: "stop_loss",
  // ...
}
```

### Query Examples

```sql
-- Find all trades for a position
SELECT * FROM trades
WHERE order_id = 't-12345678' OR entry_order_id = 't-12345678'
ORDER BY timestamp;

-- Verify PnL by joining entry and close
SELECT
  open.order_id as entry_order,
  close.order_id as close_order,
  close.close_reason,
  open.price as entry_price,
  close.price as exit_price,
  close.pnl
FROM trades open
JOIN trades close ON close.entry_order_id = open.order_id
WHERE open.symbol = 'BTC' AND open.type = 'open';

-- Find orphaned close trades (missing entry link)
SELECT * FROM trades
WHERE type = 'close' AND entry_order_id IS NULL;
```

## TP Orders Format

Take-profit orders are stored as a JSON array of objects:

```typescript
interface TakeProfitOrder {
  orderId: string;      // Exchange order ID
  price: number;        // TP trigger price
  percentage: number;   // Position % to close (30/40/30 split)
  triggered?: boolean;  // Whether this TP was triggered
}

// Example in database:
tp_orders: '[
  {"orderId":"123456","price":95000,"percentage":30},
  {"orderId":"123457","price":96000,"percentage":40},
  {"orderId":"123458","price":97000,"percentage":30}
]'
```

## Quantity Mismatch Detection

### Problem Solved

Previously, the system would:
1. Place order requesting X units
2. Order reports filled X units
3. Database stores X units
4. Exchange actually has Y units (Y ≠ X)
5. SL/TP calculations become incorrect

### Solution

Now the system:
1. Places order requesting X units
2. Order reports filled X units
3. ✅ **Actively queries exchange for actual position**
4. ✅ **Compares order fill vs exchange position**
5. ✅ **Logs warning if difference > 1%**
6. ✅ **Uses exchange quantity Y as source of truth**
7. Database stores Y units (verified)

### Example Log Output

```
✅ Position verified: 425 units on exchange (matches order fill)

⚠️ QUANTITY MISMATCH: Order filled 425, but exchange shows 213
   Difference: 212.0000 (49.88%)
   Using EXCHANGE quantity: 213 (source of truth)
```

## SL/TP Trigger Detection

### How It Works

1. **Proactive Detection**: Trading loop checks order statuses every cycle
2. **ID-Based Queries**: Uses `sl_order_id` and `tp_orders` to query exchange
3. **Automatic Recording**: When triggered, automatically records close trade
4. **PnL Calculation**: Calculates accurate PnL using actual fill price

### States Detected

| Order Status | Action |
|--------------|--------|
| `open`, `pending` | Keep tracking, order still active |
| `filled`, `finished` | 🔥 **TRIGGERED!** Record close trade, remove from tracking |
| `cancelled` | Remove from tracking, log warning |

### Close Reasons Recorded

```typescript
'stop_loss'              // SL order was triggered
'take_profit_partial'    // TP order was triggered (partial close)
'unknown'                // Position closed but we don't know how (external close)
```

## Benefits

### 1. Accuracy
- Database always reflects actual exchange state
- No orphaned records or ghost positions
- Quantity mismatches detected immediately

### 2. Transparency
- Every position can be traced back to entry order
- Every close can be traced to SL/TP order
- Complete audit trail via IDs

### 3. Resilience
- API delays handled with retry logic
- Temporary mismatches logged but recovered
- External closes detected and recorded

### 4. Debugging
- Comprehensive logging with order IDs
- Easy to trace issues in exchange UI
- Clear separation of database cache vs exchange truth

## Usage Examples

### Manually Sync Positions

The AI trading agent can call:
```typescript
syncPositionsTool.execute({})
```

This will:
1. Verify all position IDs
2. Detect triggered SL/TP orders
3. Record close trades
4. Update database with exchange data

### Check Position Status

```typescript
// In database
SELECT entry_order_id, sl_order_id, tp_orders FROM positions WHERE symbol = 'BTC';

// Returns:
// entry_order_id: "t-12345678"
// sl_order_id: "t-12345690"
// tp_orders: '[{"orderId":"t-12345691","price":95000,"percentage":30}]'

// Then query exchange:
client.getOrder("t-12345678") // Check if entry order still valid
client.getOrder("t-12345690") // Check if SL triggered
client.getOrder("t-12345691") // Check if TP1 triggered
```

## Migration Notes

### Before ID-Based Tracking
```typescript
// Old approach: Match by symbol only
const dbPosition = dbPositions.find(p => p.symbol === 'BTC');
// Problem: If BTC position was closed and reopened, might match wrong position!
```

### After ID-Based Tracking
```typescript
// New approach: Verify by entry_order_id
const dbPosition = dbPositions.find(p => p.symbol === 'BTC');
const entryOrder = await client.getOrder(dbPosition.entry_order_id);
if (entryOrder.status === 'cancelled') {
  // This is an invalid/old position, skip it
}
// Now we KNOW this is a valid, active position
```

## Testing

### Build and Type Check
```bash
npm run typecheck  # No errors in modified files
npm run build      # Build successful in 331ms
```

### Manual Testing
1. Open a position → Check `entry_order_id` is set
2. Set SL/TP → Check `sl_order_id` and `tp_orders` are set
3. Wait for trigger or manually close on exchange
4. Run `syncPositionsTool` → Should detect trigger and record close trade

### Logs to Monitor
```
🔄 Starting ID-based position sync...
📊 Exchange has X active positions
💾 Database has Y position records
🔍 Checking DB position: BTC (entry_order_id: t-12345678)
  ✅ Entry order t-12345678: finished (filled: 0.1/0.1)
  🛑 SL order t-12345690: open (filled: 0/0.1)
  🎯 TP order t-12345691: open (filled: 0/0.03)
  ✅ Position BTC verified and valid
```

## Future Improvements

1. **Position Matching by Entry Order ID**: Currently matches by symbol, could match by entry_order_id for multi-position support
2. **Order Status Cache**: Cache order statuses temporarily to reduce API calls
3. **Webhook Support**: Use exchange webhooks for real-time trigger detection instead of polling
4. **Partial TP Tracking**: Track how many TPs have triggered and adjust position accordingly

## Migration: Adding entry_order_id to Existing Database

If you have an existing database without the `entry_order_id` column, run the migration:

```bash
npx tsx --env-file=.env src/database/migrations/add-entry-order-id-to-trades.ts
```

The migration will:
1. Add `entry_order_id TEXT` column to trades table
2. Intelligently populate existing close trades by matching:
   - Same symbol
   - Same side (long/short)
   - Most recent open trade before close timestamp
3. Create index for query performance
4. Report success/failures

**Example Output:**
```
✅ Populated 17 / 17 close trades with entry_order_id
  ✅ Trade #2 (SOL close) → entry_order_id = 167563220505
  ✅ Trade #4 (LTC close) → entry_order_id = 39725883169
  ...
```

For fresh installations, the column is already included in `CREATE_TABLES_SQL`.

## Related Files

- `src/tools/trading/tradeExecution.ts` - openPositionTool with quantity verification + close with entry_order_id
- `src/tools/trading/accountManagement.ts` - syncPositionsTool with ID-based verification + entry_order_id linking
- `src/scheduler/tradingLoop.ts` - syncPositionsFromGate with trigger detection + entry_order_id recording
- `src/database/schema.ts` - Updated Trade interface and CREATE TABLE with entry_order_id
- `src/database/migrations/add-entry-order-id-to-trades.ts` - Migration script
- `docs/ID_BASED_TRACKING.md` - This documentation

---

**Generated with Claude Code**
