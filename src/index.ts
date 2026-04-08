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

/** Validate that a name is safe to interpolate into SuiteQL (alphanumeric + underscore only). */
function validateIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid ${label}: "${name}". Only alphanumeric characters and underscores are allowed.`);
  }
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
    environment: envParam,
  },
  async ({ scriptInternalId, scriptId, logType, dateFrom, dateTo, limit, offset, environment }) => {
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
  async ({ transactionType, entityId, dateFrom, dateTo, internalId, externalId, tranId, includeLines, limit, offset, environment }) => {
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
        `t.amount, ` +
        `t.foreigntotal, ` +
        `BUILTIN.DF(t.currency) AS currency, ` +
        `BUILTIN.DF(t.terms) AS paymentTerms, ` +
        `t.duedate, ` +
        `t.closedate, ` +
        `t.memo, ` +
        `t.createdate, ` +
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
          `tl.description, ` +
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
