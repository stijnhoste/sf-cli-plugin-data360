# sf-cli-plugin-data360

> **DISCLAIMER**: This is NOT an official Salesforce product. It is an unsupported, experimental CLI plugin created for internal exploration and demo purposes. No support, warranty, or maintenance is provided. Use at your own risk. This plugin is not endorsed by, affiliated with, or supported by Salesforce, Inc.

A Salesforce CLI plugin for managing Data Cloud (Data 360) resources via the Connect API. 163 commands across 25 topics covering the full Data Cloud lifecycle: Connect, Prepare, Harmonize, Segment, Act, Retrieve, and project file workflows.

## Quick Start

```bash
# Clone and install
git clone git@github.com:gthoppae/sf-cli-plugin-data360.git
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

## Command Topics (163 commands)

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
# Run all tests (86 tests)
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
