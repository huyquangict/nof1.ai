import "dotenv/config";
import { createExchangeClient } from "./src/services/exchange";

async function main() {
  const client = createExchangeClient();

  console.log("\n=== Checking Orphaned Orders ===\n");

  const orphanIds = ["39768161267", "39768161511"];

  for (const orderId of orphanIds) {
    try {
      const order = await client.getOrder(orderId, "LTC");
      console.log(`Order ${orderId}:`);
      console.log(JSON.stringify(order, null, 2));
      console.log();
    } catch (error) {
      console.error(`Failed to get order ${orderId}:`, error);
    }
  }
}

main().catch(console.error);
