# MCP NetSuite Logs

An MCP (Model Context Protocol) server that connects to NetSuite via OAuth 2.0 Client Credentials (M2M) to run SuiteQL queries and call RESTlets.

## Tools

| Tool | Description |
|------|-------------|
| `run_suiteql` | Execute a SuiteQL query with pagination support |
| `call_restlet` | Call a custom RESTlet endpoint (GET/POST/PUT/DELETE) |
| `list_netsuite_tables` | List all queryable record types from the analytics data source |
| `describe_netsuite_table` | Show columns and data types for a specific table |

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

4. **Required Scopes**: The integration needs `rest_webservices` and `restlets` scopes.

## Installation

```bash
npm install
npm run build
```

## Configuration

Set these environment variables (or create a `.env` file based on `.env.example`):

| Variable | Description |
|----------|-------------|
| `NETSUITE_ACCOUNT_ID` | Your NetSuite account ID (e.g. `1234567` or `1234567_SB1`) |
| `NETSUITE_CLIENT_ID` | Client ID from the Integration Record |
| `NETSUITE_CERTIFICATE_ID` | Certificate ID from the M2M setup mapping |
| `NETSUITE_PRIVATE_KEY` | Private key as a PEM string (include BEGIN/END markers) |

## Usage with Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-netsuite-logs/dist/index.js"],
      "env": {
        "NETSUITE_ACCOUNT_ID": "your-account-id",
        "NETSUITE_CLIENT_ID": "your-client-id",
        "NETSUITE_CERTIFICATE_ID": "your-certificate-id",
        "NETSUITE_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
      }
    }
  }
}
```

## Example Queries

```sql
-- List all active customers
SELECT id, companyname, email FROM customer WHERE isinactive = 'F' ORDER BY id

-- Recent sales orders
SELECT t.tranid, t.trandate, tl.item, tl.amount
FROM transaction t
JOIN transactionline tl ON t.id = tl.transaction
WHERE t.type = 'SalesOrd' AND t.trandate > TO_DATE('2025-01-01', 'YYYY-MM-DD')
ORDER BY t.trandate DESC

-- Employee count by department
SELECT d.name AS department, COUNT(*) AS headcount
FROM employee e
JOIN department d ON e.department = d.id
WHERE e.isinactive = 'F'
GROUP BY d.name
ORDER BY headcount DESC
```

## Authentication Flow

This server uses the **OAuth 2.0 Client Credentials (M2M)** flow:

1. A JWT assertion is signed with your private key (ES256 algorithm)
2. The JWT is exchanged at NetSuite's token endpoint for a Bearer access token
3. The access token (valid 60 min) is used for all API calls
4. Tokens are cached and automatically refreshed before expiry

## References

- [NetSuite OAuth 2.0 Client Credentials Flow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162730264820.html)
- [Executing SuiteQL Through REST Web Services](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157909186990.html)
- [REST Web Services URL Schema](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1546938065.html)
