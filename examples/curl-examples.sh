#!/bin/bash

###############################################################################
# HTTP API Examples - Using curl to call the NetSuite HTTP wrapper
#
# First, start the HTTP wrapper server:
#   source .env.sb1
#   npx tsx examples/http-wrapper-server.ts
#
# Then run these curl commands in another terminal
###############################################################################

API_URL="http://localhost:3000/api"

echo "=== NetSuite HTTP API Examples ==="
echo ""

# 1. List environments
echo "1️⃣  List Environments"
curl -s "$API_URL/environments" | jq
echo ""

# 2. Run SuiteQL query
echo "2️⃣  Run SuiteQL Query (customers)"
curl -s -X POST "$API_URL/suiteql" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT id, companyname FROM customer WHERE isinactive = '\''F'\'' ORDER BY id",
    "limit": 5,
    "environment": "sb1"
  }' | jq
echo ""

# 3. Get all results (paginated)
echo "3️⃣  Run SuiteQL with Auto-Pagination"
curl -s -X POST "$API_URL/suiteql/all" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT id, type, title FROM scriptnote WHERE date >= CURRENT_DATE - 7 ORDER BY date DESC",
    "pageSize": 100,
    "environment": "sb1"
  }' | jq '.totalResults, .pagesFetched'
echo ""

# 4. Get record by ID
echo "4️⃣  Get Customer Record #123"
curl -s "$API_URL/record/customer/123?environment=sb1" | jq
echo ""

# 5. Get record metadata
echo "5️⃣  Get Customer Record Metadata (Schema)"
curl -s "$API_URL/metadata/customer?environment=sb1" | jq '.properties | keys | .[0:10]'
echo ""

# 6. Call a RESTlet
echo "6️⃣  Call a RESTlet"
curl -s -X POST "$API_URL/restlet" \
  -H "Content-Type: application/json" \
  -d '{
    "scriptId": "1234",
    "deployId": "1",
    "method": "GET",
    "environment": "sb1"
  }' | jq
echo ""

# 7. Complex SuiteQL query (transactions with joins)
echo "7️⃣  Complex Query: Transactions with Customer Names"
curl -s -X POST "$API_URL/suiteql" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT t.id, t.tranid, BUILTIN.DF(t.type) AS type, BUILTIN.DF(t.entity) AS customer, t.trandate, t.foreigntotal FROM Transaction t WHERE t.voided = '\''F'\'' AND t.trandate >= CURRENT_DATE - 30 ORDER BY t.trandate DESC",
    "limit": 10,
    "environment": "sb1"
  }' | jq
echo ""

# 8. Get custom record types
echo "8️⃣  Custom Record Types"
curl -s -X POST "$API_URL/suiteql" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT internalid, name, scriptid FROM CustomRecordType WHERE isinactive = '\''F'\'' ORDER BY name",
    "limit": 20,
    "environment": "sb1"
  }' | jq
echo ""

echo "✅ All examples completed!"

