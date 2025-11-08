import { updateReflectionOnClose } from "../src/learning/reflections/updateOnClose";

async function debugReflectionUpdate() {
  console.log("🔍 Debugging Reflection Update for LTC SL\n");

  // Test with the known LTC stop_loss trade
  const testCloseData = {
    entryOrderId: "39815254238",  // LTC entry order ID
    closePrice: 99.36,
    pnl: -0.49458130499999936,
    closeReason: "stop_loss",
    symbol: "LTC",
  };

  console.log(`📊 Testing reflection update for:`, testCloseData);

  const result = await updateReflectionOnClose(testCloseData);

  console.log(`✅ Result:`, result);

  if (result.success) {
    console.log(`🎉 Reflection update successful!`);
  } else {
    console.log(`❌ Reflection update failed: ${result.message}`);
    console.log(`💡 This indicates why SL/TP/Drawdown PnL updates are not working`);
  }
}

debugReflectionUpdate().catch(console.error);