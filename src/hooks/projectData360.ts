import { Hook } from '@oclif/core';
import { Org, SfError } from '@salesforce/core';
import {
  deployComponent,
  DeployWriteResult,
  getComponentName,
  getData360MetadataType,
  listComponents,
  parseMetadataEntries,
  readProjectFiles,
  resolveOutputRoot,
  retrieveComponent,
  RetrieveWriteResult,
  writeComponentFile,
} from '../shared/data360/projectMetadata.js';
import { DEFAULT_API_VERSION, normalizeApiVersion } from '../shared/data360/apiVersion.js';

type ParsedProjectFlags = {
  all: boolean;
  apiVersion: string;
  dryRun: boolean;
  json: boolean;
  metadata: string[];
  operation: 'upsert' | 'create' | 'update';
  outputDir?: string;
  sourceDirs: string[];
  targetOrg?: string;
};

type HookResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      result: unknown;
    };

type OrgFactory = (aliasOrUsername: string) => Promise<Org>;

const retrieveCommandIds = new Set(['project retrieve start', 'project:retrieve:start', 'retrieve metadata']);
const deployCommandIds = new Set(['project deploy start', 'project:deploy:start', 'deploy metadata']);

const data360SourcePattern = /(^|[/\\])data360([/\\]|$)/;

const metadataFlags = new Set(['-m', '--metadata']);
const sourceDirFlags = new Set(['-d', '--source-dir']);
const outputDirFlags = new Set(['-r', '--output-dir']);
const targetOrgFlags = new Set(['-o', '--target-org']);
const apiVersionFlags = new Set(['-a', '--api-version']);
const operationFlags = new Set(['-p', '--operation']);

const flagMatches = (arg: string, flags: Set<string>): boolean =>
  flags.has(arg) || [...flags].some((flag) => arg.startsWith(`${flag}=`));

const readFlagValue = (argv: string[], index: number, flag: string): { value?: string; consumed: number } => {
  const arg = argv[index];
  const equalsPrefix = `${flag}=`;
  if (arg.startsWith(equalsPrefix)) return { value: arg.slice(equalsPrefix.length), consumed: 1 };
  return { value: argv[index + 1], consumed: 2 };
};

const normalizeCommandId = (id: string | undefined): string => (id ?? '').replace(/:/g, ' ').trim();

const isData360MetadataEntry = (entry: string): boolean => {
  const [typeName] = entry.split(':');
  try {
    getData360MetadataType(typeName);
    return true;
  } catch {
    return false;
  }
};

const applyValueFlag = (flags: ParsedProjectFlags, argv: string[], index: number): number | undefined => {
  const arg = argv[index];
  if (flagMatches(arg, metadataFlags)) {
    const parsed = readFlagValue(argv, index, '--metadata');
    if (parsed.value) flags.metadata.push(parsed.value);
    return parsed.consumed;
  }

  if (flagMatches(arg, sourceDirFlags)) {
    const parsed = readFlagValue(argv, index, '--source-dir');
    if (parsed.value) flags.sourceDirs.push(parsed.value);
    return parsed.consumed;
  }

  if (flagMatches(arg, outputDirFlags)) {
    const parsed = readFlagValue(argv, index, '--output-dir');
    flags.outputDir = parsed.value;
    return parsed.consumed;
  }

  if (flagMatches(arg, targetOrgFlags)) {
    const parsed = readFlagValue(argv, index, '--target-org');
    flags.targetOrg = parsed.value;
    return parsed.consumed;
  }

  if (flagMatches(arg, apiVersionFlags)) {
    const parsed = readFlagValue(argv, index, '--api-version');
    if (parsed.value) flags.apiVersion = normalizeApiVersion(parsed.value);
    return parsed.consumed;
  }

  if (flagMatches(arg, operationFlags)) {
    const parsed = readFlagValue(argv, index, '--operation');
    if (parsed.value === 'create' || parsed.value === 'update' || parsed.value === 'upsert') {
      flags.operation = parsed.value;
    }
    return parsed.consumed;
  }
};

export const parseProjectFlags = (argv: string[]): ParsedProjectFlags => {
  const flags: ParsedProjectFlags = {
    all: false,
    apiVersion: DEFAULT_API_VERSION,
    dryRun: false,
    json: false,
    metadata: [],
    operation: 'upsert',
    sourceDirs: [],
  };

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    if (arg === '--json' || arg === '--all' || arg === '--dry-run') {
      if (arg === '--json') flags.json = true;
      if (arg === '--all') flags.all = true;
      if (arg === '--dry-run') flags.dryRun = true;
      i += 1;
      continue;
    }

    const consumed = applyValueFlag(flags, argv, i);
    if (consumed) {
      i += consumed;
      continue;
    }

    i += 1;
  }

  return flags;
};

const shouldHandleRetrieve = (commandId: string, flags: ParsedProjectFlags): boolean =>
  retrieveCommandIds.has(commandId) && flags.metadata.some(isData360MetadataEntry);

const shouldHandleDeploy = (commandId: string, flags: ParsedProjectFlags): boolean =>
  deployCommandIds.has(commandId) &&
  (flags.metadata.some(isData360MetadataEntry) ||
    flags.sourceDirs.some((sourceDir) => data360SourcePattern.test(sourceDir)));

const printResult = (result: unknown, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify({ status: 0, result }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

const requireTargetOrg = (flags: ParsedProjectFlags): string => {
  if (flags.targetOrg) return flags.targetOrg;
  throw new SfError('Data 360 project retrieve/deploy requires --target-org when invoked through sf project commands.');
};

const runRetrieve = async (
  org: Org,
  flags: ParsedProjectFlags
): Promise<{ outputDir: string; files: RetrieveWriteResult[] }> => {
  const refs = parseMetadataEntries(flags.metadata);
  const outputRoot = await resolveOutputRoot(flags.outputDir);
  const files = (
    await Promise.all(
      refs.map(async (ref): Promise<RetrieveWriteResult[]> => {
        const records = ref.name
          ? [await retrieveComponent(org, flags.apiVersion, ref.type, ref.name)]
          : await listComponents(org, flags.apiVersion, ref.type, flags.all);

        return Promise.all(
          records.map(async (record): Promise<RetrieveWriteResult> => {
            const name = getComponentName(ref.type, record, ref.name);
            const detail = ref.name ? record : await retrieveComponent(org, flags.apiVersion, ref.type, name);
            const filePath = await writeComponentFile(outputRoot, ref.type, name, detail);
            return { type: ref.type.type, name, filePath };
          })
        );
      })
    )
  ).flat();

  return { outputDir: outputRoot, files };
};

const runDeploy = async (
  org: Org,
  flags: ParsedProjectFlags
): Promise<{ sourceDirs: string[]; dryRun: boolean; files: DeployWriteResult[] }> => {
  const filters = flags.metadata.length ? parseMetadataEntries(flags.metadata) : undefined;
  const sourceDirs = flags.sourceDirs.length ? flags.sourceDirs : [`${await resolveOutputRoot()}/data360`];
  const files = await readProjectFiles(sourceDirs, filters);
  const results = await Promise.all(
    files.map(async (file): Promise<DeployWriteResult> => {
      const operation = flags.dryRun ? 'dry-run' : await deployComponent(org, flags.apiVersion, file, flags.operation);
      return { type: file.type.type, name: file.name, filePath: file.path, operation };
    })
  );

  return { sourceDirs, dryRun: flags.dryRun, files: results };
};

export const runProjectData360Hook = async (
  commandId: string | undefined,
  argv: string[],
  orgFactory: OrgFactory = async (aliasOrUsername: string): Promise<Org> => Org.create({ aliasOrUsername })
): Promise<HookResult> => {
  const normalizedCommandId = normalizeCommandId(commandId);
  const flags = parseProjectFlags(argv);

  if (!shouldHandleRetrieve(normalizedCommandId, flags) && !shouldHandleDeploy(normalizedCommandId, flags)) {
    return { handled: false };
  }

  const org = await orgFactory(requireTargetOrg(flags));
  const result = shouldHandleRetrieve(normalizedCommandId, flags)
    ? await runRetrieve(org, flags)
    : await runDeploy(org, flags);

  printResult(result, flags.json);
  return { handled: true, result };
};

const hook: Hook.Prerun = async function ({ Command, argv }) {
  const result = await runProjectData360Hook(Command.id, argv);
  if (result.handled) {
    process.exit(0);
  }
};

export default hook;
