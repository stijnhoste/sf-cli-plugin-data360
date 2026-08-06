# Data 360 project and operator workflows for Salesforce CLI

A Salesforce CLI plugin for bringing Data 360 resources into repeatable engineering workflows: inspect live environments, retrieve configuration into project files, review changes, validate operations, and deploy through the Connect API.

## Why it exists

Data 360 resources do not follow the normal Salesforce Metadata API lifecycle. That makes source-controlled delivery, environment comparison, and repeatable operator work harder than it should be. This plugin adds Data 360-aware commands and intercepts scoped `sf project retrieve start` and `sf project deploy start` operations while leaving ordinary Metadata API behavior untouched.

## What it enables

- Retrieve supported Data 360 resources into a predictable project structure.
- Review and version JSON configuration alongside the rest of a Salesforce project.
- Run dry-runs and targeted deployments through the Connect API.
- Inspect schemas, query data, and operate the broader Data 360 lifecycle from one CLI.
- Reuse the same authenticated workflow across multiple Salesforce orgs.

> **Project status:** Independent, experimental open-source software. It is not an official Salesforce product and is not supported or endorsed by Salesforce, Inc. Use it at your own risk.

## Quick Start

```bash
# Clone and install
git clone https://github.com/stijnhoste/sf-cli-plugin-data360.git
cd sf-cli-plugin-data360
yarn install

# Link to Salesforce CLI
sf plugins link .

# Verify
sf data360 man

# Authenticate to a Data Cloud org
sf org login web -a myorg

# Try it
sf data360 dmo list --all -o myorg
sf data360 query sql -o myorg --sql 'SELECT COUNT(*) FROM "ssot__Individual__dlm"'
```

## Project File Retrieve and Deploy

Data 360 resources are not Salesforce Metadata API components, so this plugin intercepts Data 360-scoped `sf project retrieve start` and `sf project deploy start` invocations before the core Metadata API command runs. Ordinary Metadata API retrieves and deploys continue to use the stock Salesforce CLI behavior.

```bash
# Retrieve Data 360 metadata into force-app/main/default/data360/<type>/<name>.json.
sf project retrieve start -o myorg --metadata Data360DataGraph:IndividualGraph
sf project retrieve start -o myorg --metadata dmo --all --output-dir force-app/main/default

# The same Data 360-native workflow is available under the data360 namespace.
sf data360 project retrieve start -o myorg --metadata Data360DataGraph:IndividualGraph
sf data360 project retrieve start -o myorg --metadata dmo --all --output-dir force-app/main/default

# Deploy retrieved JSON payloads back through the Data 360 Connect API.
sf project deploy start -o myorg --source-dir force-app/main/default/data360
sf project deploy start -o myorg --metadata Data360DataGraph:IndividualGraph --dry-run

# Namespace equivalents.
sf data360 project deploy start -o myorg --source-dir force-app/main/default/data360
sf data360 project deploy start -o myorg --metadata Data360DataGraph:IndividualGraph --dry-run
```

The file layout is:

```text
force-app/main/default/data360/
  data-graphs/IndividualGraph.json
  data-model-objects/UnifiedIndividual__dlm.json
  segments/HighValue.json
```

## Man Pages

```bash
# Command reference
sf data360 man dmo list
sf data360 man segment publish

# Browse all topics
sf data360 man
```

## Command reference

| Topic                 | Commands | Description                                 |
| --------------------- | -------- | ------------------------------------------- |
| `connection`          | 23       | Manage connectors and connections           |
| `data-stream`         | 7        | Create and manage data streams              |
| `dlo`                 | 5        | Data Lake Objects                           |
| `dmo`                 | 16       | Data Model Objects, mappings, relationships |
| `transform`           | 13       | Data transforms                             |
| `docai`               | 9        | Document AI                                 |
| `identity-resolution` | 6        | Identity resolution rulesets                |
| `data-graph`          | 7        | Data graphs                                 |
| `profile`             | 5        | Unified profiles                            |
| `segment`             | 10       | Market segments                             |
| `calculated-insight`  | 6        | Calculated insights                         |
| `activation`          | 7        | Activations                                 |
| `activation-target`   | 4        | Activation targets                          |
| `data-action`         | 2        | Data actions                                |
| `data-action-target`  | 5        | Data action targets                         |
| `query`               | 11       | SQL, vector search, async queries           |
| `search-index`        | 6        | Semantic search indexes                     |
| `data-space`          | 7        | Data spaces                                 |
| `data-kit`            | 3        | Data kits (bundles)                         |
| `insight`             | 3        | Insights                                    |
| `metadata`            | 3        | Metadata introspection                      |
| `project`             | 2        | Retrieve and deploy project files           |
| `universal-id`        | 1        | Universal ID lookup                         |
| `doctor`              | 1        | Health check                                |

## Claude Code / Cursor Skills

7 skills aligned to the [Data Cloud Reference Architecture](https://staging.architect.salesforce.com/docs/architect/fundamentals/guide/data-360-architecture.html) are available in a separate repo: [sf-data360-skills](https://github.com/gthoppae/sf-data360-skills).

## Testing

```bash
# Run the full test suite
npx mocha 'test/**/*.test.ts' --timeout 120000

# Fast tests only (excludes smoke + inventory)
npx mocha 'test/lib/**/*.test.ts' 'test/commands/crud/*.test.ts' 'test/commands/handtuned/*.test.ts'
```

## Prerequisites

- Node.js >= 18
- Salesforce CLI (`sf`) installed
- A Salesforce org with Data Cloud provisioned
- Org authenticated: `sf org login web -a <alias>`

## License

MIT

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. This is not an official Salesforce product. It is not supported by Salesforce and no SLA or support agreement applies. The authors are not responsible for any damage or data loss resulting from its use.
