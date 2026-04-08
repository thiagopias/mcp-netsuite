# SuiteQL Reference

SuiteQL is NetSuite's SQL-based query language built on Oracle SQL-92. Use it via the `run_suiteql` tool.

---

## Key Tables

### `transaction`
All transaction types (sales orders, invoices, payments, etc.) — differentiated by the `type` field.

| Field | Notes |
|-------|-------|
| `id` | Internal ID |
| `type` | Type code: `SalesOrd`, `CustInvc`, `CustDep`, `CustPymt`, `CashSale`, `CustCred`, `CustRfnd`, `PurchOrd`, `VendBill`, `ItemRcpt`, `RtnAuth`, `Journal`, `TrnfrOrd` |
| `tranid` | Document number shown in UI (e.g. `SO-12345`, `CD15763`) |
| `transactionnumber` | Full transaction number (e.g. `CUSTDEP15763`) |
| `trandisplayname` | Display name (e.g. `Customer Deposit #CD15763`) |
| `recordtype` | Record type name (e.g. `customerdeposit`) |
| `entity` | Customer/vendor internal ID |
| `trandate` | Transaction date |
| `status` | Status code |
| `amount` | Transaction amount |
| `foreigntotal` | Amount in transaction currency |
| `currency` | Currency internal ID |
| `memo` | Memo field |
| `createdate` | Created date |
| `createdby` | Created by (employee internal ID) |
| `lastmodifieddate` | Last modified date |
| `lastmodifiedby` | Last modified by |
| `postingperiod` | Accounting period internal ID |
| `voided` | `T`/`F` — filter with `voided = 'F'` |
| `posting` | `T`/`F` |
| `duedate` | Due date |
| `closedate` | Close date |
| `otherrefnum` | External reference (e.g. Stripe charge ID) |
| `custbody_cu_marketplace` | Custom field: marketplace internal ID |
| `custbody_cu_originating_ctpr` | Custom field: originating counterpart internal ID |
| `customform` | Custom form internal ID |
| `nexus` | Tax nexus |
| `paymentmethod` | Payment method internal ID |
| `exchangerate` | Exchange rate |

### `transactionline`
Line items for all transactions. Join to `transaction` via `transactionline.transaction = transaction.id`.

| Field | Notes |
|-------|-------|
| `id` | Line internal ID |
| `transaction` | Parent transaction internal ID |
| `linesequencenumber` | Line order/position |
| `item` | Item internal ID |
| `itemtype` | Item type (e.g. `TaxItem`, `InvtPart`, `Service`) |
| `quantity` | Quantity |
| `rate` | Unit rate |
| `amount` | Line amount |
| `foreignamount` | Amount in foreign currency |
| `netamount` | Net amount |
| `description` | Line description / memo |
| `mainline` | `T` for header line, `F` for item lines — almost always filter `mainline = 'F'` |
| `class` | Class/LOB internal ID (see `classification`) |
| `department` | Department internal ID |
| `location` | Location internal ID |
| `subsidiary` | Subsidiary internal ID |
| `taxamount` | Tax amount |
| `taxcode` | Tax code internal ID |
| `taxline` | `T` if this is a tax line |
| `isclosed` | `T`/`F` |
| `isbillable` | `T`/`F` |
| `isinventoryaffecting` | `T`/`F` |
| `fulfillable` | `T`/`F` |
| `uniquekey` | Unique line key |
| `price` | Price level internal ID |
| `memo` | Line memo |

### `classification`
Lines of Business (LOB). Referenced by `transactionline.class`.

| Field | Notes |
|-------|-------|
| `id` | Internal ID |
| `name` | Name (e.g. `203 - Raw AG`) |
| `fullname` | Full name including parent path |
| `externalid` | External ID |
| `isinactive` | `T`/`F` |
| `includechildren` | `T`/`F` |
| `lastmodifieddate` | Last modified date |
| `subsidiary` | Subsidiary internal IDs (comma-separated) |
| `custrecord_collectors_lob_code` | Custom: collectors LOB code |
| `custrecord_coupa_include_class` | Custom: Coupa include flag |

### `scriptnote`
Script execution logs. Purged periodically.

| Field | Notes |
|-------|-------|
| `internalid` | Log entry internal ID |
| `scripttype` | Script internal ID (join to `Script.id`) |
| `date` | Log timestamp |
| `type` | Log level: `DEBUG`, `AUDIT`, `ERROR`, `EMERGENCY` |
| `title` | Log title / short message |
| `detail` | Full log detail (often JSON) |

**Example — get recent errors for a script:**
```sql
SELECT sn.date, sn.type, sn.title, sn.detail
FROM scriptnote sn
WHERE sn.scripttype = 2670
  AND sn.type IN ('ERROR', 'EMERGENCY')
ORDER BY sn.date DESC
FETCH FIRST 50 ROWS ONLY
```

### `CustomField`
All custom field definitions live in this single table. Filter by `fieldtype` to narrow to the category you need.

| fieldtype | Script ID prefix | Applies to |
|-----------|-----------------|------------|
| `BODY` | `custbody_` | Transaction header (SO, Invoice, RMA, etc.) |
| `COLUMN` | `custcol_` | Transaction lines |
| `ENTITY` | `custentity_` | Customer, Vendor, Employee, Contact |
| `ITEM` | `custitem_` | Inventory items, service items, etc. |
| `RECORD` | `custrecord_` | Custom record types |
| `EVENT` | — | CRM events |
| `SCRIPT` | — | Script parameters |

Key columns: `scriptid` (uppercase), `name`, `fieldtype`, `fieldvaluetype`, `ismandatory`, `isshowinlist`, `isstored`, `recordtype` (RECORD fields only), `lastmodifieddate`.

> **Important:** `scriptid` values are stored UPPERCASE in `CustomField` (e.g. `CUSTBODY_CU_MARKETPLACE`), but used lowercase in SuiteQL queries on the actual record table (e.g. `custbody_cu_marketplace`).

**Example — list transaction body fields:**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isstored
FROM CustomField
WHERE fieldtype = 'BODY' AND isstored = 'T'
ORDER BY scriptid
```

**Example — list entity custom fields:**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isstored
FROM CustomField
WHERE fieldtype = 'ENTITY' AND isstored = 'T'
ORDER BY scriptid
```

See `suiteql-query-library.md` for full queries and all fieldtype values.

---

### `CustomRecordType`
Metadata about custom record types. Note: uses `internalid`, not `id`.

| Field | Notes |
|-------|-------|
| `internalid` | Internal ID |
| `scriptid` | Script ID used in SuiteQL queries (e.g. `customrecord_my_type`) |
| `name` | Display name |
| `isinactive` | `T`/`F` |
| `lastmodifieddate` | Last modified date |
| `owner` | Owner employee internal ID |
| `allowattachments` | `T`/`F` |
| `allowinlineediting` | `T`/`F` |
| `allowquicksearch` | `T`/`F` |
| `usepermissions` | `T`/`F` |
| `nopermissionrequired` | `T`/`F` |

**Example — list all active custom record types:**
```sql
SELECT internalid, scriptid, name
FROM CustomRecordType
WHERE isinactive = 'F'
ORDER BY name
```

### `Script` and `ScriptDeployment`
Script definitions and deployments.

| `Script` field | Notes |
|---|---|
| `id` | Internal ID |
| `name` | Script name |
| `scriptid` | Script ID (e.g. `customscript_cu_sl_get_certificates_ui`) |
| `scripttype` | Script type code |
| `description` | Description |
| `owner` | Owner employee internal ID |
| `isinactive` | `T`/`F` |
| `scriptfile` | File internal ID |

| `ScriptDeployment` field | Notes |
|---|---|
| `id` | Internal ID |
| `script` | Script internal ID (join to `Script.id`) |
| `deploymentid` | Deployment ID (e.g. `customdeploy_...`) |
| `status` | Deployment status |
| `isdeployed` | `T`/`F` |
| `recordtype` | Applied record type |

**Known scripts:**

| Script ID | Name | Type | Internal ID |
|-----------|------|------|-------------|
| `customscript_cu_sl_get_certificates_ui` | CU \| SL \| Get Grading Certificates UI | Suitelet | 2670 |
| `customscript_cu_mr_retrieve_grading_cert` | CU \| MR \| Retrieve Grading Certificates | Map/Reduce | 2671 |
| `customscript_cu_ue_get_grading_certs_btn` | CU \| UE \| Show Get Certificates Button | User Event | 2669 |

---

## BUILTIN Functions (NetSuite-specific)

| Function | Usage | Purpose |
|----------|-------|---------|
| `BUILTIN.DF(fieldId)` | `BUILTIN.DF(t.entity)` | Returns the display/text value of a list or record field |

**Example:**
```sql
SELECT t.id, BUILTIN.DF(t.entity) AS customerName, BUILTIN.DF(t.status) AS statusLabel
FROM transaction t
WHERE t.type = 'CustInvc'
ORDER BY t.trandate DESC
```

---

## Standard SQL Functions (Oracle SQL-92)

### Number Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `CEIL` | `CEIL(n)` | Smallest integer >= n |
| `FLOOR` | `FLOOR(n)` | Largest integer <= n |
| `MOD` | `MOD(m, n)` | Remainder of m / n |
| `ROUND` | `ROUND(n [, m])` | Round n to m decimal places |
| `TRUNC` | `TRUNC(n [, m])` | Truncate n to m decimal places |

### String Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `CONCAT` | `CONCAT(a, b)` or `a \|\| b` | Concatenate strings |
| `LOWER` | `LOWER(char)` | Lowercase |
| `UPPER` | `UPPER(char)` | Uppercase |
| `INITCAP` | `INITCAP(char)` | Title case |
| `SUBSTR` | `SUBSTR(char, m [, n])` | Substring from position m, length n |
| `INSTR` | `INSTR(char1, char2 [, n])` | Position of char2 in char1 |
| `LENGTH` | `LENGTH(char)` | String length |
| `TRIM` | `TRIM([spec char FROM] str)` | Remove leading/trailing characters |
| `LTRIM` | `LTRIM(char [, set])` | Remove leading characters |
| `RTRIM` | `RTRIM(char [, set])` | Remove trailing characters |
| `LPAD` | `LPAD(char1, n [, char2])` | Left-pad to length n |
| `RPAD` | `RPAD(char1, n [, char2])` | Right-pad to length n |
| `REPLACE` | `REPLACE(char, search [, replace])` | Replace occurrences |
| `TRANSLATE` | `TRANSLATE(char, from, to)` | Character-level substitution |

### Date Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `TO_DATE` | `TO_DATE(char [, fmt])` | Parse string to date — use `'YYYY-MM-DD'` format |
| `TO_CHAR` | `TO_CHAR(d [, fmt])` | Format date as string |
| `ADD_MONTHS` | `ADD_MONTHS(d, n)` | Add n months to date d |
| `MONTHS_BETWEEN` | `MONTHS_BETWEEN(d1, d2)` | Months between two dates |
| `LAST_DAY` | `LAST_DAY(d)` | Last day of month |
| `NEXT_DAY` | `NEXT_DAY(d, char)` | Next weekday after d |
| `SYSDATE` | `SYSDATE` | Current date and time |
| `CURRENT_DATE` | `CURRENT_DATE` | Current date |
| `EXTRACT` | `EXTRACT(field FROM date)` | Extract year/month/day/etc |
| `ROUND` | `ROUND(d [, fmt])` | Round date to unit |
| `TRUNC` | `TRUNC(d [, fmt])` | Truncate date to unit |

**Date format tokens:** `YYYY` (4-digit year), `MM` (month), `DD` (day), `HH24` (hour), `MI` (minute), `SS` (second)

### Conversion Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `TO_NUMBER` | `TO_NUMBER(char [, fmt])` | Parse string to number |
| `CAST` | `CAST(expr AS type)` | Type conversion |

### Conditional / Null Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `NVL` | `NVL(expr1, expr2)` | Return expr2 if expr1 is NULL |
| `DECODE` | `DECODE(expr, s1, r1 [, s2, r2...] [, default])` | Switch/case expression |
| `CASE` | `CASE WHEN cond THEN val ... ELSE val END` | SQL CASE expression |
| `COALESCE` | `COALESCE(e1, e2, ...)` | First non-NULL value |
| `GREATEST` | `GREATEST(e1, e2, ...)` | Greatest of a list |
| `LEAST` | `LEAST(e1, e2, ...)` | Least of a list |

### Aggregate Functions
| Function | Syntax | Purpose |
|----------|--------|---------|
| `COUNT` | `COUNT(* \| expr)` | Row count |
| `SUM` | `SUM(n)` | Sum of values |
| `AVG` | `AVG(n)` | Average |
| `MAX` | `MAX(expr)` | Maximum value |
| `MIN` | `MIN(expr)` | Minimum value |
| `STDDEV` | `STDDEV(x)` | Standard deviation |
| `VARIANCE` | `VARIANCE(x)` | Variance |

---

## SuiteQL Patterns

### Pagination
```sql
-- Use tool's limit/offset params, NOT SQL LIMIT/OFFSET
-- To cap within query:
SELECT ... FROM ... ORDER BY id FETCH FIRST 100 ROWS ONLY
```

### Boolean values
```sql
WHERE isinactive = 'F'   -- false
WHERE voided = 'T'       -- true
```

### Date filtering
```sql
WHERE trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
  AND trandate <  TO_DATE('2026-02-01', 'YYYY-MM-DD')
```

### Case-insensitive string match
```sql
WHERE LOWER(t.tranid) = LOWER('SO-12345')
WHERE LOWER(s.name) LIKE '%grading%'
```

### Join transaction to lines
```sql
SELECT t.tranid, tl.item, tl.quantity, tl.amount
FROM transaction t
INNER JOIN transactionline tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd'
  AND t.voided = 'F'
  AND tl.mainline = 'F'
ORDER BY t.trandate DESC
```

### Get script logs
```sql
SELECT sn.date, sn.type, sn.title, sn.detail
FROM scriptnote sn
INNER JOIN Script s ON s.id = sn.scripttype
WHERE s.scriptid = 'customscript_cu_sl_get_certificates_ui'
ORDER BY sn.date DESC
FETCH FIRST 100 ROWS ONLY
```
