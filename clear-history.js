import { createClient } from "@libsql/client";

const client = createClient({
  url: "file:./.voltagent/trading.db",
});

async function clearHistory() {
  console.log("Clearing AI decision history...");
  await client.execute("DELETE FROM agent_decisions");
  console.log("✅ AI decision history cleared!");

  const count = await client.execute("SELECT COUNT(*) as count FROM agent_decisions");
  console.log(`Remaining decisions: ${count.rows[0].count}`);

  client.close();
}

clearHistory();
