#!/usr/bin/env node

/**
 * MCP Client Shell - Direct interface to NetSuite MCP Server
 * 
 * This script uses the official MCP SDK client to communicate with the
 * NetSuite MCP server via stdio transport.
 * 
 * Usage:
 *   ./mcp-client-shell.ts list-tools
 *   ./mcp-client-shell.ts run-suiteql "SELECT id, companyname FROM customer LIMIT 5"
 *   ./mcp-client-shell.ts get-environments
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  console.log("🔌 MCP Client Shell");
  console.log("=".repeat(60));
  console.log("");

  if (!command) {
    printUsage();
    process.exit(1);
  }

  // Create stdio transport (environment variables already loaded by shell script)
  console.log("Starting MCP server...");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: process.env as Record<string, string>,
  });

  // Create MCP client
  const client = new Client(
    {
      name: "mcp-client-shell",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    // Connect to server
    await client.connect(transport);
    console.log("✅ Connected to MCP server\n");

    // Execute command
    await executeCommand(client, command, args);

    // Close connection
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

async function executeCommand(client: Client, command: string, args: string[]) {
  switch (command) {
    case "list-tools":
      await listTools(client);
      break;

    case "get-environments":
      await callTool(client, "list_environments", {});
      break;

    case "run-suiteql":
      if (args.length === 0) {
        console.error("❌ Error: SQL query required");
        console.error("Usage: ./mcp-client-shell.ts run-suiteql \"SELECT ...\"");
        process.exit(1);
      }
      await callTool(client, "run_suiteql", {
        query: args[0],
        limit: args[1] ? parseInt(args[1]) : 100,
        environment: args[2] || "sb1",
      });
      break;

    case "get-transactions":
      await callTool(client, "get_transactions", {
        dateFrom: args[0] || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        limit: args[1] ? parseInt(args[1]) : 10,
        environment: args[2] || "sb1",
      });
      break;

    case "get-script-logs":
      await callTool(client, "get_script_logs", {
        dateFrom: args[0] || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        limit: args[1] ? parseInt(args[1]) : 20,
        environment: args[2] || "sb1",
      });
      break;

    case "call-tool":
      if (args.length < 1) {
        console.error("❌ Error: Tool name required");
        console.error('Usage: ./mcp-client-shell.ts call-tool <tool-name> \'{"arg": "value"}\'');
        process.exit(1);
      }
      const toolArgs = args.length > 1 ? JSON.parse(args[1]) : {};
      await callTool(client, args[0], toolArgs);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

async function listTools(client: Client) {
  console.log("📋 Available Tools:\n");
  const result = await client.listTools();
  
  result.tools.forEach((tool, index) => {
    console.log(`${index + 1}. ${tool.name}`);
    console.log(`   ${tool.description}`);
    console.log("");
  });
}

async function callTool(client: Client, toolName: string, args: any) {
  console.log(`🔧 Calling tool: ${toolName}`);
  console.log(`📥 Arguments:`, JSON.stringify(args, null, 2));
  console.log("");

  const result = await client.callTool({ name: toolName, arguments: args });
  
  console.log("📤 Result:");
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.log("Usage:");
  console.log("  ./mcp-client-shell.ts <command> [args...]");
  console.log("");
  console.log("Commands:");
  console.log("  list-tools                           List all available MCP tools");
  console.log("  get-environments                     Get NetSuite environments");
  console.log('  run-suiteql "<query>" [limit] [env]  Run SuiteQL query');
  console.log("  get-transactions [date] [limit]      Get recent transactions");
  console.log("  get-script-logs [date] [limit]       Get script execution logs");
  console.log('  call-tool <name> \'{"args": "..."}\'   Call any tool with JSON args');
  console.log("");
  console.log("Examples:");
  console.log('  ./mcp-client-shell.ts run-suiteql "SELECT id FROM customer LIMIT 5"');
  console.log("  ./mcp-client-shell.ts get-transactions 2024-04-01 10");
  console.log('  ./mcp-client-shell.ts call-tool get_record \'{"type": "customer", "id": "123"}\'');
}

main();

