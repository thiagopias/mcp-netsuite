#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NetSuiteClient } from "./netsuite-client.js";
import { spawn } from "child_process";
import { mkdtemp, mkdir, writeFile, rm, copyFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

type EnvId = "sb1" | "sb2" | "prod";

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

for (const envId of ["sb1", "sb2", "prod"] as const) {
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

/** Validate that a name is safe to interpolate into SuiteQL (alphanumeric + underscore only). */
function validateIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid ${label}: "${name}". Only alphanumeric characters and underscores are allowed.`);
  }
}

const envParam = z
  .enum(["sb1", "sb2", "prod"])
  .optional()
  .describe(
    `Target NetSuite environment (available: ${availableEnvs.join(", ")}). ` +
      `Defaults to "${defaultEnv}".`
  );

/** Run `suitecloud file:upload --paths <filePath>` from a project directory. */
function runSuiteCloudUpload(projectDir: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("suitecloud", ["file:upload", "--paths", filePath], {
      cwd: projectDir,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code: number | null) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (code === 0) {
        resolve(combined || "Upload completed successfully.");
      } else {
        reject(new Error(`suitecloud file:upload exited with code ${code}: ${combined}`));
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(
        `Failed to launch suitecloud CLI: ${err.message}. ` +
        "Ensure @oracle/suitecloud-cli is installed globally: npm install -g @oracle/suitecloud-cli"
      ));
    });
  });
}

const server = new McpServer({
  name: "mcp-netsuite-logs",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// run_suiteql
// ---------------------------------------------------------------------------
server.tool(
  "run_suiteql",
  "Execute a SuiteQL query against NetSuite and return the results. " +
    "SuiteQL is SQL-based and supports SELECT, WHERE, JOIN, GROUP BY, ORDER BY, " +
    "subqueries, and functions like CONCAT, COALESCE, TO_DATE, BUILTIN.DF(), etc. " +
    "IMPORTANT: Do NOT use LIMIT or OFFSET clauses in the SQL string — they are silently ignored. " +
    "Use the 'limit' and 'offset' parameters of this tool instead. " +
    "To cap rows within the query itself, use 'FETCH FIRST N ROWS ONLY' (e.g. FETCH FIRST 10 ROWS ONLY). " +
    "Max 100,000 results per query. Always include ORDER BY for deterministic paging. " +
    "Use BUILTIN.DF(fieldId) to get the display/text value of list/record fields.",
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

// ---------------------------------------------------------------------------
// call_restlet
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// list_netsuite_tables
// ---------------------------------------------------------------------------
server.tool(
  "list_netsuite_tables",
  "List available NetSuite record types (tables) that can be queried with SuiteQL. " +
    "Queries the OA_TABLES analytics catalog (may not be available in all environments). " +
    "For custom record types, use get_custom_record_types instead.",
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

// ---------------------------------------------------------------------------
// describe_netsuite_table
// ---------------------------------------------------------------------------
server.tool(
  "describe_netsuite_table",
  "Describe the columns of a NetSuite record type (table) for SuiteQL queries. " +
    "For standard tables (customer, transaction, employee, etc.) queries the OA_COLUMNS catalog. " +
    "For custom record types (names starting with 'customrecord_'), queries the CustomField table " +
    "directly — this is reliable and works even when OA_COLUMNS is unavailable. " +
    "For the richest field schema on standard records, use get_record_metadata instead.",
  {
    tableName: z
      .string()
      .describe(
        "The table name to describe, e.g. 'transaction', 'customer', 'employee', or 'customrecord_my_type'"
      ),
    environment: envParam,
  },
  async ({ tableName, environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const normalizedName = tableName.trim().toLowerCase();
      validateIdentifier(normalizedName, "tableName");

      if (normalizedName.startsWith("customlist_")) {
        // Custom list: fetch metadata from customlist table + values from the list's own table
        const metaResult = await client.runSuiteQL(
          `SELECT internalid, name, scriptid, isordered, isinactive, lastmodifieddate ` +
            `FROM CustomList WHERE UPPER(scriptid) = '${normalizedName.toUpperCase()}'`,
          1,
          0
        );

        if (metaResult.items.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Error: Custom list '${tableName}' not found. ` +
                  `Use run_suiteql to list available lists: SELECT name, scriptid FROM CustomList WHERE isinactive = 'F' ORDER BY name`,
              },
            ],
            isError: true,
          };
        }

        const meta = metaResult.items[0];
        const valuesResult = await client.runSuiteQL(
          `SELECT id, name, isinactive FROM ${normalizedName} ORDER BY id`,
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
                  type: "customList",
                  name: meta.name,
                  scriptId: meta.scriptid,
                  internalId: meta.internalid,
                  isOrdered: meta.isordered,
                  isInactive: meta.isinactive,
                  lastModified: meta.lastmodifieddate,
                  totalValues: valuesResult.totalResults,
                  values: valuesResult.items,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (normalizedName.startsWith("customrecord_")) {
        // Custom record type: use CustomRecordType + CustomField tables
        const typeResult = await client.runSuiteQL(
          `SELECT internalid, name, scriptid, description FROM CustomRecordType WHERE LOWER(scriptid) = '${normalizedName}' AND isinactive = 'F'`,
          10,
          0
        );

        if (typeResult.items.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Error: Custom record type '${tableName}' not found or is inactive. ` +
                  `Use get_custom_record_types to list all available custom record types.`,
              },
            ],
            isError: true,
          };
        }

        const recordType = typeResult.items[0];
        const recordTypeId = recordType.internalid;

        const fieldsResult = await client.runSuiteQL(
          `SELECT name, scriptid, fieldvaluetype, fieldvaluetyperecord, isinactive ` +
            `FROM CustomField WHERE recordtype = ${recordTypeId} ORDER BY name`,
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
                  type: "customRecord",
                  name: recordType.name,
                  scriptId: recordType.scriptid,
                  internalId: recordTypeId,
                  description: recordType.description,
                  totalFields: fieldsResult.totalResults,
                  fields: fieldsResult.items,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Standard table: use OA_COLUMNS (SuiteAnalytics Connect catalog)
      const upperName = normalizedName.toUpperCase();
      const result = await client.runSuiteQL(
        `SELECT columnname, datatype FROM OA_COLUMNS WHERE tablename = '${upperName}' ORDER BY columnname`,
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
                tip: "For richer field schema (labels, required flags, allowed values), use get_record_metadata.",
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

// ---------------------------------------------------------------------------
// get_custom_record_types
// ---------------------------------------------------------------------------
server.tool(
  "get_custom_record_types",
  "List all custom record types defined in NetSuite. " +
    "Returns the ScriptID (used in SuiteQL queries and SuiteScript), InternalID, name, and description. " +
    "Use the ScriptID as the table name in SuiteQL queries (e.g. SELECT id FROM customrecord_my_type). " +
    "Use describe_netsuite_table with the ScriptID to get the field list.",
  {
    includeInactive: z
      .boolean()
      .default(false)
      .describe("If true, includes inactive custom record types"),
    environment: envParam,
  },
  async ({ includeInactive, environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const whereClause = includeInactive ? "" : " WHERE isinactive = 'F'";
      const result = await client.runSuiteQL(
        `SELECT internalid, name, scriptid, description, isinactive, allowquicksearch, allowinlineediting ` +
          `FROM CustomRecordType${whereClause} ORDER BY name`,
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
                totalTypes: result.totalResults,
                customRecordTypes: result.items,
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

// ---------------------------------------------------------------------------
// get_script_logs
// ---------------------------------------------------------------------------
server.tool(
  "get_script_logs",
  "Query the NetSuite scriptnote table — the execution log for all SuiteScripts. " +
    "Returns log entries (DEBUG, AUDIT, ERROR, EMERGENCY) written by scripts via nlapiLogExecution or N/log. " +
    "Filter by script internal ID or script ID string, log level, and date range. " +
    "Known script internal IDs: " +
    "2670 = CU|SL|Get Grading Certificates UI (customscript_cu_sl_get_certificates_ui), " +
    "2671 = CU|MR|Retrieve Grading Certificates (customscript_cu_mr_retrieve_grading_cert), " +
    "2669 = CU|UE|Show Get Certificates Button (customscript_cu_ue_get_grading_certs_btn). " +
    "scriptnote fields: internalid, scripttype (script internal ID), date, type (log level), title, detail.",
  {
    scriptInternalId: z
      .number()
      .optional()
      .describe("Internal ID of the script to filter by (e.g. 2670 for the Grading Certificates Suitelet)"),
    scriptId: z
      .string()
      .optional()
      .describe("Script ID string (e.g. 'customscript_cu_sl_get_certificates_ui') — will be resolved to internal ID automatically"),
    logType: z
      .enum(["DEBUG", "AUDIT", "ERROR", "EMERGENCY"])
      .optional()
      .describe("Filter by log level. Omit to return all levels."),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date filter in YYYY-MM-DD format"),
    dateTo: z
      .string()
      .optional()
      .describe("End date filter in YYYY-MM-DD format"),
    limit: z.number().min(1).max(1000).default(50).describe("Number of rows per page (max 1000)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    fetchAll: z.boolean().default(false).describe("If true, fetches all pages automatically. Use with caution on large result sets."),
    environment: envParam,
  },
  async ({ scriptInternalId, scriptId, logType, dateFrom, dateTo, limit, offset, fetchAll, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      let resolvedScriptId = scriptInternalId;

      if (!resolvedScriptId && scriptId) {
        validateIdentifier(scriptId.replace(/[^A-Za-z0-9_]/g, "_"), "scriptId");
        const lookup = await client.runSuiteQL(
          `SELECT id FROM Script WHERE LOWER(scriptid) = LOWER('${scriptId.replace(/'/g, "''")}')`,
          1,
          0
        );
        if (lookup.items.length === 0) {
          return {
            content: [{ type: "text" as const, text: `Error: Script '${scriptId}' not found.` }],
            isError: true,
          };
        }
        resolvedScriptId = Number(lookup.items[0].id);
      }

      const conditions: string[] = [];
      if (resolvedScriptId !== undefined) conditions.push(`sn.scripttype = ${resolvedScriptId}`);
      if (logType) conditions.push(`sn.type = '${logType}'`);
      if (dateFrom) conditions.push(`sn.date >= TO_DATE('${dateFrom}', 'YYYY-MM-DD')`);
      if (dateTo) conditions.push(`sn.date <= TO_DATE('${dateTo}', 'YYYY-MM-DD')`);

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const query =
        `SELECT sn.internalid, sn.date, sn.type, sn.title, sn.detail, ` +
        `s.name AS scriptName, s.scriptid AS scriptScriptId ` +
        `FROM scriptnote sn ` +
        `INNER JOIN Script s ON s.id = sn.scripttype ` +
        `${whereClause} ` +
        `ORDER BY sn.date DESC`;

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
                  logs: result.items,
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
                logs: result.items,
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

// ---------------------------------------------------------------------------
// get_record_metadata
// ---------------------------------------------------------------------------
server.tool(
  "get_record_metadata",
  "Get the full field schema for a standard NetSuite record type using the REST metadata catalog. " +
    "Returns an OpenAPI/JSON Schema document with all fields, their types, labels, required status, " +
    "and allowed values for enum/list fields. " +
    "Use this when you need to know the exact field names for SuiteScript or REST API calls. " +
    "Common record types: customer, vendor, employee, invoice, salesorder, purchaseorder, " +
    "journalentry, contact, item, inventoryitem, assemblyitem.",
  {
    recordType: z
      .string()
      .describe(
        "The record type name as used in the REST API, e.g. 'customer', 'invoice', 'salesorder', 'vendor', 'employee'"
      ),
    environment: envParam,
  },
  async ({ recordType, environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const metadata = await client.getRecordMetadata(recordType);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ environment: envId, recordType, metadata }, null, 2),
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

// ---------------------------------------------------------------------------
// get_script_catalog
// ---------------------------------------------------------------------------
server.tool(
  "get_script_catalog",
  "List all SuiteScripts deployed in NetSuite with their script type, ID, file, and deployment status. " +
    "Joins the Script, ScriptDeployment, and File tables. " +
    "Essential for finding existing script IDs when building integrations or calling RESTlets. " +
    "Script types: USEREVENT, SCHEDULED, SUITELET, RESTLET, CLIENTSCRIPT, MAPREDUCE, " +
    "PORTLET, WORKFLOWACTIONSCRIPT, MASSUPDATESCRIPT.",
  {
    scriptType: z
      .string()
      .optional()
      .describe(
        "Filter by script type, e.g. 'RESTLET', 'SCHEDULED', 'SUITELET', 'USEREVENT', 'CLIENTSCRIPT', 'MAPREDUCE'"
      ),
    includeInactive: z
      .boolean()
      .default(false)
      .describe("If true, includes inactive scripts"),
    limit: z.number().min(1).max(1000).default(100).describe("Number of rows per page (max 1000)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    environment: envParam,
  },
  async ({ scriptType, includeInactive, limit, offset, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      const conditions: string[] = [];
      if (!includeInactive) conditions.push("s.isinactive = 'F'");
      if (scriptType) {
        validateIdentifier(scriptType, "scriptType");
        conditions.push(`UPPER(s.scripttype) = '${scriptType.toUpperCase()}'`);
      }
      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

      const query =
        `SELECT ` +
        `s.id AS scriptInternalId, ` +
        `s.name AS scriptName, ` +
        `s.scriptid AS scriptId, ` +
        `BUILTIN.DF(s.scripttype) AS scriptType, ` +
        `s.scripttype AS scriptTypeCode, ` +
        `s.description, ` +
        `BUILTIN.DF(s.owner) AS owner, ` +
        `f.name AS fileName, ` +
        `f.lastmodifieddate AS fileLastModified, ` +
        `sd.id AS deploymentInternalId, ` +
        `sd.deploymentid AS deploymentId, ` +
        `BUILTIN.DF(sd.status) AS deployStatus, ` +
        `sd.isdeployed, ` +
        `BUILTIN.DF(sd.recordtype) AS deployRecordType ` +
        `FROM Script s ` +
        `INNER JOIN File f ON f.id = s.scriptfile ` +
        `INNER JOIN ScriptDeployment sd ON sd.script = s.id` +
        `${whereClause} ` +
        `ORDER BY f.lastmodifieddate DESC, s.name`;

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
                scripts: result.items,
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

// ---------------------------------------------------------------------------
// get_transactions
// ---------------------------------------------------------------------------
server.tool(
  "get_transactions",
  "Query NetSuite transactions (sales orders, invoices, payments, etc.) from the unified Transaction table. " +
    "All transaction types share this table, differentiated by the 'type' field. " +
    "Common type codes: SalesOrd (Sales Order), CustInvc (Invoice), CustDep (Customer Deposit), " +
    "CustPymt (Customer Payment), CashSale (Cash Sale), CustCred (Credit Memo), " +
    "CustRfnd (Customer Refund), PurchOrd (Purchase Order), VendBill (Vendor Bill), " +
    "ItemRcpt (Item Receipt), RtnAuth (Return Authorization), Journal (Journal Entry), " +
    "TrnfrOrd (Transfer Order). " +
    "Key custom fields on transaction: custbody_cu_marketplace (marketplace internal ID), " +
    "custbody_cu_originating_ctpr (originating counterpart internal ID). " +
    "TransactionLine fields include: class (LOB/classification internal ID), department, location, " +
    "subsidiary, item, quantity, rate, amount, taxamount, mainline (filter mainline='F' for item lines). " +
    "classification table (LOB): id, name, fullname, subsidiary, custrecord_collectors_lob_code. " +
    "Set includeLines=true to also return TransactionLine items for each transaction.",
  {
    transactionType: z
      .string()
      .optional()
      .describe(
        "Transaction type code to filter by, e.g. 'SalesOrd', 'CustInvc', 'CustDep', 'CustPymt', 'PurchOrd', 'VendBill'. Leave empty for all types."
      ),
    entityId: z
      .number()
      .optional()
      .describe("Internal ID of the entity (customer/vendor) to filter by"),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date filter in YYYY-MM-DD format (inclusive)"),
    dateTo: z
      .string()
      .optional()
      .describe("End date filter in YYYY-MM-DD format (inclusive)"),
    internalId: z
      .number()
      .optional()
      .describe("Internal ID of the transaction record (t.id). Fastest lookup — use when you have the NetSuite internal ID."),
    externalId: z
      .string()
      .optional()
      .describe("External ID of the transaction (t.externalid). Used when transactions are created via integration with a third-party ID."),
    tranId: z
      .string()
      .optional()
      .describe("Transaction document number as shown in the UI (e.g. 'SO-12345', 'INV-1001'). Case-insensitive match."),
    status: z
      .string()
      .optional()
      .describe("Filter by status code (e.g. 'SalesOrd:A' for open sales orders). Use run_suiteql on Transaction to discover available status codes."),
    subsidiary: z
      .number()
      .optional()
      .describe("Internal ID of the subsidiary to filter by."),
    marketplace: z
      .number()
      .optional()
      .describe("Internal ID from customlist_cu_marketplace to filter by custbody_cu_marketplace (e.g. 1=ebay, 2=Goldin, 8=Instant Offer)."),
    includeLines: z
      .boolean()
      .default(false)
      .describe(
        "If true, performs a second query to fetch TransactionLine items and attaches them to each transaction"
      ),
    limit: z.number().min(1).max(1000).default(50).describe("Number of transactions per page (max 1000)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    environment: envParam,
  },
  async ({ transactionType, entityId, dateFrom, dateTo, internalId, externalId, tranId, status, subsidiary, marketplace, includeLines, limit, offset, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      const conditions: string[] = ["t.voided = 'F'"];
      if (internalId !== undefined) {
        conditions.push(`t.id = ${internalId}`);
      }
      if (externalId) {
        conditions.push(`LOWER(t.externalid) = LOWER('${externalId.replace(/'/g, "''")}')`);
      }
      if (tranId) {
        conditions.push(`LOWER(t.tranid) = LOWER('${tranId.replace(/'/g, "''")}')`);
      }
      if (transactionType) {
        validateIdentifier(transactionType, "transactionType");
        conditions.push(`t.type = '${transactionType}'`);
      }
      if (entityId !== undefined) {
        conditions.push(`t.entity = ${entityId}`);
      }
      if (dateFrom) {
        conditions.push(`t.trandate >= TO_DATE('${dateFrom}', 'YYYY-MM-DD')`);
      }
      if (dateTo) {
        conditions.push(`t.trandate <= TO_DATE('${dateTo}', 'YYYY-MM-DD')`);
      }
      if (status) {
        conditions.push(`t.status = '${status.replace(/'/g, "''")}'`);
      }
      if (subsidiary !== undefined) {
        conditions.push(`t.subsidiary = ${subsidiary}`);
      }
      if (marketplace !== undefined) {
        conditions.push(`t.custbody_cu_marketplace = ${marketplace}`);
      }
      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const headerQuery =
        `SELECT ` +
        `t.id, ` +
        `BUILTIN.DF(t.type) AS typeName, ` +
        `t.type, ` +
        `t.tranid AS transactionNumber, ` +
        `BUILTIN.DF(t.entity) AS entityName, ` +
        `t.entity, ` +
        `t.trandate, ` +
        `BUILTIN.DF(t.status) AS statusName, ` +
        `t.status, ` +
        `t.foreigntotal, ` +
        `BUILTIN.DF(t.currency) AS currency, ` +
        `BUILTIN.DF(t.terms) AS paymentTerms, ` +
        `t.duedate, ` +
        `t.closedate, ` +
        `t.memo, ` +
        `t.lastmodifieddate, ` +
        `BUILTIN.DF(t.createdby) AS createdBy ` +
        `FROM Transaction t ` +
        `${whereClause} ` +
        `ORDER BY t.trandate DESC, t.id DESC`;

      const headerResult = await client.runSuiteQL(headerQuery, limit, offset);
      const transactions = headerResult.items;

      if (includeLines && transactions.length > 0) {
        const transactionIds = transactions.map((t) => t.id).join(", ");
        const linesQuery =
          `SELECT ` +
          `tl.transaction, ` +
          `tl.id AS lineId, ` +
          `tl.linesequencenumber AS lineNumber, ` +
          `BUILTIN.DF(tl.item) AS itemName, ` +
          `tl.item, ` +
          `tl.quantity, ` +
          `tl.rate, ` +
          `tl.amount, ` +
          `tl.memo AS description, ` +
          `tl.taxamount, ` +
          `BUILTIN.DF(tl.location) AS location ` +
          `FROM TransactionLine tl ` +
          `WHERE tl.transaction IN (${transactionIds}) ` +
          `AND tl.mainline = 'F' ` +
          `ORDER BY tl.transaction, tl.linesequencenumber`;

        const linesResult = await client.runSuiteQL(linesQuery, 1000, 0);

        // Group lines by transaction id
        const linesByTxn: Record<string, Record<string, unknown>[]> = {};
        for (const line of linesResult.items) {
          const txnId = String(line.transaction);
          if (!linesByTxn[txnId]) linesByTxn[txnId] = [];
          linesByTxn[txnId].push(line);
        }
        for (const txn of transactions) {
          (txn as Record<string, unknown>).lines = linesByTxn[String(txn.id)] ?? [];
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                totalResults: headerResult.totalResults,
                count: headerResult.count,
                hasMore: headerResult.hasMore,
                offset: headerResult.offset,
                transactions,
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

// ---------------------------------------------------------------------------
// get_system_notes
// ---------------------------------------------------------------------------
server.tool(
  "get_system_notes",
  "Query the NetSuite SystemNote table — the audit log that records every field change on every record. " +
    "Captures who changed what, when, from what value to what value, and through which execution context. " +
    "Context codes: UIF (User Interface), RST (RESTlet), SCH (Scheduled Script), " +
    "SLT (Suitelet), UES (User Event Script), WST (Web Store), CSV (CSV Import). " +
    "Useful for debugging scripts, auditing data changes, and tracing automation side-effects. " +
    "Note: system notes are purged after ~60 days; user-initiated changes after ~30 days.",
  {
    recordId: z
      .number()
      .optional()
      .describe("Internal ID of the specific record to get notes for"),
    recordTypeId: z
      .number()
      .optional()
      .describe("Internal ID of the record type (e.g., -30 for transactions, -2 for customers). Use run_suiteql to look up type IDs."),
    scriptContextOnly: z
      .boolean()
      .default(false)
      .describe(
        "If true, filters to only changes made by scripts (RST, SCH, SLT, UES contexts)"
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Filter by specific context code: UIF, RST, SCH, SLT, UES, WST, CSV"
      ),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date filter in YYYY-MM-DD format"),
    dateTo: z
      .string()
      .optional()
      .describe("End date filter in YYYY-MM-DD format"),
    limit: z.number().min(1).max(1000).default(50).describe("Number of rows per page (max 1000)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    environment: envParam,
  },
  async ({ recordId, recordTypeId, scriptContextOnly, context, dateFrom, dateTo, limit, offset, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      const conditions: string[] = [];
      if (recordId !== undefined) conditions.push(`sn.recordid = ${recordId}`);
      if (recordTypeId !== undefined) conditions.push(`sn.recordtypeid = ${recordTypeId}`);
      if (scriptContextOnly) {
        conditions.push(`sn.context IN ('RST', 'SCH', 'SLT', 'UES')`);
      } else if (context) {
        validateIdentifier(context, "context");
        conditions.push(`UPPER(sn.context) = '${context.toUpperCase()}'`);
      }
      if (dateFrom) conditions.push(`sn.date >= TO_DATE('${dateFrom}', 'YYYY-MM-DD')`);
      if (dateTo) conditions.push(`sn.date <= TO_DATE('${dateTo}', 'YYYY-MM-DD')`);

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const query =
        `SELECT ` +
        `sn.date, ` +
        `sn.recordtypeid, ` +
        `BUILTIN.DF(sn.recordtypeid) AS recordTypeName, ` +
        `sn.recordid, ` +
        `sn.field, ` +
        `sn.oldvalue, ` +
        `sn.newvalue, ` +
        `BUILTIN.DF(sn.name) AS changedBy, ` +
        `sn.name AS changedByInternalId, ` +
        `sn.role, ` +
        `sn.context, ` +
        `BUILTIN.DF(sn.context) AS contextName, ` +
        `sn.type AS changeType, ` +
        `sn.lineid ` +
        `FROM SystemNote sn ` +
        `${whereClause} ` +
        `ORDER BY sn.date DESC`;

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
                notes: result.items,
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

// ---------------------------------------------------------------------------
// list_environments
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// get_custom_fields
// ---------------------------------------------------------------------------
server.tool(
  "get_custom_fields",
  "List custom fields from the NetSuite CustomField table, filtered by field type. " +
    "Use this to discover custom field script IDs, display names, and data types before writing SuiteQL queries. " +
    "Field types: " +
    "BODY = transaction body fields (custbody_*) on sales orders, invoices, RMAs, etc.; " +
    "ENTITY = entity fields (custentity_*) on customer, vendor, employee, contact records; " +
    "COLUMN = transaction line fields (custcol_*); " +
    "ITEM = item fields (custitem_*); " +
    "RECORD = custom record type fields (custrecord_*). " +
    "Note: scriptid values are stored uppercase in CustomField but used lowercase in SuiteQL queries.",
  {
    fieldType: z
      .enum(["BODY", "ENTITY", "COLUMN", "ITEM", "RECORD"])
      .describe("The category of custom fields to list."),
    search: z
      .string()
      .optional()
      .describe("Optional search term — filters by partial match on scriptid or name (case-insensitive)."),
    includeInactive: z
      .boolean()
      .default(false)
      .describe("If true, includes fields where isstored = 'F' (formula/display-only fields)."),
    limit: z.number().min(1).max(1000).default(200).describe("Number of rows per page (max 1000, default 200)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    environment: envParam,
  },
  async ({ fieldType, search, includeInactive, limit, offset, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      const conditions: string[] = [`fieldtype = '${fieldType}'`];
      if (!includeInactive) conditions.push(`isstored = 'T'`);
      if (search) {
        const s = search.replace(/'/g, "''");
        conditions.push(`(UPPER(scriptid) LIKE UPPER('%${s}%') OR UPPER(name) LIKE UPPER('%${s}%'))`);
      }

      const result = await client.runSuiteQL(
        `SELECT scriptid, name, fieldvaluetype, ismandatory, isshowinlist, isstored, lastmodifieddate ` +
          `FROM CustomField WHERE ${conditions.join(" AND ")} ORDER BY scriptid`,
        limit,
        offset
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                fieldType,
                totalResults: result.totalResults,
                count: result.count,
                hasMore: result.hasMore,
                offset: result.offset,
                note: "scriptid values are stored uppercase here but used lowercase in SuiteQL queries on the actual record table.",
                fields: result.items,
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

// ---------------------------------------------------------------------------
// get_custom_list
// ---------------------------------------------------------------------------
server.tool(
  "get_custom_list",
  "Fetch a NetSuite custom list definition and all its values in a single call. " +
    "Provide one of: scriptId (e.g. 'customlist_cu_marketplace'), internalId, or name (partial match). " +
    "Returns list metadata and the full list of values with their IDs and names. " +
    "Use the value IDs when filtering SuiteQL queries on List/Record custom fields.",
  {
    scriptId: z
      .string()
      .optional()
      .describe("Script ID of the custom list, e.g. 'customlist_cu_marketplace' (case-insensitive)."),
    internalId: z
      .number()
      .optional()
      .describe("Internal ID of the custom list."),
    name: z
      .string()
      .optional()
      .describe("Display name of the custom list — partial, case-insensitive match."),
    environment: envParam,
  },
  async ({ scriptId, internalId, name, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      if (!scriptId && internalId === undefined && !name) {
        return {
          content: [{ type: "text" as const, text: "Error: Provide at least one of: scriptId, internalId, or name." }],
          isError: true,
        };
      }

      const conditions: string[] = [];
      if (scriptId) conditions.push(`UPPER(scriptid) = '${scriptId.toUpperCase().replace(/'/g, "''")}'`);
      if (internalId !== undefined) conditions.push(`internalid = ${internalId}`);
      if (name) conditions.push(`UPPER(name) LIKE UPPER('%${name.replace(/'/g, "''")}%')`);

      const metaResult = await client.runSuiteQL(
        `SELECT internalid, name, scriptid, isordered, isinactive, lastmodifieddate ` +
          `FROM CustomList WHERE ${conditions.join(" OR ")} ORDER BY name`,
        10,
        0
      );

      if (metaResult.items.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Error: No custom list found matching the provided criteria.` }],
          isError: true,
        };
      }

      const lists = await Promise.all(
        metaResult.items.map(async (meta) => {
          const listScriptId = String(meta.scriptid).toLowerCase();
          try {
            const valuesResult = await client.runSuiteQL(
              `SELECT id, name, isinactive FROM ${listScriptId} ORDER BY id`,
              1000,
              0
            );
            return {
              internalId: meta.internalid,
              name: meta.name,
              scriptId: meta.scriptid,
              isOrdered: meta.isordered,
              isInactive: meta.isinactive,
              lastModified: meta.lastmodifieddate,
              totalValues: valuesResult.totalResults,
              values: valuesResult.items,
            };
          } catch {
            return {
              internalId: meta.internalid,
              name: meta.name,
              scriptId: meta.scriptid,
              isOrdered: meta.isordered,
              isInactive: meta.isinactive,
              lastModified: meta.lastmodifieddate,
              valuesError: "Could not fetch values — list may have no queryable table.",
            };
          }
        })
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ environment: envId, totalLists: lists.length, lists }, null, 2),
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

// ---------------------------------------------------------------------------
// get_record
// ---------------------------------------------------------------------------
server.tool(
  "get_record",
  "Fetch a single NetSuite record by type and internal ID using the REST Record API. " +
    "Returns the full record with all fields including custom fields — richer than SuiteQL projections. " +
    "Common record types: customer, vendor, employee, invoice, salesorder, purchaseorder, " +
    "returnauthorization, journalentry, contact, inventoryitem, assemblyitem. " +
    "For custom record types use 'customrecord_<scriptid>' (e.g. 'customrecord_cu_rma_line'). " +
    "Set expandSubResources=true to include sublists (lines, addresses, etc.) — use with caution on large records.",
  {
    recordType: z
      .string()
      .describe("Record type as used in the REST API, e.g. 'customer', 'salesorder', 'returnauthorization'."),
    internalId: z
      .number()
      .describe("Internal ID of the record to fetch."),
    expandSubResources: z
      .boolean()
      .default(false)
      .describe("If true, expands sublists (line items, addresses, etc.) in the response."),
    environment: envParam,
  },
  async ({ recordType, internalId, expandSubResources, environment }) => {
    try {
      const { client, envId } = getClient(environment);
      const record = await client.getRecord(recordType, internalId, expandSubResources);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ environment: envId, recordType, internalId, record }, null, 2),
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

// ---------------------------------------------------------------------------
// create_customer
// ---------------------------------------------------------------------------
server.tool(
  "create_customer",
  "Create a new customer record in NetSuite via the REST Record API (POST /record/v1/customer). " +
    "For company customers, leave isPerson=false (default) and provide companyName. " +
    "For individual customers, set isPerson=true and provide firstName and lastName. " +
    "subsidiaryId is required on NetSuite OneWorld accounts. " +
    "entityId is the customer's unique identifier string — usually auto-numbered, so omit unless you need a specific value. " +
    "Set externalId to enable idempotent upserts keyed on your system's ID. " +
    "Use additionalFields to pass any other fields, addressbook lines, or custom fields documented " +
    "in get_record_metadata('customer'). On success returns the new internal ID extracted from the Location header.",
  {
    isPerson: z
      .boolean()
      .default(false)
      .describe("true for an individual customer; false (default) for a company."),
    companyName: z
      .string()
      .optional()
      .describe("Company name. Required when isPerson is false."),
    firstName: z
      .string()
      .optional()
      .describe("First name. Required when isPerson is true."),
    lastName: z
      .string()
      .optional()
      .describe("Last name. Required when isPerson is true."),
    middleName: z
      .string()
      .optional()
      .describe("Middle name (person customers only)."),
    email: z.string().optional().describe("Primary email address."),
    phone: z.string().optional().describe("Primary phone number."),
    entityId: z
      .string()
      .optional()
      .describe(
        "Customer identifier string (e.g. 'C12345'). Usually auto-generated — omit unless your account requires manual entry."
      ),
    externalId: z
      .string()
      .optional()
      .describe("External system ID — set to enable idempotent create/update by external key."),
    subsidiaryId: z
      .union([z.number(), z.string()])
      .optional()
      .describe("Internal ID of the subsidiary. Required on OneWorld accounts."),
    additionalFields: z
      .record(z.unknown())
      .optional()
      .describe(
        "Extra fields/sublists merged into the request body, e.g. " +
          "{ \"category\": { \"id\": \"5\" }, \"addressbook\": { \"items\": [...] }, \"custentity_xyz\": \"abc\" }."
      ),
    environment: envParam,
  },
  async ({
    isPerson,
    companyName,
    firstName,
    lastName,
    middleName,
    email,
    phone,
    entityId,
    externalId,
    subsidiaryId,
    additionalFields,
    environment,
  }) => {
    try {
      if (isPerson) {
        if (!firstName || !lastName) {
          throw new Error("firstName and lastName are required when isPerson is true.");
        }
      } else if (!companyName) {
        throw new Error("companyName is required when isPerson is false.");
      }

      const body: Record<string, unknown> = { isPerson };
      if (companyName !== undefined) body.companyName = companyName;
      if (firstName !== undefined) body.firstName = firstName;
      if (lastName !== undefined) body.lastName = lastName;
      if (middleName !== undefined) body.middleName = middleName;
      if (email !== undefined) body.email = email;
      if (phone !== undefined) body.phone = phone;
      if (entityId !== undefined) body.entityId = entityId;
      if (externalId !== undefined) body.externalId = externalId;
      if (subsidiaryId !== undefined) body.subsidiary = { id: String(subsidiaryId) };
      if (additionalFields) Object.assign(body, additionalFields);

      const { client, envId } = getClient(environment);
      const result = await client.createRecord("customer", body);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                created: true,
                internalId: result.id,
                location: result.location,
                status: result.status,
                requestBody: body,
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

// ---------------------------------------------------------------------------
// list_file_cabinet
// ---------------------------------------------------------------------------
server.tool(
  "list_file_cabinet",
  "Browse the NetSuite File Cabinet. Lists folders and files using SuiteQL. " +
    "Provide folderId to list contents of a specific folder — omit to list root-level folders. " +
    "Use nameSearch to search for files or folders by name across the entire cabinet (partial, case-insensitive). " +
    "Returns folders first, then files, each with id, name, type, size, and last modified date. " +
    "Use the folder id values to drill down into subfolders.",
  {
    folderId: z
      .number()
      .optional()
      .describe("Internal ID of the folder to list contents of. Omit to list root-level folders."),
    nameSearch: z
      .string()
      .optional()
      .describe("Search for files or folders by name — partial, case-insensitive match. Searches across all folders when provided."),
    showFolders: z
      .boolean()
      .default(true)
      .describe("Include subfolders in results (default true)."),
    showFiles: z
      .boolean()
      .default(true)
      .describe("Include files in results (default true)."),
    limit: z.number().min(1).max(1000).default(100).describe("Number of rows per page (max 1000, default 100)"),
    offset: z.number().min(0).default(0).describe("Row offset for pagination"),
    environment: envParam,
  },
  async ({ folderId, nameSearch, showFolders, showFiles, limit, offset, environment }) => {
    try {
      const { client, envId } = getClient(environment);

      const results: Record<string, unknown>[] = [];

      if (showFolders) {
        const folderConditions: string[] = [];
        if (nameSearch) {
          folderConditions.push(`UPPER(f.name) LIKE UPPER('%${nameSearch.replace(/'/g, "''")}%')`);
        } else {
          folderConditions.push(folderId !== undefined ? `f.parent = ${folderId}` : `f.parent IS NULL`);
        }
        const folderWhere = folderConditions.length > 0 ? `WHERE ${folderConditions.join(" AND ")}` : "";

        const folderResult = await client.runSuiteQL(
          `SELECT f.id, f.name, f.parent, BUILTIN.DF(f.parent) AS parentName, f.lastmodifieddate ` +
            `FROM MediaItemFolder f ${folderWhere} ORDER BY f.name`,
          limit,
          offset
        );

        for (const row of folderResult.items) {
          results.push({ kind: "folder", ...row });
        }
      }

      if (showFiles) {
        const fileConditions: string[] = [];
        if (nameSearch) {
          fileConditions.push(`UPPER(fl.name) LIKE UPPER('%${nameSearch.replace(/'/g, "''")}%')`);
        } else if (folderId !== undefined) {
          fileConditions.push(`fl.folder = ${folderId}`);
        }
        const fileWhere = fileConditions.length > 0 ? `WHERE ${fileConditions.join(" AND ")}` : "";

        const fileResult = await client.runSuiteQL(
          `SELECT fl.id, fl.name, fl.filetype, fl.filesize, fl.folder, BUILTIN.DF(fl.folder) AS folderName, fl.lastmodifieddate ` +
            `FROM File fl ${fileWhere} ORDER BY fl.name`,
          limit,
          offset
        );

        for (const row of fileResult.items) {
          results.push({ kind: "file", ...row });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                environment: envId,
                folderId: folderId ?? null,
                nameSearch: nameSearch ?? null,
                totalResults: results.length,
                items: results,
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

// ---------------------------------------------------------------------------
// upload_file
// ---------------------------------------------------------------------------
server.tool(
  "upload_file",
  "Upload a local file to the NetSuite File Cabinet using the SuiteCloud CLI. " +
    "Requires the SuiteCloud CLI installed globally (`npm install -g @oracle/suitecloud-cli`) " +
    "and an auth ID registered via `suitecloud account:setup`. " +
    "Set NETSUITE_SB1_SUITECLOUD_AUTH_ID and/or NETSUITE_SB2_SUITECLOUD_AUTH_ID environment variables " +
    "to avoid passing authId on every call. " +
    "Valid destination path prefixes: /SuiteScripts/, /Templates/, /Web Site Hosting Files/, /SuiteApps/. " +
    "Example: upload /Users/me/work/myScript.js to /SuiteScripts/custom/myScript.js",
  {
    localFilePath: z
      .string()
      .describe("Absolute path to the local file to upload, e.g. '/Users/me/work/myScript.js'"),
    destinationPath: z
      .string()
      .describe(
        "NetSuite File Cabinet destination path. Must start with /SuiteScripts/, /Templates/, " +
        "/Web Site Hosting Files/, or /SuiteApps/. Example: '/SuiteScripts/custom/myScript.js'"
      ),
    authId: z
      .string()
      .optional()
      .describe(
        "SuiteCloud CLI auth ID for the target account (created via `suitecloud account:setup`). " +
        "Falls back to NETSUITE_<ENV>_SUITECLOUD_AUTH_ID env var when omitted."
      ),
    environment: envParam,
  },
  async ({ localFilePath, destinationPath, authId, environment }) => {
    try {
      const { envId } = getClient(environment);

      const resolvedAuthId =
        authId ?? process.env[`NETSUITE_${envId.toUpperCase()}_SUITECLOUD_AUTH_ID`];

      if (!resolvedAuthId) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error: No SuiteCloud auth ID for environment "${envId}". ` +
                `Pass authId directly or set NETSUITE_${envId.toUpperCase()}_SUITECLOUD_AUTH_ID. ` +
                `Run 'suitecloud account:setup' to create one.`,
            },
          ],
          isError: true,
        };
      }

      const validPrefixes = ["/SuiteScripts/", "/Templates/", "/Web Site Hosting Files/", "/SuiteApps/"];
      if (!validPrefixes.some((p) => destinationPath.startsWith(p))) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error: Invalid destination path "${destinationPath}". ` +
                `Must start with one of: ${validPrefixes.join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      const tmpDir = await mkdtemp(path.join(tmpdir(), "suitecloud-upload-"));

      try {
        // Minimal ACP project.json required by the SuiteCloud CLI
        await writeFile(
          path.join(tmpDir, "project.json"),
          JSON.stringify(
            { defaultAuthId: resolvedAuthId, projectType: "ACP", projectVersion: "1.0.0", projectName: "mcp-upload" },
            null,
            2
          )
        );

        // Mirror the File Cabinet structure inside the temp project dir
        const relPath = destinationPath.startsWith("/") ? destinationPath.slice(1) : destinationPath;
        const destInProject = path.join(tmpDir, "FileCabinet", relPath);
        await mkdir(path.dirname(destInProject), { recursive: true });
        await copyFile(localFilePath, destInProject);

        const output = await runSuiteCloudUpload(tmpDir, destinationPath);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { environment: envId, authId: resolvedAuthId, localFilePath, destinationPath, output },
                null,
                2
              ),
            },
          ],
        };
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
server.prompt(
  "diagnose_script_error",
  "Investigate NetSuite script errors for a given script and date range. Pulls error logs, identifies recurring patterns, and suggests root causes.",
  {
    scriptId: z.string().describe("Script ID string (e.g. 'customscript_cu_sl_get_certificates_ui') or numeric internal ID."),
    dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. Defaults to today."),
    dateTo: z.string().optional().describe("End date in YYYY-MM-DD format. Defaults to today."),
    environment: z.enum(["sb1", "sb2", "prod"]).optional().describe(`NetSuite environment. Defaults to "${defaultEnv}".`),
  },
  ({ scriptId, dateFrom, dateTo, environment }) => {
    const env = environment ?? defaultEnv;
    const from = dateFrom ?? new Date().toISOString().slice(0, 10);
    const to = dateTo ?? new Date().toISOString().slice(0, 10);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Diagnose NetSuite script errors for script "${scriptId}" ` +
              `from ${from} to ${to} in environment ${env}.\n\n` +
              `Follow these steps:\n` +
              `1. Call get_script_logs with scriptId="${scriptId}", logType="ERROR", dateFrom="${from}", dateTo="${to}", limit=100, environment="${env}"\n` +
              `2. Call get_script_logs again with logType="EMERGENCY" for the same parameters\n` +
              `3. Group all errors by their "title" field to identify recurring patterns\n` +
              `4. For each distinct error pattern, note: the title, count of occurrences, first and last seen timestamp, and a sample "detail" value\n` +
              `5. Examine the "detail" fields for stack traces, record IDs, or data clues\n` +
              `6. Present a summary with:\n` +
              `   - Total error count\n` +
              `   - Top error patterns ranked by frequency\n` +
              `   - Most likely root cause for each pattern\n` +
              `   - Suggested remediation steps`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "explain_transaction",
  "Fetch and explain a NetSuite transaction in full: header, line items, and audit trail.",
  {
    tranId: z.string().describe("Transaction document number as shown in the UI, e.g. 'SO-12345' or 'CD15763'."),
    environment: z.enum(["sb1", "sb2", "prod"]).optional().describe(`NetSuite environment. Defaults to "${defaultEnv}".`),
  },
  ({ tranId, environment }) => {
    const env = environment ?? defaultEnv;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Explain the NetSuite transaction "${tranId}" in environment ${env}.\n\n` +
              `Follow these steps:\n` +
              `1. Call get_transactions with tranId="${tranId}", includeLines=true, environment="${env}" to get the full transaction with line items\n` +
              `2. Note the transaction's internal ID from the result (field "id")\n` +
              `3. Call get_system_notes with recordId=<internal ID from step 2>, environment="${env}" to get the field-change audit trail\n` +
              `4. Present a structured explanation:\n` +
              `   **Header**: type, status, entity name, date, amount, currency, memo, marketplace (if set)\n` +
              `   **Line items**: for each line — item name, quantity, rate, amount, description\n` +
              `   **Audit trail**: chronological timeline of changes — date, changed by, context (UI/Script), field, old value → new value\n` +
              `5. Highlight anything notable: voided lines, status changes driven by scripts, large amounts, missing fields`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "audit_record_changes",
  "Show the complete field-change history for any NetSuite record as a readable timeline.",
  {
    recordId: z.number().describe("Internal ID of the record to audit."),
    recordTypeId: z.number().optional().describe("Internal ID of the record type (e.g. -30 for transactions, -2 for customers). Optional but improves query performance."),
    dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format."),
    dateTo: z.string().optional().describe("End date in YYYY-MM-DD format."),
    environment: z.enum(["sb1", "sb2", "prod"]).optional().describe(`NetSuite environment. Defaults to "${defaultEnv}".`),
  },
  ({ recordId, recordTypeId, dateFrom, dateTo, environment }) => {
    const env = environment ?? defaultEnv;
    const dateRange = dateFrom || dateTo
      ? ` between ${dateFrom ?? "the beginning"} and ${dateTo ?? "now"}`
      : "";
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Audit all field changes for record ID ${recordId}` +
              (recordTypeId !== undefined ? ` (record type ID ${recordTypeId})` : "") +
              `${dateRange} in environment ${env}.\n\n` +
              `Follow these steps:\n` +
              `1. Call get_system_notes with:\n` +
              `   - recordId=${recordId}\n` +
              (recordTypeId !== undefined ? `   - recordTypeId=${recordTypeId}\n` : "") +
              (dateFrom ? `   - dateFrom="${dateFrom}"\n` : "") +
              (dateTo ? `   - dateTo="${dateTo}"\n` : "") +
              `   - limit=200, environment="${env}"\n` +
              `2. If hasMore=true, paginate to retrieve all changes\n` +
              `3. Present a chronological timeline:\n` +
              `   | Date | Changed By | Context | Field | Old Value → New Value |\n` +
              `4. Group or annotate by context type:\n` +
              `   - UIF = user edited manually in the UI\n` +
              `   - RST/SCH/SLT/UES = script-driven change (note the script context)\n` +
              `   - CSV = bulk import\n` +
              `5. Summarize: total changes, most frequently changed fields, who/what made the most changes`,
          },
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resource: netsuite://environments
// ---------------------------------------------------------------------------
server.resource(
  "environments",
  "netsuite://environments",
  {
    description: "Lists all configured NetSuite environments, their account IDs, and which is the default.",
    mimeType: "application/json",
  },
  async (uri) => {
    const envDetails = availableEnvs.map((envId) => ({
      id: envId,
      accountId: process.env[`NETSUITE_${envId.toUpperCase()}_ACCOUNT_ID`],
      isDefault: envId === defaultEnv,
    }));
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify({ defaultEnvironment: defaultEnv, environments: envDetails }, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resource: netsuite://schema/transaction
// ---------------------------------------------------------------------------
const TRANSACTION_SCHEMA = `# NetSuite Transaction Schema

All transaction types share the \`Transaction\` table, differentiated by \`type\`.

## Transaction type codes
| Code | Type |
|------|------|
| SalesOrd | Sales Order |
| CustInvc | Invoice |
| CustDep | Customer Deposit |
| CustPymt | Customer Payment |
| CashSale | Cash Sale |
| CustCred | Credit Memo |
| CustRfnd | Customer Refund |
| PurchOrd | Purchase Order |
| VendBill | Vendor Bill |
| ItemRcpt | Item Receipt |
| RtnAuth | Return Authorization |
| Journal | Journal Entry |
| TrnfrOrd | Transfer Order |

## Transaction table — key fields
| Field | Notes |
|-------|-------|
| id | Internal ID |
| type | Type code (see above) |
| tranid | Document number shown in UI (e.g. SO-12345) |
| transactionnumber | Full transaction number (e.g. CUSTDEP15763) |
| entity | Customer/vendor internal ID |
| trandate | Transaction date |
| status | Status code — use BUILTIN.DF(status) for label |
| amount | Transaction amount |
| foreigntotal | Amount in transaction currency |
| foreignamountunpaid | Unpaid balance in transaction currency |
| currency | Currency internal ID |
| memo | Memo field |
| createdate | Created date |
| createdby | Created by (employee internal ID) |
| lastmodifieddate | Last modified date |
| postingperiod | Accounting period internal ID |
| voided | T/F — always filter voided = 'F' |
| posting | T/F |
| duedate | Due date |
| closedate | Close date |
| otherrefnum | External reference (e.g. PO number, Stripe charge ID) |
| externalid | External system ID |
| custbody_cu_marketplace | Custom: marketplace (List/Record → customlist_cu_marketplace) |
| custbody_cu_originating_ctpr | Custom: originating counterpart internal ID |
| customform | Custom form internal ID |
| paymentmethod | Payment method internal ID |
| exchangerate | Exchange rate |
| subsidiary | Subsidiary internal ID |
| department | Department internal ID |
| class | Class/LOB internal ID |
| location | Location internal ID |
| employee | Sales rep internal ID |
| terms | Payment terms internal ID |

## TransactionLine table — key fields
Join: \`TransactionLine.transaction = Transaction.id\`

| Field | Notes |
|-------|-------|
| id | Line internal ID |
| transaction | Parent transaction internal ID |
| linesequencenumber | Line order/position |
| item | Item internal ID |
| itemtype | Item type (TaxItem, InvtPart, Service, etc.) |
| quantity | Quantity |
| rate | Unit rate |
| amount | Line amount |
| foreignamount | Amount in foreign currency |
| description | Line description / memo |
| mainline | T for header line, F for item lines — filter mainline = 'F' for items |
| class | Class/LOB internal ID |
| department | Department internal ID |
| location | Location internal ID |
| subsidiary | Subsidiary internal ID |
| taxamount | Tax amount |
| taxline | T if this is a tax line |
| isclosed | T/F |
| memo | Line memo |

## TransactionAccountingLine table — GL impact
Join: \`TransactionAccountingLine.transaction = Transaction.id\`

| Field | Notes |
|-------|-------|
| account | GL account internal ID |
| debit | Debit amount |
| credit | Credit amount |
| posting | T/F |
| transactionline | TransactionLine.id reference |

## Common queries

\`\`\`sql
-- Header + lines
SELECT t.tranid, tl.item, tl.quantity, tl.amount
FROM Transaction t
INNER JOIN TransactionLine tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd' AND t.voided = 'F' AND tl.mainline = 'F'
ORDER BY t.trandate DESC

-- GL impact for a transaction
SELECT BUILTIN.DF(tal.account) AS account, tal.debit, tal.credit
FROM TransactionAccountingLine tal
WHERE tal.transaction = <id>
  AND (tal.debit IS NOT NULL OR tal.credit IS NOT NULL)
ORDER BY tal.transactionline
\`\`\`
`;

server.resource(
  "schema-transaction",
  "netsuite://schema/transaction",
  {
    description: "Field reference for the NetSuite Transaction and TransactionLine tables. Use before writing SuiteQL queries against transactions.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: TRANSACTION_SCHEMA }],
  })
);

// ---------------------------------------------------------------------------
// Resource template: netsuite://custom-fields/{fieldType}
// ---------------------------------------------------------------------------
const CUSTOM_FIELD_TYPES: Record<string, string> = {
  BODY: "Transaction Body Fields (custbody_*) — header-level fields on sales orders, invoices, RMAs, etc.",
  ENTITY: "Entity Fields (custentity_*) — fields on customer, vendor, employee, and contact records.",
  COLUMN: "Transaction Line Fields (custcol_*) — fields on transaction line items.",
  ITEM: "Item Fields (custitem_*) — fields on inventory items, service items, etc.",
  RECORD: "Custom Record Fields (custrecord_*) — fields belonging to custom record types.",
};

server.resource(
  "custom-fields",
  new ResourceTemplate("netsuite://custom-fields/{fieldType}", {
    list: async () => ({
      resources: Object.entries(CUSTOM_FIELD_TYPES).map(([fieldType, description]) => ({
        uri: `netsuite://custom-fields/${fieldType}`,
        name: `Custom Fields: ${fieldType}`,
        description,
        mimeType: "application/json",
      })),
    }),
  }),
  {
    description: "Live catalog of custom fields by type from the NetSuite CustomField table. fieldType: BODY, ENTITY, COLUMN, ITEM, RECORD.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const fieldType = (variables.fieldType as string).toUpperCase();
    if (!CUSTOM_FIELD_TYPES[fieldType]) {
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({
              error: `Unknown fieldType '${fieldType}'. Valid values: ${Object.keys(CUSTOM_FIELD_TYPES).join(", ")}`,
            }),
          },
        ],
      };
    }

    const { client } = getClient();
    const result = await client.runSuiteQL(
      `SELECT scriptid, name, fieldvaluetype, ismandatory, isshowinlist, isstored, lastmodifieddate ` +
        `FROM CustomField WHERE fieldtype = '${fieldType}' AND isstored = 'T' ORDER BY scriptid`,
      1000,
      0
    );

    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              fieldType,
              description: CUSTOM_FIELD_TYPES[fieldType],
              totalFields: result.totalResults,
              fields: result.items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resource: netsuite://custom-lists
// ---------------------------------------------------------------------------
server.resource(
  "custom-lists",
  "netsuite://custom-lists",
  {
    description: "Live catalog of all active custom lists in NetSuite. Use the scriptId to query list values via netsuite://custom-list/{scriptId}.",
    mimeType: "application/json",
  },
  async (uri) => {
    const { client, envId } = getClient();
    const result = await client.runSuiteQL(
      `SELECT internalid, name, scriptid, isordered, lastmodifieddate ` +
        `FROM CustomList WHERE isinactive = 'F' ORDER BY name`,
      1000,
      0
    );
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              environment: envId,
              totalLists: result.totalResults,
              lists: result.items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resource template: netsuite://custom-list/{scriptId}
// ---------------------------------------------------------------------------
server.resource(
  "custom-list-values",
  new ResourceTemplate("netsuite://custom-list/{scriptId}", {
    list: undefined, // enumeration not practical — use netsuite://custom-lists to discover
  }),
  {
    description: "Values for a specific custom list. scriptId should be the lowercase list script ID, e.g. 'customlist_cu_marketplace'.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const scriptId = (variables.scriptId as string).toLowerCase();
    validateIdentifier(scriptId, "scriptId");

    const { client, envId } = getClient();

    // Look up metadata from customlist table (scriptid stored uppercase)
    const metaResult = await client.runSuiteQL(
      `SELECT internalid, name, scriptid, isordered, isinactive, lastmodifieddate ` +
        `FROM CustomList WHERE UPPER(scriptid) = '${scriptId.toUpperCase()}'`,
      1,
      0
    );

    if (metaResult.items.length === 0) {
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({ error: `Custom list '${scriptId}' not found.` }),
          },
        ],
      };
    }

    const meta = metaResult.items[0];

    // Query the list's values table directly
    const valuesResult = await client.runSuiteQL(
      `SELECT id, name, isinactive FROM ${scriptId} ORDER BY id`,
      1000,
      0
    );

    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              environment: envId,
              scriptId,
              name: meta.name,
              internalId: meta.internalid,
              isOrdered: meta.isordered,
              lastModified: meta.lastmodifieddate,
              totalValues: valuesResult.totalResults,
              values: valuesResult.items,
            },
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
