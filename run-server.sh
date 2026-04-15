#!/bin/bash

echo "=== Loading NetSuite Environment Variables ==="

# Load SB1 environment variables
if [ -f .env.sb1 ]; then
    echo "Loading SB1 configuration..."
    export NETSUITE_SB1_ACCOUNT_ID=$(grep NETSUITE_ACCOUNT_ID .env.sb1 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB1_CLIENT_ID=$(grep NETSUITE_CLIENT_ID .env.sb1 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB1_CERTIFICATE_ID=$(grep NETSUITE_CERTIFICATE_ID .env.sb1 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB1_PRIVATE_KEY=$(awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' .env.sb1 | grep -v '^#' | tr -d '"')
    echo "  ✓ SB1 Account: $NETSUITE_SB1_ACCOUNT_ID"
else
    echo "  ⚠ .env.sb1 not found - SB1 environment will not be available"
fi

# Load SB2 environment variables
if [ -f .env.sb2 ]; then
    echo "Loading SB2 configuration..."
    export NETSUITE_SB2_ACCOUNT_ID=$(grep NETSUITE_ACCOUNT_ID .env.sb2 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB2_CLIENT_ID=$(grep NETSUITE_CLIENT_ID .env.sb2 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB2_CERTIFICATE_ID=$(grep NETSUITE_CERTIFICATE_ID .env.sb2 | cut -d '=' -f2 | tr -d '"')
    export NETSUITE_SB2_PRIVATE_KEY=$(awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' .env.sb2 | grep -v '^#' | tr -d '"')
    echo "  ✓ SB2 Account: $NETSUITE_SB2_ACCOUNT_ID"
else
    echo "  ⚠ .env.sb2 not found - SB2 environment will not be available"
fi

# Set default environment (sb1 if available, otherwise sb2)
if [ -f .env.sb1 ]; then
    export NETSUITE_DEFAULT_ENV="sb1"
    echo "Default environment: sb1"
elif [ -f .env.sb2 ]; then
    export NETSUITE_DEFAULT_ENV="sb2"
    echo "Default environment: sb2"
else
    echo "ERROR: No environment files found!"
    exit 1
fi

echo ""
echo "=== Starting MCP NetSuite Server ==="
echo ""

# Run the server
npm start

