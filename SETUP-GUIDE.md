# NetSuite MCP Server - Complete Setup Guide

This guide will walk you through setting up OAuth 2.0 authentication for the NetSuite MCP server.

## Prerequisites

- Access to NetSuite with Administrator role
- Node.js installed (v18 or higher)
- OpenSSL installed (comes with Git for Windows)

## Step 1: Create Integration Record in NetSuite

1. **Log in to NetSuite** with Administrator access

2. **Navigate to Integration Management:**
   - Go to: **Setup > Integration > Manage Integrations > New**

3. **Fill in the Integration Details:**
   - **Name:** `MCP NetSuite Server` (or any name you prefer)
   - **State:** `Enabled`
   - **Description:** `OAuth 2.0 integration for MCP server`

4. **Configure OAuth 2.0 Settings:**
   - Click on the **OAuth 2.0** tab
   - Check the box: **"Client Credentials (Machine to Machine) Grant"**
   - Under **Scope**, add:
     - `rest_webservices`
     - `restlets`

5. **Save the Integration**
   - Click **Save**
   - **IMPORTANT:** Copy the **Client ID** that appears after saving
   - You cannot view this again, so save it immediately!

## Step 2: Generate Certificate and Private Key

Open a terminal (PowerShell, Git Bash, or Command Prompt) and run:

```bash
# Navigate to your project directory
cd c:\Users\Thiago\Documents\repo\mcp-netsuite

# Generate the certificate and private key
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout private_key.pem -out certificate.pem -days 365 -nodes -subj "/CN=mcp-netsuite"
```

This creates two files:
- **`private_key.pem`** - Keep this secret! Never commit to Git
- **`certificate.pem`** - You'll upload this to NetSuite

## Step 3: Upload Certificate to NetSuite

1. **Navigate to OAuth 2.0 Client Credentials Setup:**
   - Go to: **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup**
   - Click **New**

2. **Create Certificate Mapping:**
   - **Application:** Select the integration you created in Step 1
   - **Entity:** Select the user/entity that will execute the requests
   - **Role:** Select the role with appropriate permissions (e.g., Administrator)
   - **Token Exchange:** Leave default settings

3. **Upload Certificate:**
   - Click **Choose File** under **Certificate**
   - Select the `certificate.pem` file you generated
   - Click **Save**

4. **Copy Certificate ID:**
   - After saving, you'll see a **Certificate ID** (looks like: `a1b2c3d4e5f6...`)
   - **Copy this ID** - you'll need it for configuration

## Step 4: Configure Environment Variables

### Option A: For Local Testing (using .env files)

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env.sb1
   ```

2. **Edit `.env.sb1`** with your credentials:
   ```bash
   NETSUITE_SB1_ACCOUNT_ID=1234567_SB1
   NETSUITE_SB1_CLIENT_ID=your-client-id-from-step-1
   NETSUITE_SB1_CERTIFICATE_ID=your-certificate-id-from-step-3
   NETSUITE_SB1_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_KEY\n-----END PRIVATE KEY-----
   NETSUITE_DEFAULT_ENV=sb1
   ```

3. **Convert private key to single line:**
   ```bash
   # On Windows PowerShell:
   node -e "console.log((require('fs').readFileSync('private_key.pem', 'utf8')).replace(/\n/g, '\\n'))"
   ```
   Copy the output and paste it as the value for `NETSUITE_SB1_PRIVATE_KEY`

### Option B: For Cursor/Claude IDE (MCP configuration)

1. **Create or edit** `.cursor/mcp.json` (for Cursor) or `.claude.json` (for Claude Desktop):

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "node",
      "args": ["C:/Users/Thiago/Documents/repo/mcp-netsuite/dist/index.js"],
      "env": {
        "NETSUITE_SB1_ACCOUNT_ID": "1234567_SB1",
        "NETSUITE_SB1_CLIENT_ID": "your-client-id-here",
        "NETSUITE_SB1_CERTIFICATE_ID": "your-certificate-id-here",
        "NETSUITE_SB1_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
        "NETSUITE_DEFAULT_ENV": "sb1"
      }
    }
  }
}
```

## Step 5: Build and Test

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Test the connection:**
   ```bash
   # If using .env files:
   ./mcp-query.sh environments
   
   # Or test with the TypeScript client:
   npx tsx mcp-client-shell.ts list-tools
   ```

4. **Run a test query:**
   ```bash
   ./mcp-query.sh sql "SELECT id, companyname FROM customer LIMIT 5"
   ```

## Troubleshooting

### "OAuth token request failed"
- Verify your Client ID, Certificate ID, and Account ID are correct
- Make sure the certificate was uploaded correctly in NetSuite
- Check that the private key matches the certificate
- Ensure the integration is enabled in NetSuite

### "Permission denied" or "Insufficient permissions"
- The role assigned in the OAuth 2.0 mapping must have:
  - SuiteAnalytics Workbook access
  - REST Web Services permissions
  - RESTlet permissions

### "Module not found" or "Command not found"
- Run `npm install` to install dependencies
- Run `npm run build` to compile TypeScript to JavaScript
- Make sure you're using Node.js v18 or higher

## Security Best Practices

1. **Never commit credentials to Git:**
   - `.env` files are already in `.gitignore`
   - Be careful with MCP configuration files

2. **Rotate certificates regularly:**
   - Generate new certificates every 6-12 months
   - Update both NetSuite and your configuration

3. **Use different credentials for sandbox vs production:**
   - Keep sandbox and production credentials separate
   - Use `sb1` for sandbox, `sb2` for production (or another sandbox)

## Next Steps

- Read `MCP-CLIENT-GUIDE.md` for usage examples
- Check `README.md` for available tools and queries
- Review `suiteql-reference.md` for SuiteQL syntax and examples

## Need Help?

If you encounter issues:
1. Check the NetSuite OAuth 2.0 documentation
2. Verify your role has the required permissions
3. Test with the shell scripts before trying MCP clients
4. Review the error messages carefully - they often indicate what's wrong
