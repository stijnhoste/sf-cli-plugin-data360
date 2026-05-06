NAME
sf data360 project deploy start

SYNOPSIS
sf data360 project deploy start -o <org> [-d <dir>...] [-m <type[:name]>...] [--operation upsert|create|update] [--dry-run]

DESCRIPTION
Deploy Data 360 metadata from structured project files.

The command reads JSON files under:

<source-dir>/data360/<resource-type>/<component-name>.json

Each file is sent to the matching Data 360 Connect REST API create or update endpoint.

EXAMPLES
sf data360 project deploy start -o myorg -d force-app/main/default/data360
sf data360 project deploy start -o myorg -m Data360DataGraph:IndividualGraph --dry-run

FLAGS
--api-version Override API version (default: 66.0)
--target-org (required) Target org alias or username
--source-dir Path to Data 360 source files or directories
--metadata Data 360 metadata component to deploy
--operation Deployment operation: upsert, create, or update
--dry-run Validate local files without writing to the org
--timing Print timing breakdown to stderr

TESTING
Unit tested: yes
Smoke tested: yes
