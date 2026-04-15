#!/bin/bash

echo "🔍 MCP Server Status Check"
echo "=" | tr -d '\n' | while read -n 1; do echo -n "="; done
printf "%.0s=" {1..60}
echo ""
echo ""

# 1. Check if MCP config exists
echo "1️⃣  Checking MCP Configuration..."
if [ -f ".cursor/mcp.json" ]; then
    echo "   ✅ .cursor/mcp.json exists"
    echo ""
    echo "   Configuration:"
    cat .cursor/mcp.json | head -20
    echo ""
else
    echo "   ❌ .cursor/mcp.json NOT FOUND"
    echo "   MCP server won't be available to Cursor/Augment"
    exit 1
fi

# 2. Check if server code is built
echo ""
echo "2️⃣  Checking Server Build..."
if [ -f "dist/index.js" ]; then
    echo "   ✅ dist/index.js exists (server is built)"
    echo "   Build date: $(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" dist/index.js)"
else
    echo "   ❌ dist/index.js NOT FOUND"
    echo "   Run: npm run build"
    exit 1
fi

# 3. Check environment variables in config
echo ""
echo "3️⃣  Checking Environment Variables in MCP Config..."
if grep -q "NETSUITE_SB1_ACCOUNT_ID" .cursor/mcp.json; then
    echo "   ✅ SB1 credentials found in config"
fi
if grep -q "NETSUITE_SB2_ACCOUNT_ID" .cursor/mcp.json; then
    echo "   ✅ SB2 credentials found in config"
fi

# 4. Check if server can start
echo ""
echo "4️⃣  Testing Server Startup..."
echo "   Attempting to start server with timeout..."

# Load env from config and try to start server briefly
export NETSUITE_SB1_ACCOUNT_ID="8526034_SB1"
export NETSUITE_SB1_CLIENT_ID="test"
export NETSUITE_SB1_CERTIFICATE_ID="test"
export NETSUITE_SB1_PRIVATE_KEY="test"

timeout 2 node dist/index.js 2>&1 | head -5 &
sleep 1
if [ $? -eq 124 ]; then
    echo "   ✅ Server starts (timed out as expected)"
else
    echo "   ⚠️  Server exited quickly (might be an error)"
fi

# 5. Check for running MCP processes
echo ""
echo "5️⃣  Checking for Running MCP Processes..."
MCP_PROCS=$(ps aux | grep "dist/index.js" | grep -v grep)
if [ -n "$MCP_PROCS" ]; then
    echo "   ✅ MCP server process found:"
    echo "$MCP_PROCS" | awk '{print "      PID: " $2 " | " $11 " " $12 " " $13}'
else
    echo "   ⚠️  No MCP server process currently running"
    echo "   (This is normal - Cursor starts it on demand)"
fi

# 6. Check Cursor processes
echo ""
echo "6️⃣  Checking Cursor Processes..."
CURSOR_PROCS=$(ps aux | grep -i cursor | grep -v grep | wc -l)
if [ $CURSOR_PROCS -gt 0 ]; then
    echo "   ✅ Cursor is running ($CURSOR_PROCS processes)"
else
    echo "   ❌ Cursor doesn't appear to be running"
    echo "   Please start Cursor IDE"
fi

echo ""
echo "=" | tr -d '\n' | while read -n 1; do echo -n "="; done
printf "%.0s=" {1..60}
echo ""
echo ""
echo "📋 Summary & Next Steps:"
echo ""
echo "If all checks passed:"
echo "  1. Restart Cursor completely (Cmd+Q, then reopen)"
echo "  2. Wait 5-10 seconds for MCP server to initialize"
echo "  3. Ask Augment: 'List NetSuite environments'"
echo ""
echo "If MCP tools still don't appear:"
echo "  1. Check Cursor's MCP status panel"
echo "  2. Look for error messages in Cursor's console"
echo "  3. Check: View > Output > MCP"
echo ""
echo "To manually test the server works:"
echo "  ./run-server.sh"
echo ""

