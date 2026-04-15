#!/usr/bin/env node

/**
 * Example: Direct API Client (Without MCP)
 * 
 * This shows how to use the NetSuiteClient class directly
 * without going through the MCP protocol layer.
 * 
 * Use this approach if you want to:
 * - Build a custom integration
 * - Use NetSuite API directly in your application
 * - Avoid the MCP protocol overhead
 */

import { NetSuiteClient } from "../src/netsuite-client.js";

async function main() {
  // Create NetSuite client directly (try SB2 first, fall back to SB1)
  const accountId = process.env.NETSUITE_SB2_ACCOUNT_ID || process.env.NETSUITE_SB1_ACCOUNT_ID;
  const clientId = process.env.NETSUITE_SB2_CLIENT_ID || process.env.NETSUITE_SB1_CLIENT_ID;
  const certificateId = process.env.NETSUITE_SB2_CERTIFICATE_ID || process.env.NETSUITE_SB1_CERTIFICATE_ID;
  const privateKey = process.env.NETSUITE_SB2_PRIVATE_KEY || process.env.NETSUITE_SB1_PRIVATE_KEY;

  if (!accountId || !clientId || !certificateId || !privateKey) {
    console.error("❌ Error: NetSuite credentials not found in environment variables");
    console.error("Please load .env.sb1 or .env.sb2 first");
    process.exit(1);
  }

  const client = new NetSuiteClient({
    accountId,
    clientId,
    certificateId,
    privateKey,
  });

  console.log("🔌 Direct NetSuite API Client");
  console.log("=" .repeat(50));
  console.log(`Environment: ${accountId}`);
  console.log("=" .repeat(50));

  // Example 1: Run SuiteQL query
  console.log("\n📊 Running SuiteQL query...");
  const customers = await client.runSuiteQL(
    "SELECT id, companyname FROM customer WHERE isinactive = 'F' ORDER BY id",
    5,
    0
  );
  console.log(`Found ${customers.totalResults} customers:`);
  customers.items.forEach((item: any) => {
    console.log(`  - [${item.id}] ${item.companyname}`);
  });

  // Example 2: Get all results (paginated automatically)
  console.log("\n📦 Fetching all script logs from last week...");
  const logs = await client.runSuiteQLAll(
    `SELECT date, type, title FROM scriptnote 
     WHERE date >= CURRENT_DATE - 7 
     ORDER BY date DESC`,
    100
  );
  console.log(`Total logs: ${logs.totalResults}, Pages fetched: ${logs.pagesFetched}`);

  // Example 3: Get record metadata
  console.log("\n🔍 Getting customer record metadata...");
  const metadata = await client.getRecordMetadata("customer");
  console.log("Metadata schema received");

  // Example 4: Fetch a single record
  console.log("\n📄 Fetching customer record #123...");
  try {
    const customer = await client.getRecord("customer", 123, false);
    console.log("Customer data:", customer);
  } catch (error) {
    console.log("Customer not found or error:", (error as Error).message);
  }

  // Example 5: Call a RESTlet
  console.log("\n🔧 Calling a RESTlet...");
  try {
    const restletResult = await client.callRestlet(
      "1234", // scriptId
      "1",    // deployId
      "GET"
    );
    console.log("RESTlet response:", restletResult);
  } catch (error) {
    console.log("RESTlet error:", (error as Error).message);
  }

  console.log("\n✅ Done!");
}

// Run with error handling
main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});

