# Plan: File Cabinet MCP Tools

## Goal

Add tools to the MCP server to browse and read files from the NetSuite File Cabinet — enabling agents to explore and read SuiteScript source files directly.

## Background

- NetSuite's REST Record API does **not** support file cabinet operations
- Direct file URLs (`media.nl`) require session cookies — not compatible with OAuth TBA
- SOAP API supports file ops but adds significant complexity
- **Best path:** SuiteQL for listing + a custom RESTlet for reading content

## Tools to Implement

### 1. `list_file_cabinet`
- **Mechanism:** SuiteQL on `file` and `folder` tables — no new RESTlet needed
- **Inputs:** `folderId` (optional, defaults to root), `environment`
- **Returns:** list of folders and files with id, name, type, size, last modified

```sql
-- List subfolders
SELECT id, name, parent FROM folder WHERE parent = :folderId ORDER BY name

-- List files in folder
SELECT id, name, filetype, filesize, lastmodifieddate FROM file WHERE folder = :folderId ORDER BY name
```

### 2. `read_file`
- **Mechanism:** Calls a custom RESTlet that uses `N/file.load()`
- **Inputs:** `fileId`, `environment`
- **Returns:** file name, type, and content (text) or base64 (binary)
- **Limit:** 10MB per RESTlet response (non-issue for SuiteScript files)

## RESTlet to Deploy

Deploy a new RESTlet in NetSuite (GET handler):

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file'], (file) => {
  const get = (params) => {
    const f = file.load({ id: params.fileId });
    return {
      id: f.id,
      name: f.name,
      fileType: f.fileType,
      size: f.size,
      content: f.getContents(),
    };
  };
  return { get };
});
```

## MCP Server Changes (`src/index.ts`)

- Add `list_file_cabinet` tool using existing `runSuiteQL` client method
- Add `read_file` tool using existing `callRestlet` client method (pointing to the new RESTlet deployment URL)

## Open Questions

- Should `list_file_cabinet` support recursive listing?
- Should `read_file` return binary files as base64 or skip them?
- Which folder should be the default root (SuiteScripts folder)?

## References

- [Tim Dietrich: File Cabinet via SuiteScript + SuiteQL](https://timdietrich.me/blog/netsuite-file-cabinet-suitescript-suiteql-restlet/)
- [NetSuite N/file Module Docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4205693274.html)
