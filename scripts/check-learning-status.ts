import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

async function checkLearningStatus() {
  console.log("🔍 Checking AI Learning System Status\n");

  // Check if learning is enabled
  const learningResult = await db.execute({
    sql: "SELECT key, value FROM system_config WHERE key = 'learning_enabled'",
    args: [],
  });

  if (learningResult.rows.length === 0) {
    console.log("❌ AI Learning: NOT CONFIGURED (no 'learning_enabled' key found)");
    return;
  }

  const learningEnabled = learningResult.rows[0].value as string;
  console.log(`📚 AI Learning: ${learningEnabled === '1' ? '✅ ENABLED' : '❌ DISABLED'}`);

  // Check recent reflections that should have PnL updates
  const reflectionsResult = await db.execute({
    sql: "SELECT id, symbol, order_id, close_price, close_reason, pnl_result, feedback_score, timestamp FROM trading_reflections WHERE close_price IS NOT NULL ORDER BY timestamp DESC LIMIT 10",
    args: [],
  });

  console.log(`\n📊 Recent Closed Reflections (should have PnL): ${reflectionsResult.rows.length}`);
  for (const row of reflectionsResult.rows) {
    const reflection = row as any;
    console.log(`  ID ${reflection.id}: ${reflection.symbol} (${reflection.close_reason}) - PnL: ${reflection.pnl_result}, Order: ${reflection.order_id}`);
  }

  // Check recent trades with close reasons
  const tradesResult = await db.execute({
    sql: "SELECT order_id, entry_order_id, symbol, close_reason, pnl, timestamp FROM trades WHERE close_reason IS NOT NULL ORDER BY timestamp DESC LIMIT 10",
    args: [],
  });

  console.log(`\n💰 Recent Trades with Close Reasons: ${tradesResult.rows.length}`);
  for (const row of tradesResult.rows) {
    const trade = row as any;
    console.log(`  Trade ${trade.order_id}: ${trade.symbol} (${trade.close_reason}) - PnL: ${trade.pnl}, Entry: ${trade.entry_order_id}`);
  }

  // Check for potential matches between trades and reflections
  console.log(`\n🔗 Checking for Reflection-Trade Matches...`);

  for (const tradeRow of tradesResult.rows) {
    const trade = tradeRow as any;
    if (trade.entry_order_id) {
      const matchResult = await db.execute({
        sql: "SELECT id, symbol, close_price, close_reason, pnl_result FROM trading_reflections WHERE order_id = ?",
        args: [trade.entry_order_id],
      });

      if (matchResult.rows.length > 0) {
        const reflection = matchResult.rows[0] as any;
        console.log(`  ✅ Match Found: Trade ${trade.order_id} ↔ Reflection ${reflection.id}`);
        console.log(`     ${trade.symbol} ${trade.close_reason}: Trade PnL=${trade.pnl}, Reflection PnL=${reflection.pnl_result}`);
      } else {
        console.log(`  ❌ No Match: Trade ${trade.order_id} (Entry: ${trade.entry_order_id}) - No reflection found`);
      }
    }
  }
}

checkLearningStatus().catch(console.error);