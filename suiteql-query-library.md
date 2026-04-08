# SuiteQL Query Library

Reference guide for writing reliable SuiteQL queries. Sourced from Tim Dietrich's SuiteQL Query Library (timdietrich.me/suiteql-query-library) and local investigation against sb2.

---

## Custom Fields

All custom fields live in a single `CustomField` table. Filter by `fieldtype` to get the category you need.

### `fieldtype` values

| fieldtype | Script ID prefix | Description |
|-----------|-----------------|-------------|
| `BODY` | `custbody_` | Transaction body fields (header-level on SO, Invoice, etc.) |
| `COLUMN` | `custcol_` | Transaction line/column fields |
| `ENTITY` | `custentity_` | Entity fields (customer, vendor, employee, contact) |
| `ITEM` | `custitem_` | Item fields |
| `RECORD` | `custrecord_` | Custom record type fields |
| `EVENT` | — | CRM event fields |
| `SCRIPT` | — | Script parameter fields |
| `WORKFLOW` | — | Workflow fields |
| `WFSTATE` | — | Workflow state fields |

### `CustomField` columns

| Column | Notes |
|--------|-------|
| `id` / `internalid` | Field internal ID |
| `scriptid` | Script ID (always uppercase in this table, e.g. `CUSTBODY_CU_MARKETPLACE`) |
| `name` | Display label |
| `fieldtype` | See table above |
| `fieldvaluetype` | Data type: `Free-Form Text`, `List/Record`, `Check Box`, `Date`, `Currency`, `Integer Number`, `Decimal Number`, `Percent`, `Email Address`, `Hyperlink`, `Text Area`, `Long Text`, `Multiple Select`, `Image`, `Date/Time` |
| `ismandatory` | `T`/`F` |
| `isshowinlist` | `T`/`F` — shows in list views |
| `isstored` | `T`/`F` — filter `isstored = 'T'` to skip formula/display-only fields |
| `recordtype` | For `RECORD` fields only: the CustomRecordType internalid |
| `owner` | Owner employee internal ID |
| `lastmodifieddate` | Last modified date |

### Queries

**All custom fields (any type):**
```sql
SELECT scriptid, name, fieldtype, fieldvaluetype, BUILTIN.DF(owner) AS owner, lastmodifieddate
FROM CustomField
ORDER BY scriptid
```

**Transaction body fields (`custbody_*`):**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isshowinlist, isstored, lastmodifieddate
FROM CustomField
WHERE fieldtype = 'BODY'
  AND isstored = 'T'
ORDER BY scriptid
```

**Entity fields (`custentity_*`) — applies to customer, vendor, employee, contact:**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isshowinlist, isstored, lastmodifieddate
FROM CustomField
WHERE fieldtype = 'ENTITY'
  AND isstored = 'T'
ORDER BY scriptid
```

**Transaction line/column fields (`custcol_*`):**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isstored, lastmodifieddate
FROM CustomField
WHERE fieldtype = 'COLUMN'
  AND isstored = 'T'
ORDER BY scriptid
```

**Item fields (`custitem_*`):**
```sql
SELECT scriptid, name, fieldvaluetype, ismandatory, isstored, lastmodifieddate
FROM CustomField
WHERE fieldtype = 'ITEM'
  AND isstored = 'T'
ORDER BY scriptid
```

**Custom record fields (for a specific record type):**
```sql
SELECT name, scriptid, fieldvaluetype, fieldvaluetyperecord, isinactive
FROM CustomField
WHERE recordtype = <internalid>
ORDER BY name
```

**Search by partial script ID (case-insensitive):**
```sql
SELECT scriptid, name, fieldtype, fieldvaluetype
FROM CustomField
WHERE LOWER(scriptid) LIKE '%marketplace%'
ORDER BY scriptid
```

> **Note:** `scriptid` values in `CustomField` are stored uppercase (e.g. `CUSTBODY_CU_MARKETPLACE`).  
> In SuiteQL queries, reference the field using lowercase (e.g. `custbody_cu_marketplace`).

---

## Custom Lists

### `customlist` table columns

| Column | Notes |
|--------|-------|
| `internalid` | Internal ID |
| `scriptid` | Script ID — stored uppercase (e.g. `CUSTOMLIST_CU_MARKETPLACE`) |
| `name` | Display name |
| `isordered` | `T`/`F` — whether list values have a defined order |
| `isinactive` | `T`/`F` |
| `lastmodifieddate` | Last modified date |
| `owner` | Owner employee internal ID |

**List all active custom lists:**
```sql
SELECT name, description, scriptid, BUILTIN.DF(owner) AS owner, isordered
FROM customlist
WHERE isinactive = 'F'
ORDER BY name
```

**Get list values** — query the list's own table (lowercase scriptid):
```sql
-- Example: customlist_cu_marketplace
SELECT id, name, isinactive
FROM customlist_cu_marketplace
ORDER BY id
```

> The values table name = lowercase scriptid. Use `UPPER(scriptid)` when filtering `customlist`.

---

## Custom Record Types

```sql
SELECT name, scriptid, description, BUILTIN.DF(owner) AS owner
FROM CustomRecordType
ORDER BY name
```

**Query a custom record type's data** — use the scriptid as the table name:
```sql
SELECT id, name, isinactive, lastmodified
FROM customrecord_my_type
ORDER BY id
```

---

## Transactions

### Transaction type codes

| Code | Type |
|------|------|
| `SalesOrd` | Sales Order |
| `CustInvc` | Invoice |
| `CustDep` | Customer Deposit |
| `CustPymt` | Customer Payment |
| `CashSale` | Cash Sale |
| `CustCred` | Credit Memo |
| `CustRfnd` | Customer Refund |
| `PurchOrd` | Purchase Order |
| `VendBill` | Vendor Bill |
| `ItemRcpt` | Item Receipt |
| `RtnAuth` | Return Authorization |
| `Journal` | Journal Entry |
| `TrnfrOrd` | Transfer Order |

### Transaction statuses

```sql
SELECT DISTINCT
  Transaction.type AS transactionType,
  status,
  BUILTIN.DF(status) AS statusName,
  BUILTIN.CF(status) AS statusCF
FROM Transaction
ORDER BY transactionType, status
```

### Transaction counts by type and status

```sql
SELECT
  Transaction.type AS transactionType,
  BUILTIN.DF(status) AS status,
  COUNT(*) AS count
FROM Transaction
GROUP BY Transaction.type, BUILTIN.DF(status)
ORDER BY transactionType, status
```

### Customer invoices by date range

```sql
SELECT
  Transaction.id AS invoice,
  Transaction.tranid AS invoiceNumber,
  Transaction.trandate AS invoiceDate,
  BUILTIN.DF(Transaction.entity) AS customerName,
  Transaction.otherrefnum AS customerPONumber,
  BUILTIN.DF(Transaction.employee) AS salesRepName,
  Transaction.foreigntotal AS totalAmount,
  REPLACE(BUILTIN.DF(Transaction.status), 'Invoice : ', '') AS status,
  Transaction.foreignamountunpaid AS balanceDue,
  Transaction.duedate
FROM Transaction
  INNER JOIN TransactionLine ON
    TransactionLine.transaction = Transaction.id
    AND TransactionLine.mainline = 'T'
WHERE
  Transaction.type = 'CustInvc'
  AND Transaction.trandate >= BUILTIN.RELATIVE_RANGES('DAGO30', 'START')
ORDER BY Transaction.tranid DESC
```

### Return authorizations (RMAs) by date range

```sql
SELECT
  Transaction.trandate,
  Transaction.tranid,
  BUILTIN.DF(Transaction.entity) AS customer,
  BUILTIN.DF(Transaction.status) AS status
FROM Transaction
WHERE
  Transaction.type = 'RtnAuth'
  AND Transaction.trandate BETWEEN TO_DATE('2025-01-01', 'YYYY-MM-DD') AND TO_DATE('2025-12-31', 'YYYY-MM-DD')
  AND Transaction.voided = 'F'
```

### Sales orders summarized by status

```sql
SELECT
  status,
  BUILTIN.DF(status) AS statusName,
  COUNT(*) AS transactionCount,
  SUM(foreigntotal) AS totalAmount
FROM Transaction
WHERE type = 'SalesOrd'
GROUP BY status, BUILTIN.DF(status)
ORDER BY status
```

### GL impact for a transaction

```sql
SELECT
  BUILTIN.DF(TransactionAccountingLine.account) AS account,
  TransactionAccountingLine.debit,
  TransactionAccountingLine.credit,
  TransactionAccountingLine.posting,
  TransactionLine.memo
FROM TransactionAccountingLine
  INNER JOIN TransactionLine ON
    TransactionLine.transaction = TransactionAccountingLine.transaction
    AND TransactionLine.id = TransactionAccountingLine.transactionline
WHERE
  TransactionAccountingLine.transaction = <transaction_internal_id>
  AND (TransactionAccountingLine.debit IS NOT NULL OR TransactionAccountingLine.credit IS NOT NULL)
ORDER BY TransactionLine.id
```

### Journal entries with line details

```sql
SELECT
  Transaction.id,
  Transaction.tranid,
  Transaction.trandate,
  BUILTIN.DF(Transaction.postingperiod) AS postingPeriod,
  Transaction.memo,
  BUILTIN.DF(Transaction.status) AS status,
  BUILTIN.DF(Transaction.createdby) AS createdBy,
  BUILTIN.DF(TransactionAccountingLine.account) AS account,
  TransactionAccountingLine.debit,
  TransactionAccountingLine.credit
FROM Transaction
  INNER JOIN TransactionAccountingLine ON TransactionAccountingLine.transaction = Transaction.id
WHERE
  Transaction.type = 'Journal'
  AND Transaction.trandate BETWEEN TO_DATE('2025-01-01', 'YYYY-MM-DD') AND TO_DATE('2025-12-31', 'YYYY-MM-DD')
ORDER BY Transaction.id DESC
```

---

## Entities

### Entity types

```sql
SELECT DISTINCT
  type,
  BUILTIN.DF(type) AS dfType,
  BUILTIN.CF(type) AS cfType
FROM Entity
ORDER BY type
```

---

## Deleted Records

```sql
SELECT
  TO_CHAR(deleteddate, 'DS TS') AS deletedDate,
  type AS recordType,
  recordid,
  BUILTIN.DF(deletedby) AS deletedBy,
  BUILTIN.DF(context) AS context
FROM DeletedRecord
WHERE deleteddate >= TO_DATE(TO_CHAR(SYSDATE, 'YYYY-MM-DD'), 'YYYY-MM-DD')
```

---

## Employees

### Last logins

```sql
SELECT
  e.id,
  e.firstname,
  e.lastname,
  e.email,
  nl.date AS lastLogin
FROM Employee e
  INNER JOIN LoginAudit nl ON nl.user = e.id
WHERE e.isinactive = 'F'
ORDER BY nl.date DESC
```

---

## BUILTIN Functions

### `BUILTIN.DF(field)` — Display value

Returns the human-readable label for a list/record field.

```sql
SELECT BUILTIN.DF(t.entity) AS customerName, BUILTIN.DF(t.status) AS statusLabel
FROM Transaction t
WHERE t.type = 'SalesOrd'
```

### `BUILTIN.CF(field)` — Custom form value

Returns the internal key/code used by custom forms.

```sql
SELECT DISTINCT type, BUILTIN.CF(type) AS cfType FROM Transaction ORDER BY type
```

### `BUILTIN.RELATIVE_RANGES(key, 'START'|'END')` — Dynamic date ranges

Returns a date for a named relative range. Use in `WHERE` clauses instead of hardcoded dates.

**Common keys:**

| Key | Description |
|-----|-------------|
| `TODAY` | Today |
| `YESTERDAY` | Yesterday |
| `TOMORROW` | Tomorrow |
| `TW` | This week |
| `LW` | Last week |
| `NW` | Next week |
| `TM` | This month |
| `LM` | Last month |
| `NM` | Next month |
| `TY` | This year |
| `LY` | Last year |
| `TYTD` | This year to date |
| `LYTD` | Last year to date |
| `DAGO7` | 7 days ago |
| `DAGO30` | 30 days ago |
| `DAGO60` | 60 days ago |
| `DAGO90` | 90 days ago |
| `DFN7` | 7 days from now |
| `DFN30` | 30 days from now |
| `TFQ` | This fiscal quarter |
| `LFQ` | Last fiscal quarter |
| `NFQ` | Next fiscal quarter |
| `TFY` | This fiscal year |
| `LFY` | Last fiscal year |
| `TFYTD` | This fiscal year to date |
| `LFYTD` | Last fiscal year to date |
| `TRQ` | This rolling quarter |
| `LRQ` | Last rolling quarter |
| `TRY` | This rolling year |
| `LRY` | Last rolling year |

**Usage:**
```sql
-- Invoices in last 30 days
WHERE trandate >= BUILTIN.RELATIVE_RANGES('DAGO30', 'START')

-- This month
WHERE trandate BETWEEN BUILTIN.RELATIVE_RANGES('TM', 'START') AND BUILTIN.RELATIVE_RANGES('TM', 'END')

-- Last fiscal quarter
WHERE trandate BETWEEN BUILTIN.RELATIVE_RANGES('LFQ', 'START') AND BUILTIN.RELATIVE_RANGES('LFQ', 'END')
```

---

## SuiteQL Patterns

### Pagination

```sql
-- Cap rows within query:
SELECT ... FROM ... ORDER BY id FETCH FIRST 100 ROWS ONLY

-- For MCP tools: use limit/offset parameters, NOT SQL LIMIT/OFFSET clauses
```

### Boolean fields

```sql
WHERE isinactive = 'F'   -- false
WHERE voided = 'T'       -- true
WHERE mainline = 'F'     -- item lines only (excludes header line)
```

### Date filtering

```sql
-- Fixed dates
WHERE trandate >= TO_DATE('2025-01-01', 'YYYY-MM-DD')
  AND trandate <  TO_DATE('2025-02-01', 'YYYY-MM-DD')

-- Dynamic range
WHERE trandate BETWEEN BUILTIN.RELATIVE_RANGES('LM', 'START') AND BUILTIN.RELATIVE_RANGES('LM', 'END')
```

### Case-insensitive matching

```sql
WHERE LOWER(t.tranid) = LOWER('SO-12345')
WHERE LOWER(scriptid) LIKE '%grading%'
```

### IN list

```sql
WHERE t.id IN (12345, 67890, 11111)
WHERE t.type IN ('SalesOrd', 'CustInvc')
```

### NULL handling

```sql
WHERE field IS NULL
WHERE field IS NOT NULL
WHERE NVL(field, 0) > 100
```

### Aggregate with HAVING

```sql
SELECT entity, COUNT(*) AS orderCount, SUM(amount) AS totalAmount
FROM Transaction
WHERE type = 'SalesOrd' AND voided = 'F'
GROUP BY entity
HAVING COUNT(*) > 5
ORDER BY totalAmount DESC
```

### JOIN transaction header to lines

```sql
SELECT t.tranid, tl.item, tl.quantity, tl.amount
FROM Transaction t
  INNER JOIN TransactionLine tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd'
  AND t.voided = 'F'
  AND tl.mainline = 'F'   -- item lines only
ORDER BY t.trandate DESC
```

### WITH (CTE)

```sql
WITH CustomerData AS (
  SELECT id, companyname, email
  FROM Customer
  WHERE isinactive = 'F'
)
SELECT * FROM CustomerData
WHERE email LIKE '%@example.com'
ORDER BY companyname
```

### ROLLUP for subtotals

```sql
SELECT
  BUILTIN.DF(subsidiary) AS subsidiary,
  BUILTIN.DF(type) AS transactionType,
  SUM(amount) AS total
FROM Transaction
WHERE voided = 'F'
GROUP BY ROLLUP(subsidiary, type)
ORDER BY subsidiary, transactionType
```

---

## Common Gotchas

| Issue | Fix |
|-------|-----|
| `Invalid search type: OA_COLUMNS` | OA_COLUMNS not available in this environment. For custom records use `CustomField WHERE recordtype = <id>`. For standard tables try `get_record_metadata` instead. |
| `customlist` scriptid filter | Stored uppercase: `WHERE scriptid = 'CUSTOMLIST_CU_MARKETPLACE'` (not lowercase) |
| `CustomField` scriptid | Stored uppercase: `WHERE scriptid LIKE '%MARKETPLACE%'` |
| `LIMIT` clause ignored | Use `FETCH FIRST N ROWS ONLY` instead, or use tool's `limit` parameter |
| `T`/`F` booleans | NetSuite uses string `'T'`/`'F'`, not `1`/`0` or `true`/`false` |
| `BUILTIN.DF()` in GROUP BY | Must repeat in GROUP BY: `GROUP BY field, BUILTIN.DF(field)` |
| Custom field on transaction | Use lowercase scriptid: `custbody_cu_marketplace`. The field appears directly on `Transaction` table. |
| Custom field on custom record | Use lowercase scriptid: `custrecord_my_field`. Appears directly on `customrecord_*` table. |
| Entity vs customer table | `Entity` is the base type. `Customer`, `Vendor`, `Employee` are subtypes — use these for entity-specific queries. |
