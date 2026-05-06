NAME
sf data360 project retrieve start

SYNOPSIS
sf data360 project retrieve start -o <org> [-m <type[:name]>...] [-r <dir>] [--all]

DESCRIPTION
Retrieve Data 360 metadata into structured project files.

Data 360 resources are retrieved through the Data 360 Connect REST API and written as JSON under:

<output-dir>/data360/<resource-type>/<component-name>.json

If --output-dir is omitted, the command uses the default Salesforce DX package root plus main/default.

EXAMPLES
sf data360 project retrieve start -o myorg -m Data360DataGraph:IndividualGraph
sf data360 project retrieve start -o myorg -m dmo --all -r force-app/main/default

FLAGS
--api-version Override API version (default: 66.0)
--target-org (required) Target org alias or username
--metadata Data 360 metadata component to retrieve
--output-dir Directory root for retrieved Data 360 files
--all Fetch all pages when retrieving a whole metadata type
--timing Print timing breakdown to stderr

TESTING
Unit tested: yes
Smoke tested: yes
