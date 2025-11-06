import { createExchangeClient } from '../src/services/exchange/index.js';

async function testConnection() {
  console.log('🔌 Testing Binance connection...');
  console.log('Environment:', process.env.USE_TESTNET === 'true' ? 'TESTNET' : 'MAINNET ⚠️');
  
  try {
    const client = createExchangeClient();
    console.log('✅ Client created:', client.getExchangeName());
    console.log('✅ Testnet mode:', client.isTestnet());
    
    // Test account access
    console.log('\n📊 Fetching account info...');
    const account = await client.getFuturesAccount();
    console.log('✅ Account balance:', account.totalBalance, 'USDT');
    console.log('✅ Available:', account.availableBalance, 'USDT');
    console.log('✅ Unrealized PnL:', account.unrealisedPnl, 'USDT');
    
    // Test positions
    console.log('\n📈 Fetching positions...');
    const positions = await client.getPositions();
    console.log('✅ Active positions:', positions.length);
    
    if (positions.length > 0) {
      console.log('\nCurrent positions:');
      for (const pos of positions) {
        console.log(`  - ${pos.symbol}: ${pos.side} ${pos.quantity} @ $${pos.entryPrice} (PnL: $${pos.unrealizedPnl.toFixed(2)})`);
      }
    }
    
    console.log('\n✅ Connection test successful!');
  } catch (error: any) {
    console.error('❌ Connection test failed:', error.message);
    if (error.message?.includes('API')) {
      console.error('\n💡 Tip: Check your BINANCE_API_KEY and BINANCE_API_SECRET in .env');
    }
    process.exit(1);
  }
}

testConnection();
