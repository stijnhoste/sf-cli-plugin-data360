import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { SfError, SfProject } from '@salesforce/core';
import { Org } from '@salesforce/core';
import { buildPath } from './pathBuilder.js';
import { fetchAllPages, fetchPage } from './pagination.js';
import { ssotGet, ssotPatch, ssotPost, ssotPut } from './ssotClient.js';

export type Data360MetadataType = {
  type: string;
  aliases: string[];
  directoryName: string;
  listEndpoint?: string;
  listQuery?: Record<string, string | number | boolean | undefined>;
  detailEndpoint?: string;
  createEndpoint?: string;
  updateEndpoint?: string;
  arrayKey?: string;
  nameFields: string[];
  pathParamFields?: Record<string, string[]>;
  projectNameFields?: string[];
  compositeNameFields?: string[];
  singletonName?: string;
  createMethod?: 'POST' | 'PUT';
  updateMethod?: 'PATCH' | 'PUT';
  createUnsupportedReason?: string;
  updateUnsupportedReason?: string;
  deployUnsupportedReason?: string;
  /** Custom list strategy when the generic list endpoint can't be bulk-queried. */
  customList?:
    | 'dmoMappings'
    | 'dmoRelationships'
    | 'dataSpaceMembers'
    | 'dataTransformSchedules'
    | 'connectionSchemas'
    | 'connectionSitemaps'
    | 'mlModelSetupVersions'
    | 'mlModelSetupVersionPartitions'
    | 'singleton';
  /** When true, list responses already contain full detail and retrieve can skip the per-record GET. */
  listReturnsDetail?: boolean;
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
  operation: 'create' | 'update' | 'dry-run' | 'skipped';
  skippedReason?: string;
};

export type DeployComponentResult = Pick<DeployWriteResult, 'operation' | 'skippedReason'>;

const DATA360_DIR = 'data360';
const DEFAULT_BATCH_SIZE = 200;

const normalizeTypeKey = (value: string): string => value.replace(/[\s_-]/g, '').toLowerCase();

export const data360MetadataTypes: Data360MetadataType[] = [
  {
    type: 'Data360ActivationExternalPlatform',
    aliases: ['activation-external-platform', 'activation-external-platforms', 'Data360ActivationExternalPlatform'],
    directoryName: 'activation-external-platforms',
    listEndpoint: '/activation-external-platforms',
    arrayKey: 'externalPlatforms',
    nameFields: ['id', 'name', 'apiName', 'developerName', 'platformName'],
    listReturnsDetail: true,
    deployUnsupportedReason: 'Activation external platforms are a read-only catalogue in the Data 360 API.',
  },
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
    pathParamFields: { name: ['id', 'name', 'developerName', 'label'] },
    deployUnsupportedReason:
      'Connection updates require a connector-specific polymorphic request body that is not present in retrieved connection metadata.',
  },
  {
    type: 'Data360ConnectionSchema',
    aliases: ['connection-schema', 'connection-schemas', 'Data360ConnectionSchema'],
    directoryName: 'connection-schemas',
    detailEndpoint: '/connections/:connectionId/schema',
    updateEndpoint: '/connections/:connectionId/schema',
    updateMethod: 'PUT',
    nameFields: ['__data360ProjectName', 'connectionId', 'id', 'name'],
    pathParamFields: { connectionId: ['connectionId', 'id', 'name', '__data360ProjectName'] },
    projectNameFields: ['connectionId', 'id', 'name'],
    customList: 'connectionSchemas',
    listReturnsDetail: true,
    createUnsupportedReason: 'Connection schemas are upserted with the update operation.',
  },
  {
    type: 'Data360ConnectionSitemap',
    aliases: ['connection-sitemap', 'connection-sitemaps', 'Data360ConnectionSitemap'],
    directoryName: 'connection-sitemaps',
    detailEndpoint: '/connections/:connectionId/sitemap',
    updateEndpoint: '/connections/:connectionId/sitemap',
    updateMethod: 'PUT',
    nameFields: ['__data360ProjectName', 'connectionId', 'id', 'name'],
    pathParamFields: { connectionId: ['connectionId', 'id', 'name', '__data360ProjectName'] },
    projectNameFields: ['connectionId', 'id', 'name'],
    customList: 'connectionSitemaps',
    listReturnsDetail: true,
    createUnsupportedReason: 'Connection sitemaps are upserted with the update operation.',
  },
  {
    type: 'Data360Connector',
    aliases: ['connector', 'connectors', 'Data360Connector'],
    directoryName: 'connectors',
    listEndpoint: '/connectors',
    detailEndpoint: '/connectors/:connectorType',
    arrayKey: 'connectors',
    nameFields: ['name', 'connectorType', 'id', 'apiName', 'developerName'],
    pathParamFields: { connectorType: ['name', 'connectorType', 'id', '__data360ProjectName'] },
    deployUnsupportedReason: 'Connectors are a read-only catalogue in the Data 360 API.',
  },
  {
    type: 'Data360DataAction',
    aliases: ['data-action', 'data-actions', 'Data360DataAction'],
    directoryName: 'data-actions',
    listEndpoint: '/data-actions',
    createEndpoint: '/data-actions',
    arrayKey: 'dataActions',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
    listReturnsDetail: true,
    updateUnsupportedReason: 'Data actions expose create and list APIs, but no update API in the Data 360 swagger.',
  },
  {
    type: 'Data360DataActionTarget',
    aliases: ['data-action-target', 'data-action-targets', 'Data360DataActionTarget'],
    directoryName: 'data-action-targets',
    listEndpoint: '/data-action-targets',
    detailEndpoint: '/data-action-targets/:name',
    createEndpoint: '/data-action-targets',
    arrayKey: 'dataActionTargets',
    nameFields: ['apiName', 'developerName', 'name', 'id'],
    updateUnsupportedReason:
      'Data action targets expose create, get, signing-key, and delete APIs, but no update API in the Data 360 swagger.',
  },
  {
    type: 'Data360DataGraph',
    aliases: ['data-graph', 'data-graphs', 'Data360DataGraph'],
    directoryName: 'data-graphs',
    listEndpoint: '/data-graphs/metadata',
    detailEndpoint: '/data-graphs/:name',
    createEndpoint: '/data-graphs',
    nameFields: ['name', 'apiName', 'developerName', 'id'],
    updateUnsupportedReason:
      'Data graphs expose create, get, refresh, and delete APIs, but no update API in the Data 360 swagger.',
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
    pathParamFields: { name: ['id', 'developerName', 'name', 'apiName'] },
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
    arrayKey: 'objectSourceTargetMaps',
    nameFields: ['developerName', 'objectSourceTargetMapDeveloperName', 'name', 'id'],
    customList: 'dmoMappings',
    listReturnsDetail: true,
    updateUnsupportedReason:
      'DMO mappings expose create, get, and delete APIs, but no update API in the Data 360 swagger.',
  },
  {
    type: 'Data360DataModelObjectRelationship',
    aliases: [
      'dmo-relationship',
      'dmo-relationships',
      'data-model-object-relationship',
      'data-model-object-relationships',
      'Data360DataModelObjectRelationship',
    ],
    directoryName: 'data-model-object-relationships',
    detailEndpoint: '/data-model-objects/:dataModelObjectName/relationships',
    createEndpoint: '/data-model-objects/:dataModelObjectName/relationships',
    arrayKey: 'relationships',
    nameFields: ['__data360ProjectName', 'name', 'developerName', 'id'],
    pathParamFields: { dataModelObjectName: ['dataModelObjectName', 'sourceObjectName', 'sourceDmoName'] },
    projectNameFields: ['dataModelObjectName', 'sourceObjectName', 'sourceDmoName'],
    compositeNameFields: ['dataModelObjectName', 'name'],
    customList: 'dmoRelationships',
    listReturnsDetail: true,
    updateUnsupportedReason:
      'DMO relationships expose bulk create and delete APIs, but no update API in the Data 360 swagger.',
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
    type: 'Data360DataSpaceMember',
    aliases: ['data-space-member', 'data-space-members', 'Data360DataSpaceMember'],
    directoryName: 'data-space-members',
    listEndpoint: '/data-spaces/:idOrName/members',
    detailEndpoint: '/data-spaces/:idOrName/members/:dataSpaceMemberObjectName',
    createEndpoint: '/data-spaces/:idOrName/members',
    updateEndpoint: '/data-spaces/:idOrName/members',
    createMethod: 'PUT',
    updateMethod: 'PUT',
    arrayKey: 'members',
    nameFields: ['__data360ProjectName', 'dataSpaceMemberObjectName', 'name', 'objectName', 'id'],
    pathParamFields: {
      idOrName: ['idOrName', 'dataSpaceName', 'dataSpaceId'],
      dataSpaceMemberObjectName: ['dataSpaceMemberObjectName', 'name', 'objectName', 'id'],
    },
    projectNameFields: ['dataSpaceName', 'idOrName', 'dataSpaceId'],
    compositeNameFields: ['dataSpaceName', 'dataSpaceMemberObjectName'],
    customList: 'dataSpaceMembers',
    listReturnsDetail: true,
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
    type: 'Data360DataTransformSchedule',
    aliases: [
      'transform-schedule',
      'data-transform-schedule',
      'data-transform-schedules',
      'Data360DataTransformSchedule',
    ],
    directoryName: 'data-transform-schedules',
    detailEndpoint: '/data-transforms/:dataTransformNameOrId/schedule',
    updateEndpoint: '/data-transforms/:dataTransformNameOrId/schedule',
    updateMethod: 'PUT',
    nameFields: ['__data360ProjectName', 'dataTransformNameOrId', 'name', 'id'],
    pathParamFields: { dataTransformNameOrId: ['dataTransformNameOrId', 'dataTransformName', 'name', 'id'] },
    projectNameFields: ['dataTransformNameOrId', 'dataTransformName', 'name', 'id'],
    customList: 'dataTransformSchedules',
    listReturnsDetail: true,
    createUnsupportedReason: 'Data transform schedules are upserted with the update operation.',
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
    type: 'Data360InsightMetadata',
    aliases: ['insight-metadata', 'insights-metadata', 'Data360InsightMetadata'],
    directoryName: 'insight-metadata',
    listEndpoint: '/insight/metadata',
    detailEndpoint: '/insight/metadata/:ciName',
    arrayKey: 'metadata',
    nameFields: ['name', 'apiName', 'developerName', 'ciName', 'id'],
    pathParamFields: { ciName: ['name', 'apiName', 'developerName', 'ciName', 'id', '__data360ProjectName'] },
    listReturnsDetail: true,
    deployUnsupportedReason: 'Insight metadata is read-only in the Data 360 API.',
  },
  {
    type: 'Data360MachineLearningConfiguredModel',
    aliases: [
      'machine-learning-configured-model',
      'machine-learning-configured-models',
      'ml-configured-model',
      'ml-configured-models',
      'Data360MachineLearningConfiguredModel',
    ],
    directoryName: 'machine-learning-configured-models',
    listEndpoint: '/machine-learning/configured-models',
    detailEndpoint: '/machine-learning/configured-models/:configuredModelIdOrName',
    updateEndpoint: '/machine-learning/configured-models/:configuredModelIdOrName',
    arrayKey: 'configuredModels',
    nameFields: ['qualifiedName', 'name', 'developerName', 'apiName', 'id', 'modelSetupId'],
    pathParamFields: {
      configuredModelIdOrName: ['qualifiedName', 'id', 'name', 'developerName', 'apiName', '__data360ProjectName'],
    },
    createUnsupportedReason:
      'Configured models expose list, get, update, and delete APIs, but no create API in the Data 360 swagger.',
  },
  {
    type: 'Data360MachineLearningModelArtifact',
    aliases: [
      'machine-learning-model-artifact',
      'machine-learning-model-artifacts',
      'ml-model-artifact',
      'ml-model-artifacts',
      'Data360MachineLearningModelArtifact',
    ],
    directoryName: 'machine-learning-model-artifacts',
    listEndpoint: '/machine-learning/model-artifacts',
    detailEndpoint: '/machine-learning/model-artifacts/:modelArtifactIdOrName',
    updateEndpoint: '/machine-learning/model-artifacts/:modelArtifactIdOrName',
    arrayKey: 'modelArtifacts',
    nameFields: ['qualifiedName', 'name', 'developerName', 'apiName', 'id'],
    pathParamFields: {
      modelArtifactIdOrName: ['qualifiedName', 'id', 'name', 'developerName', 'apiName', '__data360ProjectName'],
    },
    createUnsupportedReason:
      'Model artifacts expose list, get, update, and delete APIs, but no create API in the Data 360 swagger.',
  },
  {
    type: 'Data360MachineLearningModelSetupVersion',
    aliases: [
      'machine-learning-model-setup-version',
      'machine-learning-model-setup-versions',
      'ml-model-setup-version',
      'ml-model-setup-versions',
      'Data360MachineLearningModelSetupVersion',
    ],
    directoryName: 'machine-learning-model-setup-versions',
    detailEndpoint: '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions/:modelSetupVersionId',
    createEndpoint: '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions',
    updateEndpoint: '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions/:modelSetupVersionId',
    arrayKey: 'versions',
    nameFields: ['__data360ProjectName', 'id', 'name', 'developerName', 'apiName'],
    pathParamFields: {
      modelSetupIdOrName: ['modelSetupIdOrName', 'modelSetupId', 'modelSetupName'],
      modelSetupVersionId: ['modelSetupVersionId', 'id', 'versionId'],
    },
    projectNameFields: ['modelSetupIdOrName', 'modelSetupId', 'modelSetupName'],
    compositeNameFields: ['modelSetupIdOrName', 'modelSetupVersionId'],
    customList: 'mlModelSetupVersions',
    listReturnsDetail: true,
  },
  {
    type: 'Data360MachineLearningModelSetupVersionPartition',
    aliases: [
      'machine-learning-model-setup-version-partition',
      'machine-learning-model-setup-version-partitions',
      'ml-model-setup-version-partition',
      'ml-model-setup-version-partitions',
      'Data360MachineLearningModelSetupVersionPartition',
    ],
    directoryName: 'machine-learning-model-setup-version-partitions',
    detailEndpoint:
      '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions/:modelSetupVersionId/partitions/:modelSetupPartitionId',
    arrayKey: 'partitions',
    nameFields: ['__data360ProjectName', 'id', 'name', 'developerName', 'apiName'],
    pathParamFields: {
      modelSetupIdOrName: ['modelSetupIdOrName', 'modelSetupId', 'modelSetupName'],
      modelSetupVersionId: ['modelSetupVersionId', 'versionId'],
      modelSetupPartitionId: ['modelSetupPartitionId', 'id', 'partitionId'],
    },
    projectNameFields: ['modelSetupIdOrName', 'modelSetupVersionId'],
    compositeNameFields: ['modelSetupIdOrName', 'modelSetupVersionId', 'modelSetupPartitionId'],
    customList: 'mlModelSetupVersionPartitions',
    listReturnsDetail: true,
    deployUnsupportedReason: 'Model setup version partitions are read-only in the Data 360 API.',
  },
  {
    type: 'Data360Metadata',
    aliases: ['metadata', 'Data360Metadata'],
    directoryName: 'metadata',
    listEndpoint: '/metadata',
    arrayKey: 'metadata',
    nameFields: ['name', 'apiName', 'developerName', 'id'],
    listReturnsDetail: true,
    deployUnsupportedReason: 'The Data 360 metadata endpoint is read-only.',
  },
  {
    type: 'Data360MetadataEntity',
    aliases: ['metadata-entity', 'metadata-entities', 'Data360MetadataEntity'],
    directoryName: 'metadata-entities',
    listEndpoint: '/metadata-entities',
    arrayKey: 'metadata',
    nameFields: ['name', 'apiName', 'developerName', 'id'],
    listReturnsDetail: true,
    deployUnsupportedReason: 'Metadata entities are read-only in the Data 360 API.',
  },
  {
    type: 'Data360ProfileMetadata',
    aliases: ['profile-metadata', 'profiles-metadata', 'Data360ProfileMetadata'],
    directoryName: 'profile-metadata',
    listEndpoint: '/profile/metadata',
    detailEndpoint: '/profile/metadata/:dataModelName',
    arrayKey: 'metadata',
    nameFields: ['name', 'apiName', 'developerName', 'dataModelName', 'id'],
    pathParamFields: {
      dataModelName: ['name', 'apiName', 'developerName', 'dataModelName', 'id', '__data360ProjectName'],
    },
    listReturnsDetail: true,
    deployUnsupportedReason: 'Profile metadata is read-only in the Data 360 API.',
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

const pathParamNames = (endpoint: string): string[] =>
  Array.from(endpoint.matchAll(/:([a-zA-Z]\w*)/g), (match) => match[1]);

const compositeNameParts = (name: string | undefined): string[] | undefined => {
  if (!name?.includes('/')) return undefined;
  const parts = name.split('/').filter((part) => part.length > 0);
  return parts.length ? parts : undefined;
};

const firstStringFromAny = (record: Record<string, unknown>, fields: Array<string | undefined>): string | undefined =>
  firstString(
    record,
    fields.filter((field): field is string => Boolean(field))
  );

const fieldValueForPathParam = (
  type: Data360MetadataType,
  body: Record<string, unknown>,
  paramName: string,
  fallbackName?: string
): string | undefined => {
  const configuredFields = type.pathParamFields?.[paramName] ?? [];
  const directValue = firstStringFromAny(body, [
    ...configuredFields,
    paramName,
    '__data360ProjectName',
    'name',
    'developerName',
    'apiName',
    'id',
  ]);
  if (directValue && directValue !== fallbackName) return directValue;

  const compositeFields = type.compositeNameFields ?? [];
  const compositeIndex = compositeFields.indexOf(paramName);
  const fallbackParts = compositeNameParts(fallbackName);
  if (fallbackParts && compositeIndex !== -1) return fallbackParts[compositeIndex];

  return directValue ?? fallbackName;
};

const buildEndpointPath = (
  type: Data360MetadataType,
  endpoint: string | undefined,
  body: Record<string, unknown>,
  fallbackName?: string
): string => {
  if (!endpoint) {
    throw new SfError(`No Data 360 API endpoint is configured for ${type.type}.`, 'DATA360_METADATA_ENDPOINT_MISSING');
  }

  let path = endpoint;
  for (const paramName of pathParamNames(endpoint)) {
    const value = fieldValueForPathParam(type, body, paramName, fallbackName);
    if (!value) {
      throw new SfError(
        `Could not determine path parameter "${paramName}" for ${type.type}. Include it in the source file or use a composite metadata name.`,
        'DATA360_METADATA_PATH_PARAM_MISSING'
      );
    }
    path = path.replace(`:${paramName}`, encodeURIComponent(value));
  }
  return path;
};

const projectNameFromBody = (
  type: Data360MetadataType,
  body: Record<string, unknown>,
  fallback?: string
): string | undefined => {
  if (type.singletonName) return type.singletonName;

  if (type.compositeNameFields?.length) {
    const values = type.compositeNameFields.map((field) => firstString(body, [field]));
    if (values.every((value): value is string => Boolean(value))) return values.join('/');
  }

  return firstString(body, ['__data360ProjectName', ...(type.projectNameFields ?? []), ...type.nameFields]) ?? fallback;
};

const annotateProjectRecord = (
  type: Data360MetadataType,
  record: Record<string, unknown>,
  extra: Record<string, string | undefined> = {}
): Record<string, unknown> => {
  const output: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(extra)) {
    if (value && output[key] === undefined) output[key] = value;
  }
  const projectName = projectNameFromBody(type, output);
  if (projectName && output['__data360ProjectName'] === undefined) output['__data360ProjectName'] = projectName;
  return output;
};

const shouldAnnotateProjectRecord = (type: Data360MetadataType): boolean =>
  Boolean(type.projectNameFields ?? type.compositeNameFields ?? type.singletonName);

const withDerivedFields = (type: Data360MetadataType, record: Record<string, unknown>): Record<string, unknown> => {
  if (
    (type.type === 'Data360MachineLearningConfiguredModel' || type.type === 'Data360MachineLearningModelArtifact') &&
    typeof record.namespace === 'string' &&
    record.namespace.length > 0 &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    record.qualifiedName === undefined
  ) {
    return { ...record, qualifiedName: `${record.namespace}__${record.name}` };
  }
  return record;
};

const prepareListRecords = (
  type: Data360MetadataType,
  records: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => records.map((record) => withDerivedFields(type, record));

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
  const value = projectNameFromBody(type, body, fallback);
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

const unwrapSingletonResponse = (type: Data360MetadataType, body: Record<string, unknown>): Record<string, unknown> => {
  const arrays = [type.arrayKey ? getPath(body, type.arrayKey) : undefined, body.dataLakeObjects, body.segments].filter(
    Array.isArray
  ) as unknown[][];
  const first = arrays.find((array) => array.length === 1)?.[0];
  return isRecord(first) ? first : body;
};

const cleanIdentityResolutionRules = (
  body: Record<string, unknown>,
  operation: 'create' | 'update'
): Record<string, unknown> => {
  const fields =
    operation === 'create'
      ? [
          'configurationType',
          'label',
          'description',
          'rulesetId',
          'doesRunAutomatically',
          'matchRules',
          'reconciliationRules',
        ]
      : ['label', 'matchRules', 'reconciliationRules'];
  const output = pickFields(body, fields);
  if (Array.isArray(output.reconciliationRules)) {
    output.reconciliationRules = output.reconciliationRules.map((rule) => {
      if (!isRecord(rule)) return {};
      const { linkDmoName, unifiedDmoName, ...cleaned } = rule;
      void linkDmoName;
      void unifiedDmoName;
      return cleaned;
    });
  }
  return output;
};

const normalizeSegmentDeployBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const output = { ...body };
  if (isRecord(output.includeDbt) && Array.isArray(output.includeDbt.models)) {
    output.includeDbt = { ...output.includeDbt, models: { models: output.includeDbt.models } };
  }
  return output;
};

const normalizeDataGraphSource = (source: Record<string, unknown>): Record<string, unknown> => {
  const output = { ...source };
  if (output.dataSpaceName !== undefined && output.dataspaceName === undefined) {
    output.dataspaceName = output.dataSpaceName;
  }
  delete output.dataSpaceName;
  if (Array.isArray(output.relatedObjects)) {
    const relatedObjects = output.relatedObjects as unknown[];
    output.relatedObjects = relatedObjects.map((related): unknown =>
      isRecord(related) ? normalizeDataGraphSource(related) : related
    );
  }
  return output;
};

const normalizeDataGraphDeployBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const output = { ...body };
  if (output.dataSpaceName !== undefined && output.dataspaceName === undefined) {
    output.dataspaceName = output.dataSpaceName;
  }
  delete output.dataSpaceName;
  if (isRecord(output.sourceObject)) {
    output.sourceObject = normalizeDataGraphSource(output.sourceObject);
  }
  return output;
};

const getOperationSkipReason = (file: Data360ProjectFile, operation: 'create' | 'update'): string | undefined => {
  if (file.type.deployUnsupportedReason) return file.type.deployUnsupportedReason;

  if (operation === 'create') {
    if (file.type.createUnsupportedReason) return file.type.createUnsupportedReason;
    if (!file.type.createEndpoint) return `${file.type.type} does not expose a create API in the Data 360 swagger.`;
  }

  if (operation === 'update') {
    if (file.type.updateUnsupportedReason) return file.type.updateUnsupportedReason;
    if (!file.type.updateEndpoint) return `${file.type.type} does not expose an update API in the Data 360 swagger.`;
  }

  const body = unwrapSingletonResponse(file.type, file.body);
  if (file.type.type === 'Data360DataTransform') {
    const definition = isRecord(body.definition) ? body.definition : {};
    const definitionType = firstString(definition, ['sqlType', 'type']);
    if (body.creationType === 'SYSTEM' || definitionType?.endsWith('_HIDDEN')) {
      return 'System or hidden Data Transform definitions are generated by Data Cloud and cannot be replayed through project deploy.';
    }
  }

  if (file.type.type === 'Data360Segment' && body.segmentType === 'UI') {
    return 'UI segments cannot be replayed through the segment update API, which requires DBT or Lookalike authoring payloads.';
  }

  if (
    operation === 'update' &&
    file.type.type === 'Data360MachineLearningModelArtifact' &&
    body.sourceType === 'OutOfTheBox'
  ) {
    return 'Out-of-the-box Salesforce model artifacts are read-only through the model artifact update API.';
  }

  return undefined;
};

const getDeployBody = (file: Data360ProjectFile, operation: 'create' | 'update'): Record<string, unknown> => {
  const body = unwrapSingletonResponse(file.type, file.body);

  if (file.type.type === 'Data360DataLakeObject' && operation === 'update') {
    return pickFields(body, ['label']);
  }
  if (file.type.type === 'Data360DataModelObject' || file.type.type === 'Data360DataStream') {
    return {};
  }
  if (file.type.type === 'Data360DataSpace') {
    return pickFields(body, ['label', 'description']);
  }
  if (file.type.type === 'Data360DataTransform') {
    return pickFields(body, ['name', 'label', 'description', 'type', 'definition']);
  }
  if (file.type.type === 'Data360CalculatedInsight' && operation === 'update') {
    return pickFields(body, [
      'displayName',
      'description',
      'expression',
      'draft',
      'createdFromPackage',
      'dataSpaceName',
      'publishScheduleInterval',
      'publishScheduleStartDateTime',
      'publishScheduleEndDate',
    ]);
  }
  if (file.type.type === 'Data360IdentityResolution') {
    return cleanIdentityResolutionRules(body, operation);
  }
  if (file.type.type === 'Data360MachineLearningConfiguredModel') {
    return operation === 'update'
      ? pickFields(body, ['status', 'visibility'])
      : pickFields(body, [
          'actionableFields',
          'artifact',
          'capability',
          'description',
          'label',
          'parameterOverrides',
          'status',
        ]);
  }
  if (file.type.type === 'Data360MachineLearningModelArtifact') {
    return pickFields(body, ['description', 'label', 'status']);
  }
  if (file.type.type === 'Data360Segment') {
    if (operation === 'update') {
      return normalizeSegmentDeployBody(
        pickFields(body, ['displayName', 'description', 'includeDbt', 'lookalikeCriteria', 'segmentType'])
      );
    }
    return normalizeSegmentDeployBody(body);
  }
  if (file.type.type === 'Data360DataGraph') {
    return normalizeDataGraphDeployBody(body);
  }
  return body;
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
  name: string,
  seed: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  const response = await ssotGet<Record<string, unknown>>(
    org,
    apiVersion,
    buildEndpointPath(type, type.detailEndpoint, seed, name)
  );
  if (!isRecord(response)) return {};
  const body = withDerivedFields(type, unwrapSingletonResponse(type, response));
  return shouldAnnotateProjectRecord(type) ? annotateProjectRecord(type, body) : body;
};

const DMO_MAPPING_LIST_CONCURRENCY = 20;

const mapWithConcurrency = async <I, O>(
  items: I[],
  concurrency: number,
  worker: (item: I) => Promise<O>
): Promise<O[]> => {
  const results: O[] = new Array(items.length) as O[];
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const listDmoMappings = async (org: Org, apiVersion: string): Promise<Array<Record<string, unknown>>> => {
  const dmoType = typeByAlias.get('data360datamodelobject');
  if (!dmoType) throw new SfError('Data360DataModelObject metadata type missing.', 'DATA360_METADATA_TYPE_UNSUPPORTED');

  const dmos = await listComponents(org, apiVersion, dmoType, true);
  const dmoNames = dmos
    .map((dmo) => firstString(dmo, dmoType.nameFields))
    .filter((name): name is string => Boolean(name));

  const seen = new Set<string>();
  const mappings: Array<Record<string, unknown>> = [];

  const perDmo = await mapWithConcurrency(
    dmoNames,
    DMO_MAPPING_LIST_CONCURRENCY,
    async (dmoName): Promise<Array<Record<string, unknown>>> => {
      try {
        const response = await ssotGet<Record<string, unknown>>(
          org,
          apiVersion,
          buildPath('/data-model-object-mappings', undefined, { dmoDeveloperName: dmoName })
        );
        return getRecordsFromListResponse(response, 'objectSourceTargetMaps');
      } catch {
        // DMOs without mappings or without ingestion source may 404 / error — skip them.
        return [];
      }
    }
  );

  for (const batch of perDmo) {
    for (const record of batch) {
      const name = firstString(record, ['developerName', 'objectSourceTargetMapDeveloperName', 'name', 'id']);
      if (name && !seen.has(name)) {
        seen.add(name);
        mappings.push(record);
      }
    }
  }

  return mappings;
};

const getTypeByTypeName = (typeName: string): Data360MetadataType => {
  const type = data360MetadataTypes.find((metadataType) => metadataType.type === typeName);
  if (!type) throw new SfError(`${typeName} metadata type missing.`, 'DATA360_METADATA_TYPE_UNSUPPORTED');
  return type;
};

const listChildCollection = async (
  org: Org,
  apiVersion: string,
  parentType: Data360MetadataType,
  childType: Data360MetadataType,
  endpoint: string,
  parentParamName: string,
  childArrayKey: string,
  childExtra: (parentName: string, record: Record<string, unknown>) => Record<string, string | undefined>
): Promise<Array<Record<string, unknown>>> => {
  const parents = await listComponents(org, apiVersion, parentType, true);
  const parentNames = parents
    .map((parent) => firstString(parent, parentType.nameFields))
    .filter((name): name is string => Boolean(name));

  const perParent = await mapWithConcurrency(parentNames, DMO_MAPPING_LIST_CONCURRENCY, async (parentName) => {
    try {
      const response = await ssotGet<Record<string, unknown>>(
        org,
        apiVersion,
        buildEndpointPath(childType, endpoint, { [parentParamName]: parentName })
      );
      return getRecordsFromListResponse(response, childArrayKey).map((record) =>
        annotateProjectRecord(childType, record, childExtra(parentName, record))
      );
    } catch {
      return [];
    }
  });

  return perParent.flat();
};

const listConnectionChildren = async (
  org: Org,
  apiVersion: string,
  childType: Data360MetadataType,
  endpoint: string
): Promise<Array<Record<string, unknown>>> => {
  const connectionType = getTypeByTypeName('Data360Connection');
  const connections = await listComponents(org, apiVersion, connectionType, true);
  const connectionIds = connections
    .map((connection) => firstString(connection, connectionType.nameFields))
    .filter((name): name is string => Boolean(name));

  const perConnection = await mapWithConcurrency(connectionIds, DMO_MAPPING_LIST_CONCURRENCY, async (connectionId) => {
    try {
      const response = await ssotGet<Record<string, unknown>>(
        org,
        apiVersion,
        buildEndpointPath(childType, endpoint, { connectionId })
      );
      return [annotateProjectRecord(childType, isRecord(response) ? response : {}, { connectionId })];
    } catch {
      return [];
    }
  });

  return perConnection.flat();
};

const listDataTransformSchedules = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType
): Promise<Array<Record<string, unknown>>> => {
  const transformType = getTypeByTypeName('Data360DataTransform');
  const transforms = await listComponents(org, apiVersion, transformType, true);
  const transformNames = transforms
    .map((transform) => firstString(transform, transformType.nameFields))
    .filter((name): name is string => Boolean(name));

  const perTransform = await mapWithConcurrency(transformNames, DMO_MAPPING_LIST_CONCURRENCY, async (name) => {
    try {
      const response = await ssotGet<Record<string, unknown>>(
        org,
        apiVersion,
        buildEndpointPath(type, '/data-transforms/:dataTransformNameOrId/schedule', { dataTransformNameOrId: name })
      );
      return [annotateProjectRecord(type, isRecord(response) ? response : {}, { dataTransformNameOrId: name })];
    } catch {
      return [];
    }
  });

  return perTransform.flat();
};

const listDmoRelationships = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType
): Promise<Array<Record<string, unknown>>> =>
  listChildCollection(
    org,
    apiVersion,
    getTypeByTypeName('Data360DataModelObject'),
    type,
    '/data-model-objects/:dataModelObjectName/relationships',
    'dataModelObjectName',
    'relationships',
    (dataModelObjectName, record) => ({
      dataModelObjectName,
      name: firstString(record, ['name', 'developerName', 'id']),
    })
  );

const listDataSpaceMembers = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType
): Promise<Array<Record<string, unknown>>> =>
  listChildCollection(
    org,
    apiVersion,
    getTypeByTypeName('Data360DataSpace'),
    type,
    '/data-spaces/:idOrName/members',
    'idOrName',
    'members',
    (dataSpaceName, record) => ({
      dataSpaceName,
      idOrName: dataSpaceName,
      dataSpaceMemberObjectName: firstString(record, ['dataSpaceMemberObjectName', 'name', 'objectName', 'id']),
    })
  );

const listMlModelSetupVersions = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType
): Promise<Array<Record<string, unknown>>> => {
  const configuredModelType = getTypeByTypeName('Data360MachineLearningConfiguredModel');
  const configuredModels = await listComponents(org, apiVersion, configuredModelType, true);
  const modelSetupNames = configuredModels
    .map((model) => firstString(model, ['modelSetupId', 'id', 'name', 'developerName', 'apiName']))
    .filter((name): name is string => Boolean(name));

  const perSetup = await mapWithConcurrency(
    modelSetupNames,
    DMO_MAPPING_LIST_CONCURRENCY,
    async (modelSetupIdOrName) => {
      try {
        const response = await ssotGet<Record<string, unknown>>(
          org,
          apiVersion,
          buildEndpointPath(type, '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions', {
            modelSetupIdOrName,
          })
        );
        return getRecordsFromListResponse(response, 'versions').map((record) =>
          annotateProjectRecord(type, record, {
            modelSetupIdOrName,
            modelSetupVersionId: firstString(record, ['modelSetupVersionId', 'id', 'versionId']),
          })
        );
      } catch {
        return [];
      }
    }
  );

  return perSetup.flat();
};

const listMlModelSetupVersionPartitions = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType
): Promise<Array<Record<string, unknown>>> => {
  const versionType = getTypeByTypeName('Data360MachineLearningModelSetupVersion');
  const versions = await listComponents(org, apiVersion, versionType, true);

  const perVersion = await mapWithConcurrency(versions, DMO_MAPPING_LIST_CONCURRENCY, async (version) => {
    const modelSetupIdOrName = firstString(version, ['modelSetupIdOrName', 'modelSetupId', 'modelSetupName']);
    const modelSetupVersionId = firstString(version, ['modelSetupVersionId', 'id', 'versionId']);
    if (!modelSetupIdOrName || !modelSetupVersionId) return [];

    try {
      const response = await ssotGet<Record<string, unknown>>(
        org,
        apiVersion,
        buildEndpointPath(
          type,
          '/machine-learning/model-setups/:modelSetupIdOrName/setup-versions/:modelSetupVersionId/partitions',
          { modelSetupIdOrName, modelSetupVersionId }
        )
      );
      return getRecordsFromListResponse(response, 'partitions').map((record) =>
        annotateProjectRecord(type, record, {
          modelSetupIdOrName,
          modelSetupVersionId,
          modelSetupPartitionId: firstString(record, ['modelSetupPartitionId', 'id', 'partitionId']),
        })
      );
    } catch {
      return [];
    }
  });

  return perVersion.flat();
};

export const listComponents = async (
  org: Org,
  apiVersion: string,
  type: Data360MetadataType,
  fetchAll: boolean
): Promise<Array<Record<string, unknown>>> => {
  if (type.customList === 'dmoMappings') {
    return listDmoMappings(org, apiVersion);
  }
  if (type.customList === 'dmoRelationships') {
    return listDmoRelationships(org, apiVersion, type);
  }
  if (type.customList === 'dataSpaceMembers') {
    return listDataSpaceMembers(org, apiVersion, type);
  }
  if (type.customList === 'dataTransformSchedules') {
    return listDataTransformSchedules(org, apiVersion, type);
  }
  if (type.customList === 'connectionSchemas') {
    return listConnectionChildren(org, apiVersion, type, '/connections/:connectionId/schema');
  }
  if (type.customList === 'connectionSitemaps') {
    return listConnectionChildren(org, apiVersion, type, '/connections/:connectionId/sitemap');
  }
  if (type.customList === 'mlModelSetupVersions') {
    return listMlModelSetupVersions(org, apiVersion, type);
  }
  if (type.customList === 'mlModelSetupVersionPartitions') {
    return listMlModelSetupVersionPartitions(org, apiVersion, type);
  }
  if (!type.listEndpoint) {
    throw new SfError(
      `${type.type} cannot be listed. Retrieve it by explicit metadata name.`,
      'DATA360_METADATA_LIST_UNSUPPORTED'
    );
  }
  if (fetchAll) {
    return prepareListRecords(
      type,
      await fetchAllPages<Record<string, unknown>>(
        org,
        apiVersion,
        buildPath(type.listEndpoint, undefined, type.listQuery),
        { all: true, batchSize: DEFAULT_BATCH_SIZE },
        undefined,
        type.arrayKey
      )
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
  if (page.data.length) return prepareListRecords(type, page.data);

  const response = await ssotGet<unknown>(org, apiVersion, buildPath(type.listEndpoint, undefined, type.listQuery));
  return prepareListRecords(type, getRecordsFromListResponse(response, type.arrayKey));
};

export const deployComponent = async (
  org: Org,
  apiVersion: string,
  file: Data360ProjectFile,
  operation: 'create' | 'update' | 'upsert'
): Promise<DeployComponentResult> => {
  const create = async (): Promise<void> => {
    const skippedReason = getOperationSkipReason(file, 'create');
    if (skippedReason) throw new SfError(skippedReason, 'DATA360_METADATA_DEPLOY_SKIPPED');
    const path = buildEndpointPath(file.type, file.type.createEndpoint, file.body, file.name);
    const body = getDeployBody(file, 'create');
    if (file.type.createMethod === 'PUT') {
      await ssotPut<Record<string, unknown>>(org, apiVersion, path, body);
      return;
    }
    await ssotPost<Record<string, unknown>>(org, apiVersion, path, body);
  };

  const update = async (): Promise<void> => {
    const skippedReason = getOperationSkipReason(file, 'update');
    if (skippedReason) throw new SfError(skippedReason, 'DATA360_METADATA_DEPLOY_SKIPPED');
    const path = buildEndpointPath(file.type, file.type.updateEndpoint, file.body, file.name);
    const body = getDeployBody(file, 'update');
    if (file.type.updateMethod === 'PUT') {
      await ssotPut<Record<string, unknown>>(org, apiVersion, path, body);
      return;
    }
    await ssotPatch<Record<string, unknown>>(org, apiVersion, path, body);
  };

  const skipOrThrow = (error: unknown): DeployComponentResult => {
    if (error instanceof SfError && error.name === 'DATA360_METADATA_DEPLOY_SKIPPED') {
      return { operation: 'skipped', skippedReason: error.message };
    }
    throw error;
  };

  if (operation === 'create') {
    try {
      await create();
    } catch (error) {
      return skipOrThrow(error);
    }
    return { operation: 'create' };
  }

  if (operation === 'update') {
    try {
      await update();
    } catch (error) {
      return skipOrThrow(error);
    }
    return { operation: 'update' };
  }

  try {
    await update();
    return { operation: 'update' };
  } catch (error) {
    if (error instanceof SfError && error.name === 'DATA360_METADATA_DEPLOY_SKIPPED') {
      try {
        await create();
        return { operation: 'create' };
      } catch (createError) {
        return skipOrThrow(createError);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('404') && !message.toLowerCase().includes('not found')) throw error;
    try {
      await create();
    } catch (createError) {
      return skipOrThrow(createError);
    }
    return { operation: 'create' };
  }
};

export const toDisplayPath = (filePath: string): string => relative(process.cwd(), filePath) || filePath;
