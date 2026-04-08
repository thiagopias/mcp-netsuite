# MCP NetSuite Logs

An MCP (Model Context Protocol) server that connects to NetSuite via OAuth 2.0 Client Credentials (M2M) to run SuiteQL queries, call RESTlets, and inspect script execution logs.

Supports multiple environments (e.g. sandbox + production) with a configurable default.

## Tools

| Tool | Description |
|------|-------------|
| `run_suiteql` | Execute any SuiteQL query with pagination and auto-fetch-all support |
| `call_restlet` | Call a custom RESTlet endpoint (GET/POST/PUT/DELETE) |
| `list_netsuite_tables` | List all queryable record types from the analytics catalog |
| `describe_netsuite_table` | Show columns for a table — uses OA_COLUMNS for standard tables, CustomField for custom records |
| `get_custom_record_types` | List all custom record types with their scriptId, internalId, name, and status |
| `get_record_metadata` | Get full OpenAPI/JSON Schema field definitions for a standard record type |
| `get_script_catalog` | List all deployed SuiteScripts with script type, ID, file, and deployment status |
| `get_script_logs` | Query script execution logs (the `scriptnote` table) by script, log level, and date |
| `get_transactions` | Query transactions with optional line items — supports filtering by type, entity, date, tranId, and more |
| `get_system_notes` | Query the audit log (`SystemNote`) for field-level change history on any record |
| `list_environments` | Show configured environments and the current default |

## Key Tables Reference

| Table | Purpose |
|-------|---------|
| `transaction` | All transaction types — differentiated by `type` (SalesOrd, CustInvc, CustDep, etc.) |
| `transactionline` | Line items — join to `transaction` via `transactionline.transaction = transaction.id`; filter `mainline = 'F'` for item lines |
| `classification` | Lines of Business (LOB) — referenced by `transactionline.class` |
| `scriptnote` | Script execution logs — fields: `internalid`, `scripttype`, `date`, `type`, `title`, `detail` |
| `CustomRecordType` | Custom record type metadata — uses `internalid` (not `id`) |
| `Script` / `ScriptDeployment` | Script and deployment definitions |

> See `suiteql-reference.md` for full field lists, known script IDs, and common query patterns.

## Prerequisites

### NetSuite Setup

1. **Create an Integration Record**
   - Go to **Setup > Integration > Manage Integrations > New**
   - Check **"Client Credentials (Machine to Machine) Grant"** on the OAuth 2.0 subtab
   - Save and copy the **Client ID**

2. **Generate a Certificate**
   ```bash
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
     -keyout private_key.pem -out certificate.pem -days 365 -nodes \
     -subj "/CN=mcp-netsuite"
   ```

3. **Upload Certificate & Create Mapping**
   - Go to **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup**
   - Create a new mapping: select the entity, role, and your integration
   - Upload `certificate.pem` (the public certificate)
   - Copy the generated **Certificate ID**

4. **Required Scopes**: `rest_webservices` and `restlets`

## Installation

```bash
npm install
npm run build
```

## Configuration

The server supports up to two named environments: `sb1` and `sb2`. Set variables for each environment you want to use.

| Variable | Description |
|----------|-------------|
| `NETSUITE_SB1_ACCOUNT_ID` | Account ID for sb1 (e.g. `1234567_SB1`) |
| `NETSUITE_SB1_CLIENT_ID` | Client ID for sb1 |
| `NETSUITE_SB1_CERTIFICATE_ID` | Certificate ID for sb1 |
| `NETSUITE_SB1_PRIVATE_KEY` | Private key PEM string for sb1 |
| `NETSUITE_SB2_ACCOUNT_ID` | Account ID for sb2 |
| `NETSUITE_SB2_CLIENT_ID` | Client ID for sb2 |
| `NETSUITE_SB2_CERTIFICATE_ID` | Certificate ID for sb2 |
| `NETSUITE_SB2_PRIVATE_KEY` | Private key PEM string for sb2 |
| `NETSUITE_DEFAULT_ENV` | Which environment to use by default (`sb1` or `sb2`) |

Only environments with all four variables set will be registered. The first registered environment becomes the default if `NETSUITE_DEFAULT_ENV` is not set.

## Usage with Claude Code / Cursor

Add to your MCP config (`.claude.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-netsuite-logs/dist/index.js"],
      "env": {
        "NETSUITE_SB2_ACCOUNT_ID": "1234567_SB2",
        "NETSUITE_SB2_CLIENT_ID": "your-client-id",
        "NETSUITE_SB2_CERTIFICATE_ID": "your-certificate-id",
        "NETSUITE_SB2_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
        "NETSUITE_DEFAULT_ENV": "sb2"
      }
    }
  }
}
```

To convert a PEM file to a single-line string for use in env vars:

```bash
node scripts/pem-to-oneline.mjs private_key.pem
```

## Example Queries

```sql
-- Recent transactions for a customer
SELECT t.tranid, BUILTIN.DF(t.type) AS type, t.trandate, t.amount
FROM transaction t
WHERE t.entity = 12345 AND t.voided = 'F'
ORDER BY t.trandate DESC
FETCH FIRST 20 ROWS ONLY

-- Sales order lines with LOB
SELECT t.tranid, tl.item, tl.quantity, tl.amount, BUILTIN.DF(tl.class) AS lob
FROM transaction t
INNER JOIN transactionline tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd' AND t.voided = 'F' AND tl.mainline = 'F'
ORDER BY t.trandate DESC

-- Script errors in the last 7 days
SELECT sn.date, sn.title, sn.detail
FROM scriptnote sn
WHERE sn.scripttype = 2670
  AND sn.type = 'ERROR'
  AND sn.date >= TO_DATE('2026-04-01', 'YYYY-MM-DD')
ORDER BY sn.date DESC

-- List active custom record types
SELECT internalid, scriptid, name
FROM CustomRecordType
WHERE isinactive = 'F'
ORDER BY name
```

## Authentication Flow

This server uses the **OAuth 2.0 Client Credentials (M2M)** flow with JWT assertion:

1. A JWT is signed with your private key (PS256 algorithm) and sent to NetSuite's token endpoint
2. NetSuite returns a Bearer access token (valid 60 min)
3. Tokens are cached per environment and automatically refreshed before expiry

## References

- [NetSuite OAuth 2.0 Client Credentials Flow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162730264820.html)
- [Executing SuiteQL Through REST Web Services](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157909186990.html)
- [SuiteQL SQL Functions Reference](suiteql-reference.md)
