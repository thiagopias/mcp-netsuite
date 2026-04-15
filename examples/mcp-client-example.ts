#!/usr/bin/env node

/**
 * Example: Custom MCP Client that calls the NetSuite MCP Server
 * 
 * This demonstrates how to programmatically interact with the MCP server
 * without using an AI assistant like Claude or Augment.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";

async function main() {
  // Create MCP client
  const client = new Client(
    {
      name: "netsuite-client-example",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  // Spawn the MCP server process
  const serverProcess = spawn("node", ["./dist/index.js"], {
    env: {
      ...process.env,
      // Load credentials from environment
      NETSUITE_SB1_ACCOUNT_ID: process.env.NETSUITE_SB1_ACCOUNT_ID,
      NETSUITE_SB1_CLIENT_ID: process.env.NETSUITE_SB1_CLIENT_ID,
      NETSUITE_SB1_CERTIFICATE_ID: process.env.NETSUITE_SB1_CERTIFICATE_ID,
      NETSUITE_SB1_PRIVATE_KEY: process.env.NETSUITE_SB1_PRIVATE_KEY,
      NETSUITE_DEFAULT_ENV: "sb1",
    },
  });

  // Create stdio transport (communicates via stdin/stdout)
  const transport = new StdioClientTransport({
    command: serverProcess,
  });

  // Connect client to server
  await client.connect(transport);

  console.log("✓ Connected to MCP NetSuite server");

  // List available tools
  const toolsList = await client.listTools();
  console.log(`\n📦 Available tools: ${toolsList.tools.length}`);
  toolsList.tools.slice(0, 5).forEach((tool) => {
    console.log(`  - ${tool.name}`);
  });

  // Example 1: List environments
  console.log("\n🌍 Calling list_environments...");
  const envResult = await client.callTool({
    name: "list_environments",
    arguments: {},
  });
  console.log("Result:", JSON.parse(envResult.content[0].text));

  // Example 2: Run a SuiteQL query
  console.log("\n📊 Calling run_suiteql...");
  const queryResult = await client.callTool({
    name: "run_suiteql",
    arguments: {
      query: "SELECT id, companyname FROM customer WHERE isinactive = 'F' ORDER BY id",
      limit: 5,
      environment: "sb1",
    },
  });
  const data = JSON.parse(queryResult.content[0].text);
  console.log(`Found ${data.totalResults} customers, showing ${data.count}:`);
  data.items.forEach((item: any) => {
    console.log(`  - [${item.id}] ${item.companyname}`);
  });

  // Example 3: Get custom record types
  console.log("\n🔧 Calling get_custom_record_types...");
  const customRecordsResult = await client.callTool({
    name: "get_custom_record_types",
    arguments: {
      includeInactive: false,
      environment: "sb1",
    },
  });
  const customRecords = JSON.parse(customRecordsResult.content[0].text);
  console.log(`Found ${customRecords.totalTypes} custom record types`);

  // Close connection
  await client.close();
  console.log("\n✓ Disconnected from server");
}

// Run with error handling
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

