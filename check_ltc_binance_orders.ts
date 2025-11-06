import "dotenv/config";
import { createExchangeClient } from "./src/services/exchange";

async function main() {
  const client = createExchangeClient();

  console.log("\n=== LTC Open Orders on Binance ===");
  const orders = await client.getOpenOrders("LTC");

  console.log(`\nTotal open orders: ${orders.length}\n`);

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    console.log(`Order ${i + 1}:`);
    console.log(`  ID: ${order.id}`);
    console.log(`  Side: ${order.side}`);
    console.log(`  Type: ${order.type}`);
    console.log(`  Price: ${order.price}`);
    console.log(`  Quantity: ${order.quantity}`);
    console.log(`  Status: ${order.status}`);
    console.log(`  Reduce Only: ${order.reduceOnly || false}`);
    console.log();
  }
}

main().catch(console.error);
