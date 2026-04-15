#!/bin/bash

###############################################################################
# MCP Query Tool - Easy shell interface to NetSuite MCP Server
#
# This script provides a simple command-line interface to query NetSuite
# via the MCP server using the official MCP SDK client.
#
# Usage:
#   ./mcp-query.sh list-tools
#   ./mcp-query.sh environments
#   ./mcp-query.sh customers
#   ./mcp-query.sh transactions
#   ./mcp-query.sh logs
#   ./mcp-query.sh sql "SELECT * FROM customer LIMIT 5"
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env.sb1 ]; then
    set -a
    source .env.sb1
    set +a
    export NETSUITE_SB1_ACCOUNT_ID="$NETSUITE_ACCOUNT_ID"
    export NETSUITE_SB1_CLIENT_ID="$NETSUITE_CLIENT_ID"
    export NETSUITE_SB1_CERTIFICATE_ID="$NETSUITE_CERTIFICATE_ID"
    export NETSUITE_SB1_PRIVATE_KEY="$NETSUITE_PRIVATE_KEY"
fi

if [ -f .env.sb2 ]; then
    set -a
    source .env.sb2
    set +a
    export NETSUITE_SB2_ACCOUNT_ID="$NETSUITE_ACCOUNT_ID"
    export NETSUITE_SB2_CLIENT_ID="$NETSUITE_CLIENT_ID"
    export NETSUITE_SB2_CERTIFICATE_ID="$NETSUITE_CERTIFICATE_ID"
    export NETSUITE_SB2_PRIVATE_KEY="$NETSUITE_PRIVATE_KEY"
fi

export NETSUITE_DEFAULT_ENV="${NETSUITE_DEFAULT_ENV:-sb1}"

# Functions
print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Main command handler
COMMAND="${1:-help}"

case "$COMMAND" in
    help)
        echo "MCP Query Tool - NetSuite Interface"
        echo ""
        echo "Usage: ./mcp-query.sh <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  help              Show this help message"
        echo "  list-tools        List all available MCP tools"
        echo "  environments      Get configured NetSuite environments"
        echo "  customers         Query recent customers"
        echo "  transactions      Query recent transactions"
        echo "  logs              Get script execution logs"
        echo "  sql \"<query>\"     Run custom SuiteQL query"
        echo "  custom <tool> <args>  Call any MCP tool with JSON arguments"
        echo ""
        echo "Examples:"
        echo "  ./mcp-query.sh customers"
        echo "  ./mcp-query.sh sql \"SELECT id, companyname FROM customer LIMIT 10\""
        echo "  ./mcp-query.sh transactions"
        echo "  ./mcp-query.sh custom get_record '{\"type\":\"customer\",\"id\":\"123\"}'"
        ;;

    list-tools)
        print_header "Available MCP Tools"
        npx tsx mcp-client-shell.ts list-tools
        ;;

    environments)
        print_header "NetSuite Environments"
        npx tsx mcp-client-shell.ts get-environments
        ;;

    customers)
        print_header "Recent Customers"
        QUERY="SELECT id, companyname, email, phone FROM customer WHERE isinactive = 'F' ORDER BY id DESC LIMIT 10"
        npx tsx mcp-client-shell.ts run-suiteql "$QUERY"
        ;;

    transactions)
        print_header "Recent Transactions"
        npx tsx mcp-client-shell.ts get-transactions
        ;;

    logs)
        print_header "Script Execution Logs"
        npx tsx mcp-client-shell.ts get-script-logs
        ;;

    sql)
        if [ -z "$2" ]; then
            print_error "SQL query required"
            echo "Usage: ./mcp-query.sh sql \"SELECT ...\" [limit] [environment]"
            exit 1
        fi
        LIMIT="${3:-100}"
        ENV="${4:-sb1}"
        print_header "Custom SuiteQL Query (Environment: $ENV)"
        npx tsx mcp-client-shell.ts run-suiteql "$2" "$LIMIT" "$ENV"
        ;;

    custom)
        if [ -z "$2" ]; then
            print_error "Tool name required"
            echo "Usage: ./mcp-query.sh custom <tool-name> '{\"args\":\"...\"}'"
            exit 1
        fi
        TOOL_NAME="$2"
        TOOL_ARGS="${3:-{}}"
        print_header "Calling Tool: $TOOL_NAME"
        npx tsx mcp-client-shell.ts call-tool "$TOOL_NAME" "$TOOL_ARGS"
        ;;

    *)
        print_error "Unknown command: $COMMAND"
        echo "Run './mcp-query.sh help' for usage information"
        exit 1
        ;;
esac

