#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NetSuiteClient } from "./netsuite-client.js";

type EnvId = "sb1" | "sb2";

interface EnvConfig {
  accountId: string;
  clientId: string;
  certificateId: string;
  privateKey: string;
}

const ENV_FIELDS = ["ACCOUNT_ID", "CLIENT_ID", "CERTIFICATE_ID", "PRIVATE_KEY"] as const;

function loadEnvConfig(prefix: string): EnvConfig | null {
  const vals: Record<string, string> = {};
  for (const field of ENV_FIELDS) {
    const key = `NETSUITE_${prefix}_${field}`;
    const val = process.env[key];
    if (!val) return null;
    vals[field] = val;
  }
  return {
    accountId: vals.ACCOUNT_ID,
    clientId: vals.CLIENT_ID,
    certificateId: vals.CERTIFICATE_ID,
    privateKey: vals.PRIVATE_KEY,
  };
}

const clients = new Map<EnvId, NetSuiteClient>();
const availableEnvs: EnvId[] = [];

for (const envId of ["sb1", "sb2"] as const) {
  const cfg = loadEnvConfig(envId.toUpperCase());
  if (cfg) {
    clients.set(envId, new NetSuiteClient(cfg));
    availableEnvs.push(envId);
  }
}

if (availableEnvs.length === 0) {
  console.error(
    "No NetSuite environments configured. " +
      "Set NETSUITE_SB1_* and/or NETSUITE_SB2_* environment variables."
  );
  process.exit(1);
}

const defaultEnv: EnvId =
  (process.env.NETSUITE_DEFAULT_ENV as EnvId) || availableEnvs[0];

function getClient(env?: string): { client: NetSuiteClient; envId: EnvId } {
  const envId = (env as EnvId) || defaultEnv;
  const client = clients.get(envId);
  if (!client) {
    throw new Error(
      `Environment "${envId}" is not configured. Available: ${availableEnvs.join(", ")}`
    );
  }
  return { client, envId };
}

const envParam = z
  .enum(["sb1", "sb2"])
  .optional()
  .describe(
    `Target NetSuite environment (available: ${availableEnvs.join(", ")}). ` +
      `Defaults to "${defaultEnv}".`
  );

const server = new McpServer({
  name: "mcp-netsuite-logs",
  version: "1.0.0",
});

server.tool(
  "run_suiteql",
  "Execute a SuiteQL query against NetSuite and return the results. " +
    "SuiteQL is SQL-based and supports SELECT, WHERE, JOIN, GROUP BY, ORDER BY, " +
    "subqueries, and functions like CONCAT, COALESCE, TO_DATE, etc. " +
    "Max 100,000 results per query. Always include ORDER BY for deterministic paging.",
  {
    query: z.string().describe(
      "The SuiteQL query to execute, e.g. SELECT id, companyname FROM customer WHERE isinactive = 'F' ORDER BY id"
    ),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Number of rows per page (max 1000, default 100)"),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Row offset for pagination (default 0)"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe(
        "If true, fetches all pages automatically. Use with caution on large result sets."
      ),
    environment: envParam,
  },
  async ({ query, limit, offset, fetchAll, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      if (fetchAll) {
        const result = await client.runSuiteQLAll(query, limit);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  environment: envId,
                  totalResults: result.totalResults,
                  pagesFetched: result.pagesFetched,
                  rowsReturned: result.items.length,
                  items: result.items,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await client.runSuiteQL(query, limit, offset);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                totalResults: result.totalResults,
                count: result.count,
                hasMore: result.hasMore,
                offset: result.offset,
                rowsReturned: result.items.length,
                items: result.items,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "call_restlet",
  "Call a NetSuite RESTlet endpoint. RESTlets are custom SuiteScript endpoints " +
    "deployed in NetSuite. You need the script ID and deploy ID to call them.",
  {
    scriptId: z
      .string()
      .describe("The script ID of the RESTlet (numeric string, e.g. '1234')"),
    deployId: z
      .string()
      .describe("The deploy ID of the RESTlet (numeric string, e.g. '1')"),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .default("GET")
      .describe("HTTP method (default GET)"),
    body: z
      .string()
      .optional()
      .describe(
        "JSON string to send as the request body (for POST/PUT). Will be parsed before sending."
      ),
    environment: envParam,
  },
  async ({ scriptId, deployId, method, body, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      let parsedBody: unknown;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'body' must be a valid JSON string",
              },
            ],
            isError: true,
          };
        }
      }

      const result = await client.callRestlet(
        scriptId,
        deployId,
        method,
        parsedBody
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { environment: envId, status: result.status, body: result.body },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_netsuite_tables",
  "List available NetSuite record types (tables) that can be queried with SuiteQL. " +
    "Returns table names from the OA_TABLES analytics data source.",
  {
    environment: envParam,
  },
  async ({ environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const result = await client.runSuiteQL(
        "SELECT tablename FROM OA_TABLES ORDER BY tablename",
        1000,
        0
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                totalTables: result.totalResults,
                tables: result.items.map(
                  (item) => item.tablename ?? item.TABLENAME
                ),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "describe_netsuite_table",
  "Describe the columns of a NetSuite record type (table) for SuiteQL queries. " +
    "Returns column names and data types.",
  {
    tableName: z
      .string()
      .describe(
        "The table name to describe, e.g. 'transaction', 'customer', 'employee'"
      ),
    environment: envParam,
  },
  async ({ tableName, environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const result = await client.runSuiteQL(
        `SELECT columnname, datatype FROM OA_COLUMNS WHERE tablename = '${tableName.toUpperCase()}' ORDER BY columnname`,
        1000,
        0
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                table: tableName,
                totalColumns: result.totalResults,
                columns: result.items,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_environments",
  "List the available NetSuite environments and which one is the default.",
  {},
  async () => {
    const envDetails = availableEnvs.map((envId) => ({
      id: envId,
      accountId: process.env[`NETSUITE_${envId.toUpperCase()}_ACCOUNT_ID`],
      isDefault: envId === defaultEnv,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { defaultEnvironment: defaultEnv, environments: envDetails },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `MCP NetSuite server running on stdio (environments: ${availableEnvs.join(", ")}, default: ${defaultEnv})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
