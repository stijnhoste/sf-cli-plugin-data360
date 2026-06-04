import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Data360ProjectRetrieveStart from '../../../src/commands/data360/project/retrieve/start.js';
import Data360ProjectDeployStart from '../../../src/commands/data360/project/deploy/start.js';
import {
  data360MetadataTypes,
  Data360MetadataType,
  sanitizeFileName,
} from '../../../src/shared/data360/projectMetadata.js';
import { runCommand } from '../../helpers/runCommand.js';

describe('data360 project metadata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data360-project-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('retrieves a Data 360 metadata type into structured project files', async () => {
    const responses = new Map<string, unknown>([
      [
        '/data-model-objects',
        {
          data: [{ developerName: 'UnifiedIndividual__dlm' }],
        },
      ],
      [
        '/data-model-objects/UnifiedIndividual__dlm',
        {
          developerName: 'UnifiedIndividual__dlm',
          label: 'Unified Individual',
        },
      ],
    ]);

    const { result, requestLog } = await runCommand(Data360ProjectRetrieveStart, {
      flags: {
        'target-org': {},
        'api-version': '66.0',
        timing: false,
        raw: false,
        metadata: ['dmo'],
        'output-dir': tempDir,
        all: false,
      },
      responses,
    });

    const filePath = join(tempDir, 'data360', 'data-model-objects', 'UnifiedIndividual__dlm.json');
    const body = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].filePath, filePath);
    assert.equal(body.label, 'Unified Individual');
    assert.deepEqual(
      requestLog.map((entry) => entry.method),
      ['GET', 'GET']
    );
  });

  it('retrieves Data 360 connections with the API-required connector type filter', async () => {
    const responses = new Map<string, unknown>([
      [
        '/connections?connectorType=SalesforceDotCom',
        {
          connections: [{ id: '0hM000000000001', name: 'SalesforceDotCom_Home' }],
        },
      ],
      [
        '/connections/0hM000000000001',
        {
          id: '0hM000000000001',
          name: 'SalesforceDotCom_Home',
          connectorType: 'SalesforceDotCom',
        },
      ],
    ]);

    const { result, requestLog } = await runCommand(Data360ProjectRetrieveStart, {
      flags: {
        'target-org': {},
        'api-version': '66.0',
        timing: false,
        raw: false,
        metadata: ['Data360Connection'],
        'output-dir': tempDir,
        all: false,
      },
      responses,
    });

    assert.equal(result.files.length, 1);
    assert.equal(requestLog.length, 2);
    assert.ok(
      requestLog[0].url.endsWith('/ssot/connections?connectorType=SalesforceDotCom&batchSize=200&limit=200&offset=0')
    );
    assert.ok(requestLog[1].url.endsWith('/ssot/connections/0hM000000000001'));
  });

  it('deploys Data 360 project files with update semantics', async () => {
    const sourceDir = join(tempDir, 'data360', 'activation-targets');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'EmailTarget.json'),
      JSON.stringify({ id: 'EmailTarget', label: 'Email Target' }, null, 2),
      'utf8'
    );

    const { result, requestLog } = await runCommand(Data360ProjectDeployStart, {
      flags: {
        'target-org': {},
        'api-version': '66.0',
        timing: false,
        raw: false,
        'source-dir': [join(tempDir, 'data360')],
        operation: 'update',
        'dry-run': false,
      },
      responses: new Map([['/activation-targets/EmailTarget', { success: true }]]),
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].operation, 'update');
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].method, 'PATCH');
    assert.ok(requestLog[0].url.endsWith('/ssot/activation-targets/EmailTarget'));
  });

  it('uses per-type update methods for Data 360 project deploys', async () => {
    const sourceDir = join(tempDir, 'data360', 'data-transforms');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'Normalize.json'),
      JSON.stringify({ name: 'Normalize', label: 'Normalize', definition: { steps: [] }, actionUrls: {} }, null, 2),
      'utf8'
    );

    const { result, requestLog } = await runCommand(Data360ProjectDeployStart, {
      flags: {
        'target-org': {},
        'api-version': '66.0',
        timing: false,
        raw: false,
        'source-dir': [join(tempDir, 'data360')],
        operation: 'update',
        'dry-run': false,
      },
      responses: new Map([['/data-transforms/Normalize', { success: true }]]),
    });

    assert.equal(result.files.length, 1);
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].method, 'PUT');
    assert.ok(requestLog[0].url.endsWith('/ssot/data-transforms/Normalize'));
    assert.deepEqual(requestLog[0].body, { name: 'Normalize', label: 'Normalize', definition: { steps: [] } });
  });

  it('retrieves every Data 360 project metadata type through list and detail endpoints', async () => {
    for (const metadataType of data360MetadataTypes) {
      const componentName = componentNameFor(metadataType);
      const outputRoot = join(tempDir, 'retrieve-coverage', metadataType.directoryName);
      const responses = retrieveResponsesFor(metadataType, componentName);

      const { result, requestLog } = await runCommand(Data360ProjectRetrieveStart, {
        flags: {
          'target-org': {},
          'api-version': '66.0',
          timing: false,
          raw: false,
          metadata: [metadataType.type],
          'output-dir': outputRoot,
          all: false,
        },
        responses,
      });

      const filePath = join(
        outputRoot,
        'data360',
        metadataType.directoryName,
        `${sanitizeFileName(componentName)}.json`
      );
      const body = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

      assert.equal(result.files.length, 1, `${metadataType.type} should retrieve one fixture record`);
      assert.equal(result.files[0].filePath, filePath);
      assert.deepEqual(body, componentBodyFor(metadataType, componentName));
      assert.ok(requestLog.length >= 1, `${metadataType.type} should call at least one retrieve endpoint`);
      assert.ok(
        requestLog.every((entry) => entry.method === 'GET'),
        `${metadataType.type} should retrieve with GET`
      );
    }
  });

  it('declares retrieve and deploy behavior for every Data 360 project metadata type', async () => {
    const expectedTypes = new Set([
      'Data360ActivationExternalPlatform',
      'Data360Activation',
      'Data360ActivationTarget',
      'Data360CalculatedInsight',
      'Data360Connection',
      'Data360ConnectionSchema',
      'Data360ConnectionSitemap',
      'Data360Connector',
      'Data360DataAction',
      'Data360DataActionTarget',
      'Data360DataGraph',
      'Data360DataLakeObject',
      'Data360DataModelObject',
      'Data360DataModelObjectMapping',
      'Data360DataModelObjectRelationship',
      'Data360DataSpace',
      'Data360DataSpaceMember',
      'Data360DataStream',
      'Data360DataTransform',
      'Data360DataTransformSchedule',
      'Data360IdentityResolution',
      'Data360InsightMetadata',
      'Data360MachineLearningConfiguredModel',
      'Data360MachineLearningModelArtifact',
      'Data360MachineLearningModelSetupVersion',
      'Data360MachineLearningModelSetupVersionPartition',
      'Data360Metadata',
      'Data360MetadataEntity',
      'Data360ProfileMetadata',
      'Data360SearchIndex',
      'Data360Segment',
    ]);

    assert.deepEqual(new Set(data360MetadataTypes.map((type) => type.type)), expectedTypes);

    for (const metadataType of data360MetadataTypes) {
      const componentName = componentNameFor(metadataType);
      const sourceRoot = join(tempDir, 'coverage', metadataType.directoryName);
      const sourceDir = join(sourceRoot, 'data360', metadataType.directoryName);
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        join(sourceDir, `${sanitizeFileName(componentName)}.json`),
        JSON.stringify(componentBodyFor(metadataType, componentName), null, 2),
        'utf8'
      );

      const { result, requestLog } = await runCommand(Data360ProjectDeployStart, {
        flags: {
          'target-org': {},
          'api-version': '66.0',
          timing: false,
          raw: false,
          'source-dir': [join(sourceRoot, 'data360')],
          operation: 'update',
          'dry-run': false,
        },
      });

      const deployed = result.files.find((file) => file.type === metadataType.type && file.name === componentName);
      assert.ok(deployed, `${metadataType.type} should produce a deploy result`);

      if (shouldSkipUpdateFixture(metadataType)) {
        assert.equal(deployed.operation, 'skipped', `${metadataType.type} should be skipped with a reason`);
        assert.ok(deployed.skippedReason, `${metadataType.type} should include a skipped reason`);
        continue;
      }

      assert.equal(deployed.operation, 'update', `${metadataType.type} should update`);
      assert.ok(metadataType.updateEndpoint, `${metadataType.type} should have an update endpoint`);
      const request = requestLog.find((entry) => entry.url.includes(metadataType.updateEndpoint?.split('/:')[0] ?? ''));
      assert.ok(request, `${metadataType.type} should send an update request`);
      assert.equal(
        request.method,
        metadataType.updateMethod ?? 'PATCH',
        `${metadataType.type} should use its update method`
      );

      if (metadataType.type === 'Data360DataSpace') {
        assert.deepEqual(request.body, { label: 'Sample Label', description: 'Sample Description' });
      }
      if (metadataType.type === 'Data360DataModelObject' || metadataType.type === 'Data360DataStream') {
        assert.deepEqual(request.body, {});
      }
      if (metadataType.type === 'Data360IdentityResolution') {
        assert.deepEqual(request.body, {
          label: 'Identity Ruleset',
          matchRules: [{ label: 'Exact Email', criteria: [] }],
          reconciliationRules: [{ entityName: 'ssot__Individual__dlm', fields: [], ruleType: 'mostfrequent' }],
        });
      }
    }
  });

  it('deploys create-only Data 360 project metadata types with default upsert semantics', async () => {
    const createOnlyTypes = data360MetadataTypes.filter(
      (metadataType) =>
        metadataType.createEndpoint &&
        !metadataType.updateEndpoint &&
        !metadataType.deployUnsupportedReason &&
        !metadataType.createUnsupportedReason
    );

    assert.ok(createOnlyTypes.length > 0);

    for (const metadataType of createOnlyTypes) {
      const componentName = componentNameFor(metadataType);
      const sourceRoot = join(tempDir, 'create-only', metadataType.directoryName);
      const sourceDir = join(sourceRoot, 'data360', metadataType.directoryName);
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        join(sourceDir, `${sanitizeFileName(componentName)}.json`),
        JSON.stringify(componentBodyFor(metadataType, componentName), null, 2),
        'utf8'
      );

      const { result, requestLog } = await runCommand(Data360ProjectDeployStart, {
        flags: {
          'target-org': {},
          'api-version': '66.0',
          timing: false,
          raw: false,
          'source-dir': [join(sourceRoot, 'data360')],
          operation: 'upsert',
          'dry-run': false,
        },
      });

      assert.equal(result.files[0].operation, 'create', `${metadataType.type} should create on upsert`);
      assert.equal(
        requestLog[0].method,
        metadataType.createMethod ?? 'POST',
        `${metadataType.type} should use create method`
      );
    }
  });

  it('dry-runs Data 360 deploy without mutating the org', async () => {
    const sourceDir = join(tempDir, 'data360', 'segments');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'HighValue.json'), JSON.stringify({ segmentApiName: 'HighValue' }), 'utf8');

    const { result, requestLog } = await runCommand(Data360ProjectDeployStart, {
      flags: {
        'target-org': {},
        'api-version': '66.0',
        timing: false,
        raw: false,
        'source-dir': [join(tempDir, 'data360')],
        operation: 'upsert',
        'dry-run': true,
      },
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].operation, 'dry-run');
    assert.equal(requestLog.length, 0);
  });
});

const componentNameFor = (metadataType: Data360MetadataType): string => {
  if (metadataType.type === 'Data360ConnectionSchema' || metadataType.type === 'Data360ConnectionSitemap') {
    return 'SampleConnection';
  }
  if (metadataType.type === 'Data360DataModelObject') return 'Sample__dlm';
  if (metadataType.type === 'Data360DataLakeObject') return 'Sample__dll';
  if (metadataType.type === 'Data360DataModelObjectRelationship') return 'Sample__dlm/SampleRelationship';
  if (metadataType.type === 'Data360DataSpaceMember') return 'default/Sample__dll';
  if (metadataType.type === 'Data360DataStream') return 'Sample_Stream';
  if (metadataType.type === 'Data360DataTransformSchedule') return 'SampleTransform';
  if (metadataType.type === 'Data360IdentityResolution') return '1ir000000000001AAA';
  if (metadataType.type === 'Data360MachineLearningModelSetupVersion') return 'SampleModel/SampleVersion';
  if (metadataType.type === 'Data360MachineLearningModelSetupVersionPartition') {
    return 'SampleModel/SampleVersion/SamplePartition';
  }
  return 'Sample';
};

const componentBodyFor = (metadataType: Data360MetadataType, componentName: string): Record<string, unknown> => {
  if (metadataType.type === 'Data360ConnectionSchema') {
    return { __data360ProjectName: componentName, connectionId: componentName, schemas: [] };
  }
  if (metadataType.type === 'Data360ConnectionSitemap') {
    return { __data360ProjectName: componentName, connectionId: componentName, sitemap: [] };
  }
  if (metadataType.type === 'Data360DataSpace') {
    return { name: componentName, id: '0ds000000000001AAA', label: 'Sample Label', description: 'Sample Description' };
  }
  if (metadataType.type === 'Data360DataModelObject') {
    return { name: componentName, label: 'Sample DMO', creationType: 'SYSTEM', fields: [] };
  }
  if (metadataType.type === 'Data360DataModelObjectRelationship') {
    const [dataModelObjectName, relationshipName] = componentName.split('/');
    return {
      __data360ProjectName: componentName,
      dataModelObjectName,
      name: relationshipName,
      relationshipType: 'Related',
    };
  }
  if (metadataType.type === 'Data360DataSpaceMember') {
    const [dataSpaceName, dataSpaceMemberObjectName] = componentName.split('/');
    return {
      __data360ProjectName: componentName,
      dataSpaceName,
      idOrName: dataSpaceName,
      dataSpaceMemberObjectName,
      name: dataSpaceMemberObjectName,
      filters: [],
    };
  }
  if (metadataType.type === 'Data360DataStream') {
    return { name: componentName, label: 'Sample Stream', connectorInfo: {}, dataLakeObjectInfo: {} };
  }
  if (metadataType.type === 'Data360DataTransform') {
    return { name: componentName, label: 'Sample Transform', creationType: 'USER', definition: { steps: [] } };
  }
  if (metadataType.type === 'Data360DataTransformSchedule') {
    return { __data360ProjectName: componentName, dataTransformNameOrId: componentName, frequency: 'None' };
  }
  if (metadataType.type === 'Data360IdentityResolution') {
    return {
      id: componentName,
      label: 'Identity Ruleset',
      matchRules: [{ label: 'Exact Email', criteria: [] }],
      reconciliationRules: [
        {
          entityName: 'ssot__Individual__dlm',
          fields: [],
          linkDmoName: 'IndividualIdentityLink__dlm',
          ruleType: 'mostfrequent',
          unifiedDmoName: 'UnifiedIndividual__dlm',
        },
      ],
    };
  }
  if (metadataType.type === 'Data360Segment') {
    return { segmentApiName: componentName, displayName: 'Sample Segment', segmentType: 'UI' };
  }
  if (metadataType.type === 'Data360MachineLearningModelSetupVersion') {
    const [modelSetupIdOrName, modelSetupVersionId] = componentName.split('/');
    return {
      __data360ProjectName: componentName,
      modelSetupIdOrName,
      modelSetupVersionId,
      id: modelSetupVersionId,
      label: 'Sample Version',
    };
  }
  if (metadataType.type === 'Data360MachineLearningModelSetupVersionPartition') {
    const [modelSetupIdOrName, modelSetupVersionId, modelSetupPartitionId] = componentName.split('/');
    return {
      __data360ProjectName: componentName,
      modelSetupIdOrName,
      modelSetupVersionId,
      modelSetupPartitionId,
      id: modelSetupPartitionId,
      label: 'Sample Partition',
    };
  }
  return {
    id: componentName,
    name: componentName,
    apiName: componentName,
    developerName: componentName,
    label: 'Sample Label',
  };
};

const retrieveResponsesFor = (metadataType: Data360MetadataType, componentName: string): Map<string, unknown> => {
  const responses = new Map<string, unknown>();
  const body = componentBodyFor(metadataType, componentName);

  if (metadataType.customList === 'dmoMappings') {
    const dmoName = 'Sample__dlm';
    responses.set('/data-model-objects', { data: [{ developerName: dmoName }] });
    responses.set('/data-model-object-mappings', { objectSourceTargetMaps: [body] });
    return responses;
  }

  if (metadataType.customList === 'dmoRelationships') {
    responses.set('/data-model-objects', { data: [{ developerName: 'Sample__dlm' }] });
    responses.set('/data-model-objects/Sample__dlm/relationships', { relationships: [body] });
    return responses;
  }

  if (metadataType.customList === 'dataSpaceMembers') {
    responses.set('/data-spaces', { data: [{ name: 'default' }] });
    responses.set('/data-spaces/default/members', { members: [body] });
    return responses;
  }

  if (metadataType.customList === 'dataTransformSchedules') {
    responses.set('/data-transforms', { data: [{ name: componentName }] });
    responses.set(`/data-transforms/${componentName}/schedule`, body);
    return responses;
  }

  if (metadataType.customList === 'connectionSchemas') {
    responses.set('/connections', { connections: [{ id: componentName, name: componentName }] });
    responses.set(`/connections/${componentName}/schema`, body);
    return responses;
  }

  if (metadataType.customList === 'connectionSitemaps') {
    responses.set('/connections', { connections: [{ id: componentName, name: componentName }] });
    responses.set(`/connections/${componentName}/sitemap`, body);
    return responses;
  }

  if (metadataType.customList === 'mlModelSetupVersions') {
    responses.set('/machine-learning/configured-models', {
      configuredModels: [{ modelSetupId: 'SampleModel', id: 'SampleModel', name: 'SampleModel' }],
    });
    responses.set('/machine-learning/model-setups/SampleModel/setup-versions', { versions: [body] });
    return responses;
  }

  if (metadataType.customList === 'mlModelSetupVersionPartitions') {
    responses.set('/machine-learning/configured-models', {
      configuredModels: [{ modelSetupId: 'SampleModel', id: 'SampleModel', name: 'SampleModel' }],
    });
    responses.set('/machine-learning/model-setups/SampleModel/setup-versions', {
      versions: [
        {
          __data360ProjectName: 'SampleModel/SampleVersion',
          modelSetupIdOrName: 'SampleModel',
          modelSetupVersionId: 'SampleVersion',
          id: 'SampleVersion',
        },
      ],
    });
    responses.set('/machine-learning/model-setups/SampleModel/setup-versions/SampleVersion/partitions', {
      partitions: [body],
    });
    return responses;
  }

  if (metadataType.listEndpoint) {
    responses.set(metadataType.listEndpoint, {
      data: [metadataType.listReturnsDetail ? body : { [metadataType.nameFields[0]]: componentName }],
    });
  }

  if (metadataType.detailEndpoint && !metadataType.listReturnsDetail) {
    responses.set(metadataType.detailEndpoint.replace(/:[^/]+/g, componentName), body);
  }

  return responses;
};

const shouldSkipUpdateFixture = (metadataType: Data360MetadataType): boolean =>
  metadataType.deployUnsupportedReason !== undefined ||
  metadataType.updateUnsupportedReason !== undefined ||
  metadataType.updateEndpoint === undefined ||
  metadataType.type === 'Data360Segment';
