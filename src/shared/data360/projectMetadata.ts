import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { SfError, SfProject } from '@salesforce/core';
import { Org } from '@salesforce/core';
import { buildPath, injectResourceId } from './pathBuilder.js';
import { fetchAllPages, fetchPage } from './pagination.js';
import { ssotGet, ssotPatch, ssotPost, ssotPut } from './ssotClient.js';

export type Data360MetadataType = {
  type: string;
  aliases: string[];
  directoryName: string;
  listEndpoint: string;
  listQuery?: Record<string, string | number | boolean | undefined>;
  detailEndpoint: string;
  createEndpoint: string;
  updateEndpoint: string;
  arrayKey?: string;
  nameFields: string[];
  updateMethod?: 'PATCH' | 'PUT';
};

export type Data360ComponentRef = {
  type: Data360MetadataType;
  name?: string;
};

export type Data360ProjectFile = {
  type: Data360MetadataType;
  path: string;
  name: string;
  body: Record<string, unknown>;
};

export type RetrieveWriteResult = {
  type: string;
  name: string;
  filePath: string;
};

export type DeployWriteResult = {
  type: string;
  name: string;
  filePath: string;
  operation: 'create' | 'update' | 'dry-run';
};

const DATA360_DIR = 'data360';
const DEFAULT_BATCH_SIZE = 200;

const normalizeTypeKey = (value: string): string => value.replace(/[\s_-]/g, '').toLowerCase();

export const data360MetadataTypes: Data360MetadataType[] = [
  {
    type: 'Data360Activation',
    aliases: ['activation', 'activations', 'Data360Activation'],
    directoryName: 'activations',
    listEndpoint: '/activations',
    detailEndpoint: '/activations/:name',
    createEndpoint: '/activations',
    updateEndpoint: '/activations/:name',
    updateMethod: 'PUT',
    arrayKey: 'activations',
    nameFields: ['id', 'activationId', 'name', 'apiName', 'developerName'],
  },
  {
    type: 'Data360ActivationTarget',
    aliases: ['activation-target', 'activation-targets', 'Data360ActivationTarget'],
    directoryName: 'activation-targets',
    listEndpoint: '/activation-targets',
    detailEndpoint: '/activation-targets/:name',
    createEndpoint: '/activation-targets',
    updateEndpoint: '/activation-targets/:name',
    nameFields: ['id', 'activationTargetId', 'name', 'apiName', 'developerName'],
  },
  {
    type: 'Data360CalculatedInsight',
    aliases: ['calculated-insight', 'calculated-insights', 'Data360CalculatedInsight'],
    directoryName: 'calculated-insights',
    listEndpoint: '/calculated-insights',
    detailEndpoint: '/calculated-insights/:name',
    createEndpoint: '/calculated-insights',
    updateEndpoint: '/calculated-insights/:name',
    arrayKey: 'collection.items',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
  },
  {
    type: 'Data360Connection',
    aliases: ['connection', 'connections', 'Data360Connection'],
    directoryName: 'connections',
    listEndpoint: '/connections',
    listQuery: { connectorType: 'SalesforceDotCom' },
    detailEndpoint: '/connections/:name',
    createEndpoint: '/connections',
    updateEndpoint: '/connections/:name',
    arrayKey: 'connections',
    nameFields: ['id', 'name', 'developerName', 'label'],
  },
  {
    type: 'Data360DataAction',
    aliases: ['data-action', 'data-actions', 'Data360DataAction'],
    directoryName: 'data-actions',
    listEndpoint: '/data-actions',
    detailEndpoint: '/data-actions/:name',
    createEndpoint: '/data-actions',
    updateEndpoint: '/data-actions/:name',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
  },
  {
    type: 'Data360DataActionTarget',
    aliases: ['data-action-target', 'data-action-targets', 'Data360DataActionTarget'],
    directoryName: 'data-action-targets',
    listEndpoint: '/data-action-targets',
    detailEndpoint: '/data-action-targets/:name',
    createEndpoint: '/data-action-targets',
    updateEndpoint: '/data-action-targets/:name',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
  },
  {
    type: 'Data360DataGraph',
    aliases: ['data-graph', 'data-graphs', 'Data360DataGraph'],
    directoryName: 'data-graphs',
    listEndpoint: '/data-graphs/metadata',
    detailEndpoint: '/data-graphs/:name',
    createEndpoint: '/data-graphs',
    updateEndpoint: '/data-graphs/:name',
    nameFields: ['name', 'apiName', 'developerName', 'id'],
  },
  {
    type: 'Data360DataLakeObject',
    aliases: ['dlo', 'data-lake-object', 'data-lake-objects', 'Data360DataLakeObject'],
    directoryName: 'data-lake-objects',
    listEndpoint: '/data-lake-objects',
    detailEndpoint: '/data-lake-objects/:name',
    createEndpoint: '/data-lake-objects',
    updateEndpoint: '/data-lake-objects/:name',
    nameFields: ['developerName', 'name', 'apiName', 'id'],
  },
  {
    type: 'Data360DataModelObject',
    aliases: ['dmo', 'data-model-object', 'data-model-objects', 'Data360DataModelObject'],
    directoryName: 'data-model-objects',
    listEndpoint: '/data-model-objects',
    detailEndpoint: '/data-model-objects/:name',
    createEndpoint: '/data-model-objects',
    updateEndpoint: '/data-model-objects/:name',
    nameFields: ['developerName', 'name', 'apiName', 'id'],
  },
  {
    type: 'Data360DataModelObjectMapping',
    aliases: [
      'dmo-mapping',
      'data-model-object-mapping',
      'data-model-object-mappings',
      'Data360DataModelObjectMapping',
    ],
    directoryName: 'data-model-object-mappings',
    listEndpoint: '/data-model-object-mappings',
    detailEndpoint: '/data-model-object-mappings/:name',
    createEndpoint: '/data-model-object-mappings',
    updateEndpoint: '/data-model-object-mappings/:name',
    arrayKey: 'objectSourceTargetMaps',
    nameFields: ['developerName', 'objectSourceTargetMapDeveloperName', 'name', 'id'],
  },
  {
    type: 'Data360DataSpace',
    aliases: ['data-space', 'data-spaces', 'Data360DataSpace'],
    directoryName: 'data-spaces',
    listEndpoint: '/data-spaces',
    detailEndpoint: '/data-spaces/:name',
    createEndpoint: '/data-spaces',
    updateEndpoint: '/data-spaces/:name',
    nameFields: ['name', 'developerName', 'apiName', 'id'],
  },
  {
    type: 'Data360DataStream',
    aliases: ['data-stream', 'data-streams', 'Data360DataStream'],
    directoryName: 'data-streams',
    listEndpoint: '/data-streams',
    detailEndpoint: '/data-streams/:name',
    createEndpoint: '/data-streams',
    updateEndpoint: '/data-streams/:name',
    nameFields: ['developerName', 'name', 'apiName', 'id'],
  },
  {
    type: 'Data360DataTransform',
    aliases: ['transform', 'data-transform', 'data-transforms', 'Data360DataTransform'],
    directoryName: 'data-transforms',
    listEndpoint: '/data-transforms',
    detailEndpoint: '/data-transforms/:name',
    createEndpoint: '/data-transforms',
    updateEndpoint: '/data-transforms/:name',
    updateMethod: 'PUT',
    nameFields: ['name', 'developerName', 'apiName', 'id'],
  },
  {
    type: 'Data360DocumentProcessingConfiguration',
    aliases: ['docai-config', 'document-processing-configuration', 'Data360DocumentProcessingConfiguration'],
    directoryName: 'document-processing-configurations',
    listEndpoint: '/document-processing/configurations',
    detailEndpoint: '/document-processing/configurations/:name',
    createEndpoint: '/document-processing/configurations',
    updateEndpoint: '/document-processing/configurations/:name',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
  },
  {
    type: 'Data360IdentityResolution',
    aliases: ['identity-resolution', 'identity-resolutions', 'Data360IdentityResolution'],
    directoryName: 'identity-resolutions',
    listEndpoint: '/identity-resolutions',
    detailEndpoint: '/identity-resolutions/:name',
    createEndpoint: '/identity-resolutions',
    updateEndpoint: '/identity-resolutions/:name',
    nameFields: ['name', 'developerName', 'apiName', 'id'],
  },
  {
    type: 'Data360SearchIndex',
    aliases: ['search-index', 'search-indexes', 'Data360SearchIndex'],
    directoryName: 'search-indexes',
    listEndpoint: '/search-index',
    detailEndpoint: '/search-index/:name',
    createEndpoint: '/search-index',
    updateEndpoint: '/search-index/:name',
    arrayKey: 'semanticSearchDefinitionDetails',
    nameFields: ['developerName', 'name', 'apiName', 'id'],
  },
  {
    type: 'Data360Segment',
    aliases: ['segment', 'segments', 'Data360Segment'],
    directoryName: 'segments',
    listEndpoint: '/segments',
    detailEndpoint: '/segments/:name',
    createEndpoint: '/segments',
    updateEndpoint: '/segments/:name',
    arrayKey: 'segments',
    nameFields: ['segmentApiName', 'apiName', 'developerName', 'name', 'id'],
  },
];

const typeByAlias = new Map(
  data360MetadataTypes.flatMap((metadataType) =>
    metadataType.aliases.map((alias): [string, Data360MetadataType] => [normalizeTypeKey(alias), metadataType])
  )
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getPath = (record: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (isRecord(acc) ? acc[key] : undefined), record);

const firstString = (record: Record<string, unknown>, fields: string[]): string | undefined => {
  for (const field of fields) {
    const value = getPath(record, field);
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
};

export const getData360MetadataType = (input: string): Data360MetadataType => {
  const type = typeByAlias.get(normalizeTypeKey(input));
  if (!type) {
    throw new SfError(
      `Unsupported Data 360 metadata type "${input}". Supported types: ${data360MetadataTypes
        .map((metadataType) => metadataType.type)
        .join(', ')}`,
      'DATA360_METADATA_TYPE_UNSUPPORTED'
    );
  }
  return type;
};

export const parseMetadataEntries = (entries: string[] | undefined): Data360ComponentRef[] => {
  if (!entries?.length) {
    return data360MetadataTypes.map((type) => ({ type }));
  }

  return entries.map((entry) => {
    const [typeName, ...nameParts] = entry.split(':');
    const name = nameParts.join(':') || undefined;
    return { type: getData360MetadataType(typeName), name: name === '*' ? undefined : name };
  });
};

export const getComponentName = (
  type: Data360MetadataType,
  body: Record<string, unknown>,
  fallback?: string
): string => {
  const value = firstString(body, type.nameFields) ?? fallback;
  if (!value) {
    throw new SfError(`Could not determine a component name for ${type.type}.`, 'DATA360_METADATA_NAME_MISSING');
  }
  return value;
};

export const sanitizeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '_');

export const resolveProjectDefaultRoot = async (): Promise<string> => {
  const project = await SfProject.resolve();
  return join(project.getDefaultPackage().fullPath, 'main', 'default');
};

export const resolveOutputRoot = async (outputDir?: string): Promise<string> =>
  resolve(outputDir ?? (await resolveProjectDefaultRoot()));

const componentFilePath = (outputRoot: string, type: Data360MetadataType, name: string): string =>
  join(outputRoot, DATA360_DIR, type.directoryName, `${sanitizeFileName(name)}.json`);

export const writeComponentFile = async (
  outputRoot: string,
  type: Data360MetadataType,
  name: string,
  body: Record<string, unknown>
): Promise<string> => {
  const filePath = componentFilePath(outputRoot, type, name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return filePath;
};

const readJsonObject = async (filePath: string): Promise<Record<string, unknown>> => {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new SfError(
      `Data 360 metadata file must contain a JSON object: ${filePath}`,
      'DATA360_METADATA_FILE_INVALID'
    );
  }
  return parsed;
};

const findJsonFiles = async (inputPath: string): Promise<string[]> => {
  const resolved = resolve(inputPath);
  const info = await stat(resolved);
  if (info.isFile()) return extname(resolved) === '.json' ? [resolved] : [];

  const entries = await readdir(resolved, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => findJsonFiles(join(resolved, entry.name)).catch(() => [] as string[]))
  );
  return nested.flat();
};

const inferTypeFromPath = (filePath: string): Data360MetadataType | undefined => {
  const parts = filePath.split(sep);
  const data360Index = parts.lastIndexOf(DATA360_DIR);
  if (data360Index === -1 || data360Index + 1 >= parts.length) return undefined;
  return data360MetadataTypes.find((type) => type.directoryName === parts[data360Index + 1]);
};

export const readProjectFiles = async (
  sourceDirs: string[],
  filters?: Data360ComponentRef[]
): Promise<Data360ProjectFile[]> => {
  const files = (await Promise.all(sourceDirs.map(findJsonFiles))).flat().sort();
  const filterKeys = new Set(filters?.map((filter) => `${filter.type.type}:${filter.name ?? '*'}`) ?? []);
  const output = await Promise.all(
    files.map(async (file): Promise<Data360ProjectFile | undefined> => {
      const type = inferTypeFromPath(file);
      if (!type) return undefined;
      const body = await readJsonObject(file);
      const fallbackName = basename(file, '.json');
      const name = getComponentName(type, body, fallbackName);
      if (filters?.length) {
        const exactKey = `${type.type}:${name}`;
        const wildcardKey = `${type.type}:*`;
        if (!filterKeys.has(exactKey) && !filterKeys.has(wildcardKey)) return undefined;
      }
      return { type, path: file, name, body };
    })
  );

  return output.filter((file): file is Data360ProjectFile => file !== undefined);
};

const pickFields = (body: Record<string, unknown>, fields: string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));

const getDeployBody = (file: Data360ProjectFile): Record<string, unknown> => {
  if (file.type.type === 'Data360DataTransform') {
    return pickFields(file.body, ['name', 'label', 'description', 'type', 'definition']);
  }
  return file.body;
};

const getRecordsFromListResponse = (response: unknown, arrayKey?: string): Array<Record<string, unknown>> => {
  if (Array.isArray(response)) return response.filter(isRecord);
  if (!isRecord(response)) return [];

  const keyed = arrayKey ? getPath(response, arrayKey) : undefined;
  if (Array.isArray(keyed)) return keyed.filter(isRecord);

  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [];
};

export const retrieveComponent = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType,
  name: string
): Promise<Record<string, unknown>> => {
  const response = await ssotGet<Record<string, unknown>>(org, apiVersion, injectResourceId(type.detailEndpoint, name));
  return isRecord(response) ? response : {};
};

export const listComponents = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType,
  fetchAll: boolean
): Promise<Array<Record<string, unknown>>> => {
  if (fetchAll) {
    return fetchAllPages<Record<string, unknown>>(
      org,
      apiVersion,
      buildPath(type.listEndpoint, undefined, type.listQuery),
      { all: true, batchSize: DEFAULT_BATCH_SIZE },
      undefined,
      type.arrayKey
    );
  }

  const page = await fetchPage<Record<string, unknown>>(
    org,
    apiVersion,
    buildPath(type.listEndpoint, undefined, type.listQuery),
    0,
    DEFAULT_BATCH_SIZE,
    undefined,
    type.arrayKey
  );
  if (page.data.length) return page.data;

  const response = await ssotGet<unknown>(org, apiVersion, buildPath(type.listEndpoint, undefined, type.listQuery));
  return getRecordsFromListResponse(response, type.arrayKey);
};

export const deployComponent = async (
  org: Org,
  apiVersion: string,
  file: Data360ProjectFile,
  operation: 'create' | 'update' | 'upsert'
): Promise<'create' | 'update'> => {
  if (operation === 'create') {
    await ssotPost<Record<string, unknown>>(org, apiVersion, file.type.createEndpoint, getDeployBody(file));
    return 'create';
  }

  const update = async (): Promise<void> => {
    const path = injectResourceId(file.type.updateEndpoint, file.name);
    const body = getDeployBody(file);
    if (file.type.updateMethod === 'PUT') {
      await ssotPut<Record<string, unknown>>(org, apiVersion, path, body);
      return;
    }
    await ssotPatch<Record<string, unknown>>(org, apiVersion, path, body);
  };

  if (operation === 'update') {
    await update();
    return 'update';
  }

  try {
    await update();
    return 'update';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('404') && !message.toLowerCase().includes('not found')) throw error;
    await ssotPost<Record<string, unknown>>(org, apiVersion, file.type.createEndpoint, getDeployBody(file));
    return 'create';
  }
};

export const toDisplayPath = (filePath: string): string => relative(process.cwd(), filePath) || filePath;
