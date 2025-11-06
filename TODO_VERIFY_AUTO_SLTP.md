# TODO: Verify Fully Automated SL/TP System

## Implementation Completed: 2025-11-06

### What Was Implemented:

1. **Auto Stop-Loss (Phase 2)**
   - System automatically sets SL order when `openPosition` is called
   - Configured via `POSITION_STOP_LOSS_PNL_PERCENT` environment variable (default: -15%)
   - Supports both Binance (STOP_MARKET) and Gate.io (Price Trigger orders)
   - SL order saved to database in `sl_orders` field
   - Implementation: `/opt/nof1.ai/src/tools/trading/tradeExecution.ts` lines 639-738

2. **Dynamic Trailing TP (Phase 1)**
   - Profit manager runs every 30 seconds monitoring all positions
   - Automatically sets/adjusts trailing TP orders based on profit milestones:
     * +8% profit → Sets TP to lock in +3%
     * +15% profit → Adjusts TP to lock in +8%
     * +25% profit → Adjusts TP to lock in +15%
   - Implementation: `/opt/nof1.ai/src/scheduler/profitManager.ts`

3. **AI Prompt Updated (Phase 3)**
   - Removed all manual SL/TP setting instructions
   - Simplified workflow: Analyze → Call openPosition → Done
   - AI focuses only on finding trading opportunities
   - Implementation: `/opt/nof1.ai/src/agents/tradingAgent.ts`

4. **Manual Tools Removed (Option C)**
   - `setStopLossTool` and `setTakeProfitTool` removed from AI agent
   - AI cannot manually override system settings
   - Enforces consistent risk management across all trades

## Verification Checklist

### Test 1: Auto Stop-Loss Verification

**When to test:** After opening a new position

- [ ] **Check Exchange**: Log into Binance/Gate.io exchange
  - Verify SL order appears immediately after position opens
  - Verify SL order type is correct (STOP_MARKET for Binance, Price Trigger for Gate.io)
  - Verify SL price matches expected value (entry price × (1 - |15%/leverage|/100))

- [ ] **Check Database**: Query the `positions` table
  ```sql
  SELECT symbol, side, entry_price, sl_orders FROM positions WHERE symbol = 'BTC';
  ```
  - Verify `sl_orders` field is populated with JSON array
  - Verify SL order contains: `{ price, percentage: 100, orderId, triggered: false }`

- [ ] **Check Logs**: Review system logs
  - Look for: `💰 Auto-setting stop-loss at -15% PnL (leveraged)...`
  - Look for: `✅ [Binance] Stop-loss order created: BTC long X@YYYY.ZZZZ`
  - Look for: `✅ Stop-loss saved to database: order_id @ price`

- [ ] **Verify Calculation**:
  - For LONG position: SL price should be BELOW entry price
  - For SHORT position: SL price should be ABOVE entry price
  - Formula:
    * LONG: `SL = entry × (1 - 15%/leverage/100)`
    * SHORT: `SL = entry × (1 + 15%/leverage/100)`

**Example:**
- Entry: $95,000, Leverage: 10x, Side: LONG
- Expected SL: 95000 × (1 - 15/10/100) = 95000 × 0.9985 = $94,857.50
- Verify exchange shows order at ~$94,857.50

### Test 2: Dynamic Trailing TP Verification

**When to test:** After a position reaches +8% profit

- [ ] **Monitor Position**: Watch position as it becomes profitable
  - At +8% PnL: Check if TP order appears on exchange
  - At +15% PnL: Check if TP order is updated/moved
  - At +25% PnL: Check if TP order is updated/moved again

- [ ] **Check Exchange**: Verify TP orders
  - Verify TP order type (TAKE_PROFIT_MARKET for Binance)
  - Verify TP price matches trailing stop calculation
  - Verify old TP orders are cancelled when new ones are created

- [ ] **Check Database**: Query `positions` table
  ```sql
  SELECT symbol, side, entry_price, pnl_percent, tp_orders FROM positions WHERE symbol = 'BTC';
  ```
  - Verify `tp_orders` field is updated with new TP price
  - Verify only one TP order exists (old ones should be replaced)

- [ ] **Check Logs**: Review profit manager logs (every 30 seconds)
  - Look for: `✅ BTC: Trailing TP adjusted to XXXX.XXXX (+8% lock, order: order_id)`
  - Verify old TP orders are being cancelled
  - Verify new TP orders are being created

- [ ] **Verify TP Price Calculation**:
  - At +8% profit: TP should lock +3% (entry × (1 + 3%/leverage/100))
  - At +15% profit: TP should lock +8% (entry × (1 + 8%/leverage/100))
  - At +25% profit: TP should lock +15% (entry × (1 + 15%/leverage/100))

**Example:**
- Entry: $95,000, Leverage: 10x, Side: LONG
- At +8% PnL: TP = 95000 × (1 + 3/10/100) = $95,285
- At +15% PnL: TP = 95000 × (1 + 8/10/100) = $95,760
- At +25% PnL: TP = 95000 × (1 + 15/10/100) = $96,425

### Test 3: AI Cannot Manually Set SL/TP

**When to test:** During any AI trading cycle

- [ ] **Check AI Logs**: Review AI decision making
  - Verify AI does NOT attempt to call `setStopLoss` tool
  - Verify AI does NOT attempt to call `setTakeProfit` tool
  - Verify AI only calls `openPosition` when entering trades

- [ ] **Check Tool Availability**:
  ```bash
  grep -n "setStopLossTool\|setTakeProfitTool" src/agents/tradingAgent.ts
  ```
  - Verify both tools are commented out (lines 1328-1329)
  - Verify comments state: "REMOVED: System automatically sets..."

- [ ] **Test AI Response**: If AI tries to set SL/TP
  - Should receive error: "Tool not found" or similar
  - AI should not have access to these tools at all

### Test 4: Edge Cases and Error Scenarios

**When to test:** Ongoing monitoring

- [ ] **SL Placement Failure**:
  - If SL order fails to place, verify:
    * Position remains open (not rolled back)
    * Error is logged clearly
    * Alert: `❌ Failed to auto-set stop-loss: error message`
    * Alert: `Position is open but without SL protection!`

- [ ] **TP Placement Failure**:
  - If profit manager fails to set TP, verify:
    * System retries in next 30-second cycle
    * Error is logged but doesn't crash profit manager
    * Other positions continue to be monitored

- [ ] **Multiple Positions**:
  - Open 2-3 positions simultaneously
  - Verify each has its own SL order on exchange
  - Verify each has its own TP when profitable
  - Verify no cross-contamination of orders

- [ ] **Exchange API Delays**:
  - Monitor for "position not found" errors during SL setting
  - System should retry if exchange API lags
  - Verify eventual consistency

### Test 5: End-to-End Integration Test

**Full workflow verification:**

1. [ ] **Start System**: `npm run trading:start`
2. [ ] **Wait for AI Cycle**: Monitor logs for next trading decision
3. [ ] **Position Opens**: AI calls `openPosition`
4. [ ] **Verify Auto-SL**: Check exchange and database (within 1-2 seconds)
5. [ ] **Wait for Profit**: Let position become profitable (+8%+)
6. [ ] **Verify Auto-TP**: Check exchange and database (within 30 seconds)
7. [ ] **Verify TP Updates**: If profit continues, verify TP adjusts at +15%, +25%
8. [ ] **Verify Exit**: Position closes via TP/SL order (not manual close)

## Expected Results Summary

✅ **SL is set automatically** on every position open
✅ **TP is set dynamically** when profit reaches milestones
✅ **AI does not call** manual SL/TP tools
✅ **Orders visible** on exchange immediately
✅ **Database tracks** all SL/TP orders correctly
✅ **Logs show** clear success/error messages
✅ **System recovers** from errors gracefully

## Files to Monitor

- Logs: Check console output or PM2 logs (`npm run pm2:logs`)
- Database: `.voltagent/trading.db` - `positions` table
- Exchange: Binance/Gate.io web interface - Open Orders section
- Code:
  * `/opt/nof1.ai/src/tools/trading/tradeExecution.ts` (Auto-SL)
  * `/opt/nof1.ai/src/scheduler/profitManager.ts` (Auto-TP)
  * `/opt/nof1.ai/src/agents/tradingAgent.ts` (AI tools)

## Commits Related to This Feature

- `ac579fa` - feat: 完全自动化止损/止盈系统 - 简化AI交易流程
- `34c0f05` - feat: 移除手动SL/TP工具 - AI无法手动设置止损止盈

## Configuration

Check `.env` file for these settings:

```bash
POSITION_STOP_LOSS_PNL_PERCENT=-15  # Auto-SL percentage (leveraged PnL)
# Trailing TP thresholds are hardcoded in profitManager.ts:
# +8% → lock +3%
# +15% → lock +8%
# +25% → lock +15%
```

## Notes

- System is designed to be resilient - if SL/TP placement fails, position remains open with error logging
- Profit manager runs independently of AI trading loop (every 30 seconds)
- All SL/TP orders use `reduceOnly: true` flag to prevent increasing position size
- Gate.io uses Price Trigger orders, Binance uses conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)

---

**TODO: Delete this file after successful verification and testing**

Date Created: 2025-11-06
Last Updated: 2025-11-06
