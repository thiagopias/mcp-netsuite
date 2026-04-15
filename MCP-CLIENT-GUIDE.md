# MCP Client Shell - Direct NetSuite Interface

This guide explains how to use the **MCP Client Shell** tools to interface directly with the NetSuite MCP server from the command line.

## Overview

The MCP Client Shell provides two interfaces:

1. **`mcp-query.sh`** - User-friendly shell wrapper with common commands
2. **`mcp-client-shell.ts`** - Full-featured TypeScript MCP client

Both tools use the official `@modelcontextprotocol/sdk` to communicate with the NetSuite MCP server via stdio transport.

## Quick Start

### 1. List Available Tools

```bash
./mcp-query.sh list-tools
```

Shows all 16 NetSuite MCP tools with descriptions.

### 2. Check Environments

```bash
./mcp-query.sh environments
```

Returns:
```json
{
  "defaultEnvironment": "sb1",
  "environments": [
    {"id": "sb1", "accountId": "8526034_SB1", "isDefault": true},
    {"id": "sb2", "accountId": "8526034_SB2", "isDefault": false}
  ]
}
```

### 3. Query Customers

```bash
./mcp-query.sh customers
```

Runs a predefined query: `SELECT id, companyname, email, phone FROM customer WHERE isinactive = 'F' ORDER BY id DESC LIMIT 10`

### 4. Get Recent Transactions

```bash
./mcp-query.sh transactions
```

Gets transactions from the last 30 days.

### 5. Get Script Logs

```bash
./mcp-query.sh logs
```

Gets script execution logs from the last 7 days.

### 6. Custom SQL Query

```bash
./mcp-query.sh sql "SELECT id, type, tranid FROM transaction WHERE voided = 'F' LIMIT 5"
```

### 7. Call Any MCP Tool

```bash
./mcp-query.sh custom get_record '{"type":"customer","id":"123"}'
```

## mcp-query.sh Commands

| Command | Description | Example |
|---------|-------------|---------|
| `help` | Show usage information | `./mcp-query.sh help` |
| `list-tools` | List all MCP tools | `./mcp-query.sh list-tools` |
| `environments` | Get configured environments | `./mcp-query.sh environments` |
| `customers` | Query recent customers | `./mcp-query.sh customers` |
| `transactions` | Query recent transactions | `./mcp-query.sh transactions` |
| `logs` | Get script execution logs | `./mcp-query.sh logs` |
| `sql "<query>"` | Run custom SuiteQL query | `./mcp-query.sh sql "SELECT ..."` |
| `custom <tool> <args>` | Call any MCP tool | `./mcp-query.sh custom get_record '{...}'` |

## mcp-client-shell.ts Commands

For more control, use the TypeScript client directly:

```bash
# List tools
npx tsx mcp-client-shell.ts list-tools

# List environments
npx tsx mcp-client-shell.ts get-environments

# Run SuiteQL
npx tsx mcp-client-shell.ts run-suiteql "SELECT id FROM customer LIMIT 5" 100 sb1

# Get transactions (date, limit, environment)
npx tsx mcp-client-shell.ts get-transactions 2024-04-01 10 sb1

# Get script logs (date, limit, environment)
npx tsx mcp-client-shell.ts get-script-logs 2024-04-01 20 sb1

# Call any tool with JSON arguments
npx tsx mcp-client-shell.ts call-tool get_record '{"type":"customer","id":"123","environment":"sb1"}'
```

## Advanced Examples

### Get Custom Record Types

```bash
./mcp-query.sh custom get_custom_record_types '{}'
```

### Query Custom Record

```bash
./mcp-query.sh sql "SELECT id, name FROM customrecord_cu_rma_line LIMIT 10"
```

### Get Record Metadata

```bash
./mcp-query.sh custom get_record_metadata '{"recordType":"customer"}'
```

### Browse File Cabinet

```bash
# List root folders
./mcp-query.sh custom list_file_cabinet '{}'

# List specific folder
./mcp-query.sh custom list_file_cabinet '{"folderId":"123"}'

# Search for files
./mcp-query.sh custom list_file_cabinet '{"nameSearch":"myScript"}'
```

### Get Custom List Values

```bash
./mcp-query.sh custom get_custom_list '{"scriptId":"customlist_cu_marketplace"}'
```

### Call a RESTlet

```bash
./mcp-query.sh custom call_restlet '{
  "scriptId": "1234",
  "deployId": "1",
  "method": "GET",
  "environment": "sb1"
}'
```

## How It Works

1. **Environment Loading**: The shell script loads `.env.sb1` and `.env.sb2` files
2. **MCP Server Spawn**: The TypeScript client spawns the MCP server as a child process
3. **Stdio Communication**: Client and server communicate via stdin/stdout using JSON-RPC 2.0
4. **Tool Invocation**: The client sends tool requests, server executes them against NetSuite
5. **Response Handling**: Results are returned as JSON and displayed

## Troubleshooting

### Error: "OAuth token request failed"

The MCP server can't authenticate with NetSuite. This is expected for SB2 currently (NetSuite config issue). Try using SB1 or fix the OAuth 2.0 setup in NetSuite.

### Error: "Tool not found"

Check the tool name with `./mcp-query.sh list-tools`. Tool names use underscores (e.g., `list_environments` not `list-environments`).

### Server doesn't start

Ensure:
- `dist/index.js` exists (run `npm run build`)
- Environment variables are set in `.env.sb1` and `.env.sb2`
- Node.js and dependencies are installed

## Benefits of MCP Client Shell

✅ **No AI Assistant Required** - Direct CLI access to NetSuite  
✅ **Scriptable** - Integrate into automation workflows  
✅ **Debugging** - Test MCP server without Cursor/Augment  
✅ **Batch Operations** - Process multiple queries via shell scripts  
✅ **CI/CD Integration** - Use in deployment pipelines

## Next Steps

- Use in shell scripts for automation
- Build custom wrappers for specific workflows
- Integrate with cron jobs for scheduled queries
- Export data to CSV/JSON for analysis

