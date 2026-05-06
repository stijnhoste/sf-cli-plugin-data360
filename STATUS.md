# Plugin Status

> Last updated: 2026-05-07

## Testing Summary

| Level                              | Commands  | What it proves                               |
| ---------------------------------- | --------- | -------------------------------------------- |
| Smoke tested                       | 160 / 160 | Imports, flags, metadata valid               |
| Inventory snapshot                 | 160 / 160 | No unintentional changes                     |
| Unit tested (mocked API)           | 19        | Correct requests, responses, name resolution |
| Live tested (real org)             | 17        | End-to-end verified, 2026-03-18              |
| Smoke only (untested individually) | 132       | Covered by CRUD base class tests             |

## Data 360 Project Metadata Coverage

Verified against `modelsapi` on 2026-05-07 using the linked plugin and `sf project retrieve/deploy start`.

Retrieve coverage:

| Metadata type                            | Retrieved files | Result                             |
| ---------------------------------------- | --------------- | ---------------------------------- |
| `Data360Activation`                      | 0               | Empty type handled cleanly         |
| `Data360ActivationTarget`                | 0               | Empty type handled cleanly         |
| `Data360CalculatedInsight`               | 0               | Empty type handled cleanly         |
| `Data360Connection`                      | 1               | Retrieved                          |
| `Data360DataAction`                      | 2               | Retrieved                          |
| `Data360DataActionTarget`                | 1               | Retrieved                          |
| `Data360DataGraph`                       | 1               | Retrieved                          |
| `Data360DataLakeObject`                  | 18              | Retrieved                          |
| `Data360DataModelObject`                 | 200             | Retrieved                          |
| `Data360DataModelObjectMapping`          | 1               | Retrieved by representative member |
| `Data360DataSpace`                       | 1               | Retrieved                          |
| `Data360DataStream`                      | 49              | Retrieved                          |
| `Data360DataTransform`                   | 5               | Retrieved                          |
| `Data360DocumentProcessingConfiguration` | 0               | Empty type handled cleanly         |
| `Data360IdentityResolution`              | 3               | Retrieved                          |
| `Data360SearchIndex`                     | 0               | Empty type handled cleanly         |
| `Data360Segment`                         | 10              | Retrieved                          |

Representative deploy coverage:

| Metadata type                   | Representative                                          | Result                                                                                      |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Data360DataModelObject`        | `CampaignMember_SMH_1751457788551__dlm`                 | Updated                                                                                     |
| `Data360DataSpace`              | `default`                                               | Updated                                                                                     |
| `Data360DataStream`             | `Account_Home`                                          | Updated                                                                                     |
| `Data360IdentityResolution`     | `1irKZ000000003UYAQ`                                    | Updated                                                                                     |
| `Data360Connection`             | `0hMKZ000000CyKX2A0`                                    | Skipped: connector-specific polymorphic request body is not present in retrieved metadata   |
| `Data360DataAction`             | `flow_i5ZPyabTqGGcLZln_gCLBM3saHQ`                      | Skipped: Flow-backed action metadata requires an authoring-specific payload                 |
| `Data360DataActionTarget`       | `FlowDataActionTarget_vbrwEwD76Q`                       | Skipped: Core/Flow-backed target metadata requires an authoring-specific payload            |
| `Data360DataGraph`              | `Resolve`                                               | Skipped: retrieved runtime metadata is not the authoring payload required by the update API |
| `Data360DataLakeObject`         | `Account_Home__dll`                                     | Skipped: stream-associated DLOs must be managed through data stream APIs                    |
| `Data360DataModelObjectMapping` | `Campaign_Home_map_Campaign_1750852592693`              | Skipped: API exposes GET/DELETE but no update method for metadata replay                    |
| `Data360DataTransform`          | `Dg_Mmgl_9pFKZ00000000Gm_FRAGMENT_STREAM_1757483536050` | Skipped: system/hidden transform generated by Data Cloud                                    |
| `Data360Segment`                | `Customer_Retention_Campaign`                           | Skipped: UI segment update API requires DBT or Lookalike authoring payloads                 |

## Unit Tested Commands (19)

These have dedicated test files with mocked API responses:

| Command                    | Test File                         | What's Verified                                           |
| -------------------------- | --------------------------------- | --------------------------------------------------------- |
| `connection get`           | `connection-get.test.ts`          | Name→ID resolution with connectorType                     |
| `data-stream delete`       | `crudDelete.test.ts`              | DELETE + shouldDeleteDataLakeObject param                 |
| `dmo get`                  | `crudGet.test.ts`                 | GET path injection, response mapping                      |
| `dmo list`                 | `crudList.test.ts`                | Pagination, batchSize=50, mapRecord                       |
| `dmo mapping-list`         | `dmo-mapping-list.test.ts`        | dloDeveloperName/dmoDeveloperName params, nested response |
| `identity-resolution list` | `crudList.test.ts`                | Column mappings (label, rulesetStatus)                    |
| `identity-resolution run`  | `identity-resolution-run.test.ts` | Name→ID resolution, ID passthrough, error handling        |
| `query async-create`       | `query-async.test.ts`             | POST /query-sql with SQL body                             |
| `query async-status`       | `query-async.test.ts`             | GET /query-sql/{id}                                       |
| `query async-rows`         | `query-async.test.ts`             | GET /query-sql/{id}/rows, result formatting               |
| `query async-cancel`       | `query-async.test.ts`             | DELETE /query-sql/{id}                                    |
| `query sqlv2`              | `query-sqlv2.test.ts`             | POST body, nextBatchId, empty results                     |
| `segment create`           | `crudCreate.test.ts`              | POST body, ID extraction                                  |
| `segment delete`           | `crudDelete.test.ts`              | DELETE path                                               |
| `segment list`             | `crudList.test.ts`                | arrayKey='segments', column mapping                       |
| `segment publish`          | `segment-publish.test.ts`         | Name→marketSegmentId resolution                           |
| `transform get`            | `crudGet.test.ts`                 | Response field mapping (createdBy object)                 |
| `transform run`            | `crudAction.test.ts`              | POST path injection                                       |
| `transform validate`       | `crudAction.test.ts`              | Endpoint fix verification (B21)                           |

## Live Tested Commands (17)

Verified against a real Data Cloud org on 2026-03-18:

| Command                    | Result                                       |
| -------------------------- | -------------------------------------------- |
| `calculated-insight list`  | Listed CIs                                   |
| `connection connector-get` | Returned SalesforceCRM details               |
| `connection get`           | Resolved name→ID, returned connection detail |
| `connection list`          | Listed connections with --connector-type     |
| `data-stream list`         | Listed 4 streams with connector types        |
| `dmo list`                 | 1078 DMOs with --all (pagination verified)   |
| `dmo mapping-list`         | 19 field mappings (Contact→Individual)       |
| `identity-resolution list` | 2 rulesets with unified profile counts       |
| `identity-resolution run`  | Job started (name→ID resolved)               |
| `query describe`           | 146 columns for Individual DMO               |
| `query sql`                | COUNT(\*) = 1697                             |
| `query sql-v1`             | COUNT(\*) = 1697                             |
| `query sqlv2`              | 5 rows with pagination support               |
| `query vector`             | Semantic search results                      |
| `search-index list`        | Listed indexes                               |
| `segment list`             | 2 segments with member counts                |
| `segment publish`          | Publish started (name→ID resolved)           |

## Smoke-Only Commands (132)

These 132 commands pass smoke tests (import, flags, metadata) and are covered by their CRUD base class tests, but have no individual unit or live tests. They extend standard base classes:

- **CrudListCommand** (23): activation list, activation-target list, calculated-insight list, etc.
- **CrudGetCommand** (40): activation get, connection connector-get, data-graph get, etc.
- **CrudCreateCommand** (20): activation create, connection create, data-graph create, etc.
- **CrudUpdateCommand** (18): activation update, connection update, dmo update, etc.
- **CrudDeleteCommand** (15): activation delete, connection delete, dmo delete, etc.
- **CrudActionCommand** (12): calculated-insight run, data-graph refresh, etc.
- **Data360Command** (4): doctor, query sql, query vector, query describe

## Help Wanted — Testing on Your Org

We need live testing on diverse orgs. If you have Data Cloud provisioned, try the commands below and report results (success, error message, org type).

### Quick Wins (read-only, safe to run)

```bash
# Data spaces — does this work on your org?
sf data360 data-space list -o <org> 2>/dev/null
sf data360 data-space members -o <org> --name default 2>/dev/null

# Activations — do you see configured activations?
sf data360 activation list -o <org> 2>/dev/null
sf data360 activation-target list -o <org> 2>/dev/null

# Data kits — what bundles are installed?
sf data360 data-kit status -o <org> --name Sales 2>/dev/null

# Transforms — any data transforms configured?
sf data360 transform list -o <org> 2>/dev/null

# Doctor — health check
sf data360 doctor -o <org> 2>/dev/null
```

### Needs Specific Setup

| Command                   | What You Need                | How to Test                                                                                                                  |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `data-graph create`       | A data graph definition JSON | `sf data360 data-graph create -o <org> -f graph.json`                                                                        |
| `search-index create`     | Unstructured data DMO        | `sf data360 search-index create -o <org> -f index.json`                                                                      |
| `docai generate-schema`   | Document AI config           | `sf data360 docai generate-schema -o <org> --name <config>`                                                                  |
| `query async-*` lifecycle | Any large DMO (1000+ rows)   | `sf data360 query async-create -o <org> --sql 'SELECT * FROM "ssot__Individual__dlm"'` then `async-status` then `async-rows` |

### How to Report

1. Run the command with `--json` flag for structured output
2. Note your org type: sandbox, Developer Edition, production, scratch org
3. Note the API version: `sf data360 man <topic> <command>` shows the default
4. Share the result (success or error message) via the repo issues

Even a "it worked" confirmation is valuable — it means we can mark that command as live-tested on another org type.

---

## Known Issues

See `sf data360 man <topic> <command>` for per-command NOTES sections.

Key issues:

- `data-space members` — "Request failed" (needs API investigation)
- `segment members` — returns opaque IDs only (use SQL JOIN instead)
- `data-stream run` — CRM connector cannot be run manually (platform schedule)
- `connection list` — requires `--connector-type` (no "list all" option)

## Bug Fixes Applied

| Bug | Command                               | Fix                                           |
| --- | ------------------------------------- | --------------------------------------------- |
| B1  | `dmo map-to-canonical`                | --map supports duplicate source keys          |
| B2  | `data-stream delete`                  | Added --keep-dlo + shouldDeleteDataLakeObject |
| B4  | `calculated-insight list`             | Dotted arrayKey support (collection.items)    |
| B5  | `search-index get/delete`             | Name→ID resolution                            |
| B6  | `identity-resolution list`            | Fixed column mappings                         |
| B7  | `identity-resolution run`             | Name→ID resolution                            |
| B9  | `dmo list`                            | Pagination fix (batchSize=50)                 |
| B11 | `segment publish`                     | Name→marketSegmentId resolution               |
| B12 | `segment list`                        | Fixed columns + arrayKey                      |
| B13 | `connection connector-get`            | Simplified (no resolution needed)             |
| B15 | `connection get`                      | Name→ID resolution with connectorType         |
| B16 | `connection objects/databases`        | GET→POST + name resolution                    |
| B17 | `query sql-v1/sqlv2/v2-batch/async-*` | 7 stubs rewritten as functional commands      |
| B21 | `transform validate`                  | Fixed endpoint + added --name                 |
| B22 | `docai generate-schema`               | Fixed endpoint + added --name                 |
| E5  | `connection list`                     | Added --connector-type flag                   |
| E10 | Multiple                              | Shared nameResolver.ts utility                |
