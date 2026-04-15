#!/usr/bin/env node

/**
 * Example: HTTP Wrapper for MCP NetSuite Server
 * 
 * This creates a simple HTTP/REST API that wraps the NetSuiteClient,
 * allowing you to call it via standard HTTP requests instead of MCP protocol.
 * 
 * Use this if you want to:
 * - Call from languages without MCP SDK support
 * - Use with HTTP-based tools (curl, Postman, etc.)
 * - Expose NetSuite data via REST API
 * 
 * Installation:
 *   npm install express cors
 * 
 * Usage:
 *   source .env.sb1
 *   npx tsx examples/http-wrapper-server.ts
 *   
 *   # Then in another terminal:
 *   curl http://localhost:3000/api/environments
 *   curl -X POST http://localhost:3000/api/suiteql \
 *     -H "Content-Type: application/json" \
 *     -d '{"query": "SELECT id, companyname FROM customer LIMIT 5"}'
 */

import express from "express";
import cors from "cors";
import { NetSuiteClient } from "../src/netsuite-client.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize NetSuite clients for available environments
const clients: Record<string, NetSuiteClient> = {};

if (process.env.NETSUITE_SB1_ACCOUNT_ID) {
  clients.sb1 = new NetSuiteClient({
    accountId: process.env.NETSUITE_SB1_ACCOUNT_ID,
    clientId: process.env.NETSUITE_SB1_CLIENT_ID!,
    certificateId: process.env.NETSUITE_SB1_CERTIFICATE_ID!,
    privateKey: process.env.NETSUITE_SB1_PRIVATE_KEY!,
  });
}

if (process.env.NETSUITE_SB2_ACCOUNT_ID) {
  clients.sb2 = new NetSuiteClient({
    accountId: process.env.NETSUITE_SB2_ACCOUNT_ID,
    clientId: process.env.NETSUITE_SB2_CLIENT_ID!,
    certificateId: process.env.NETSUITE_SB2_CERTIFICATE_ID!,
    privateKey: process.env.NETSUITE_SB2_PRIVATE_KEY!,
  });
}

const defaultEnv = process.env.NETSUITE_DEFAULT_ENV || Object.keys(clients)[0];

// Helper to get client
function getClient(env?: string): NetSuiteClient {
  const envId = env || defaultEnv;
  const client = clients[envId];
  if (!client) {
    throw new Error(`Environment '${envId}' not configured`);
  }
  return client;
}

// Routes

// GET /api/environments
app.get("/api/environments", (req, res) => {
  res.json({
    defaultEnvironment: defaultEnv,
    environments: Object.keys(clients),
  });
});

// POST /api/suiteql
app.post("/api/suiteql", async (req, res) => {
  try {
    const { query, limit = 100, offset = 0, environment } = req.body;
    const client = getClient(environment);
    const result = await client.runSuiteQL(query, limit, offset);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/suiteql/all
app.post("/api/suiteql/all", async (req, res) => {
  try {
    const { query, pageSize = 1000, environment } = req.body;
    const client = getClient(environment);
    const result = await client.runSuiteQLAll(query, pageSize);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/record/:type/:id
app.get("/api/record/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const { expand, environment } = req.query;
    const client = getClient(environment as string);
    const result = await client.getRecord(type, id, expand === "true");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/metadata/:type
app.get("/api/metadata/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { environment } = req.query;
    const client = getClient(environment as string);
    const result = await client.getRecordMetadata(type);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/restlet
app.post("/api/restlet", async (req, res) => {
  try {
    const { scriptId, deployId, method = "GET", body, environment } = req.body;
    const client = getClient(environment);
    const result = await client.callRestlet(scriptId, deployId, method, body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 NetSuite HTTP API running on http://localhost:${PORT}`);
  console.log(`\n📍 Endpoints:`);
  console.log(`  GET  /api/environments`);
  console.log(`  POST /api/suiteql`);
  console.log(`  POST /api/suiteql/all`);
  console.log(`  GET  /api/record/:type/:id`);
  console.log(`  GET  /api/metadata/:type`);
  console.log(`  POST /api/restlet`);
  console.log(`\n🔧 Available environments: ${Object.keys(clients).join(", ")}`);
  console.log(`📦 Default environment: ${defaultEnv}\n`);
});

