# MCP NetSuite Server - Usage Examples

This directory contains examples showing different ways to interact with the MCP NetSuite server.

## 🎯 Three Ways to Use This Server

### **Option 1: AI Assistants with Built-in MCP Support** (Easiest)

**No coding required!** These applications have MCP clients built-in:

- **Claude Desktop** - Configure in `~/.config/claude/config.json`
- **Cursor IDE** - Already configured in `.cursor/mcp.json` ✅
- **Augment AI** - VSCode/Cursor extension ✅
- **Continue.dev** - AI coding assistant

**Your current setup**: Already working with Cursor/Augment! Just ask questions like:
- "Show me the latest NetSuite transactions"
- "What custom record types are available?"
- "Query the script logs for errors"

---

### **Option 2: Custom MCP Client** (Programmatic)

Build your own client that communicates with the MCP server via stdio.

#### **Node.js/TypeScript Example**

See: [`mcp-client-example.ts`](./mcp-client-example.ts)

```bash
# Install dependencies
npm install @modelcontextprotocol/sdk

# Load environment and run
source .env.sb1
npx tsx examples/mcp-client-example.ts
```

**Use case**: Build custom automation, integrations, or CLI tools that need to query NetSuite.

#### **Python Example**

See: [`python-mcp-client.py`](./python-mcp-client.py)

```bash
# Install dependencies
pip install mcp anthropic-mcp python-dotenv

# Run
python examples/python-mcp-client.py
```

**Use case**: Data science, ETL pipelines, Python-based automation.

---

### **Option 3: Direct Import (No MCP)** (Most Flexible)

Import the `NetSuiteClient` class directly and bypass the MCP protocol.

See: [`direct-api-client.ts`](./direct-api-client.ts)

```bash
# Load environment and run
source .env.sb1
npx tsx examples/direct-api-client.ts
```

**Use case**: 
- Maximum performance (no MCP overhead)
- Custom applications
- Integration into existing Node.js projects

**Example code**:
```typescript
import { NetSuiteClient } from "./src/netsuite-client.js";

const client = new NetSuiteClient({
  accountId: process.env.NETSUITE_SB1_ACCOUNT_ID!,
  clientId: process.env.NETSUITE_SB1_CLIENT_ID!,
  certificateId: process.env.NETSUITE_SB1_CERTIFICATE_ID!,
  privateKey: process.env.NETSUITE_SB1_PRIVATE_KEY!,
});

// Query directly
const result = await client.runSuiteQL(
  "SELECT id, companyname FROM customer LIMIT 10"
);
```

---

## 📊 Comparison

| Method | Complexity | Use Case | AI Support |
|--------|-----------|----------|-----------|
| **AI Assistants** | ⭐ Easy | Interactive queries | ✅ Yes |
| **MCP Client** | ⭐⭐ Moderate | Automation, scripts | ❌ No |
| **Direct Import** | ⭐⭐⭐ Advanced | Custom apps | ❌ No |

---

## 🚀 Quick Start

### Run All Examples

```bash
# 1. Load environment variables
source .env.sb1

# 2. Run Node.js MCP client
npx tsx examples/mcp-client-example.ts

# 3. Run direct API client
npx tsx examples/direct-api-client.ts

# 4. Run Python MCP client (requires pip install)
python examples/python-mcp-client.py
```

---

## 🔧 Environment Setup

All examples require NetSuite credentials. Load from `.env.sb1`:

```bash
source .env.sb1
```

Or set manually:
```bash
export NETSUITE_SB1_ACCOUNT_ID="8526034_SB1"
export NETSUITE_SB1_CLIENT_ID="your-client-id"
export NETSUITE_SB1_CERTIFICATE_ID="your-cert-id"
export NETSUITE_SB1_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

---

## 📚 Learn More

- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [NetSuite SuiteQL Reference](../suiteql-reference.md)
- [Query Library](../suiteql-query-library.md)

