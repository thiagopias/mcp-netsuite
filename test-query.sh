#!/bin/bash

# Usage: ./test-query.sh [sb1|sb2]
# Default: sb2

ENV="${1:-sb2}"

echo "=== Testing NetSuite MCP Server ==="
echo "Environment: $ENV"
echo ""

# Load environment variables
if [ "$ENV" = "sb1" ]; then
    if [ -f .env.sb1 ]; then
        echo "Loading SB1 configuration..."
        set -a
        source .env.sb1
        set +a
        export NETSUITE_SB1_ACCOUNT_ID="$NETSUITE_ACCOUNT_ID"
        export NETSUITE_SB1_CLIENT_ID="$NETSUITE_CLIENT_ID"
        export NETSUITE_SB1_CERTIFICATE_ID="$NETSUITE_CERTIFICATE_ID"
        export NETSUITE_SB1_PRIVATE_KEY="$NETSUITE_PRIVATE_KEY"
        echo "  ✓ Account: $NETSUITE_SB1_ACCOUNT_ID"
        echo ""
    else
        echo "ERROR: .env.sb1 not found!"
        exit 1
    fi
else
    if [ -f .env.sb2 ]; then
        echo "Loading SB2 configuration..."
        set -a
        source .env.sb2
        set +a
        export NETSUITE_SB2_ACCOUNT_ID="$NETSUITE_ACCOUNT_ID"
        export NETSUITE_SB2_CLIENT_ID="$NETSUITE_CLIENT_ID"
        export NETSUITE_SB2_CERTIFICATE_ID="$NETSUITE_CERTIFICATE_ID"
        export NETSUITE_SB2_PRIVATE_KEY="$NETSUITE_PRIVATE_KEY"
        echo "  ✓ Account: $NETSUITE_SB2_ACCOUNT_ID"
        echo ""
    else
        echo "ERROR: .env.sb2 not found!"
        exit 1
    fi
fi

# Run OAuth debug first
echo "Running OAuth debug for $ENV..."
echo ""
npx tsx test-oauth-debug.ts
echo ""
echo "=================================="
echo ""

# Run the direct API client test
echo "Running direct API client test with $ENV..."
echo ""
npx tsx examples/direct-api-client.ts

