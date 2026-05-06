import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Data360ProjectRetrieveStart from '../../../src/commands/data360/project/retrieve/start.js';
import Data360ProjectDeployStart from '../../../src/commands/data360/project/deploy/start.js';
import { data360MetadataTypes, Data360MetadataType } from '../../../src/shared/data360/projectMetadata.js';
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
      const responses = new Map<string, unknown>([
        [metadataType.listEndpoint, { data: [{ [metadataType.nameFields[0]]: componentName }] }],
        [metadataType.detailEndpoint.replace(/:[^/]+/, componentName), componentBodyFor(metadataType, componentName)],
      ]);

      if (metadataType.listQuery) {
        const query = Object.entries(metadataType.listQuery)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join('&');
        responses.set(`${metadataType.listEndpoint}?${query}`, {
          data: [{ [metadataType.nameFields[0]]: componentName }],
        });
      }

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

      const filePath = join(outputRoot, 'data360', metadataType.directoryName, `${componentName}.json`);
      const body = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

      assert.equal(result.files.length, 1, `${metadataType.type} should retrieve one fixture record`);
      assert.equal(result.files[0].filePath, filePath);
      assert.deepEqual(body, componentBodyFor(metadataType, componentName));
      assert.equal(requestLog.length, 2, `${metadataType.type} should call list and detail`);
      assert.equal(requestLog[0].method, 'GET');
      assert.equal(requestLog[1].method, 'GET');
    }
  });

  it('declares retrieve and deploy behavior for every Data 360 project metadata type', async () => {
    const expectedTypes = new Set([
      'Data360Activation',
      'Data360ActivationTarget',
      'Data360CalculatedInsight',
      'Data360Connection',
      'Data360DataAction',
      'Data360DataActionTarget',
      'Data360DataGraph',
      'Data360DataLakeObject',
      'Data360DataModelObject',
      'Data360DataModelObjectMapping',
      'Data360DataSpace',
      'Data360DataStream',
      'Data360DataTransform',
      'Data360DocumentProcessingConfiguration',
      'Data360IdentityResolution',
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
        join(sourceDir, `${componentName}.json`),
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
        responses: new Map([[metadataType.updateEndpoint.replace(/:[^/]+/, componentName), { success: true }]]),
      });

      const deployed = result.files.find((file) => file.type === metadataType.type && file.name === componentName);
      assert.ok(deployed, `${metadataType.type} should produce a deploy result`);

      if (metadataType.deployUnsupportedReason !== undefined || shouldSkipFixture(metadataType)) {
        assert.equal(deployed.operation, 'skipped', `${metadataType.type} should be skipped with a reason`);
        assert.ok(deployed.skippedReason, `${metadataType.type} should include a skipped reason`);
        continue;
      }

      assert.equal(deployed.operation, 'update', `${metadataType.type} should update`);
      const request = requestLog.find((entry) => entry.url.includes(metadataType.updateEndpoint.split('/:')[0]));
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
  if (metadataType.type === 'Data360DataModelObject') return 'Sample__dlm';
  if (metadataType.type === 'Data360DataLakeObject') return 'Sample__dll';
  if (metadataType.type === 'Data360DataStream') return 'Sample_Stream';
  if (metadataType.type === 'Data360IdentityResolution') return '1ir000000000001AAA';
  return 'Sample';
};

const componentBodyFor = (metadataType: Data360MetadataType, componentName: string): Record<string, unknown> => {
  if (metadataType.type === 'Data360DataSpace') {
    return { name: componentName, id: '0ds000000000001AAA', label: 'Sample Label', description: 'Sample Description' };
  }
  if (metadataType.type === 'Data360DataModelObject') {
    return { name: componentName, label: 'Sample DMO', creationType: 'SYSTEM', fields: [] };
  }
  if (metadataType.type === 'Data360DataStream') {
    return { name: componentName, label: 'Sample Stream', connectorInfo: {}, dataLakeObjectInfo: {} };
  }
  if (metadataType.type === 'Data360DataTransform') {
    return { name: componentName, label: 'Sample Transform', creationType: 'USER', definition: { steps: [] } };
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
  return {
    id: componentName,
    name: componentName,
    apiName: componentName,
    developerName: componentName,
    label: 'Sample Label',
  };
};

const shouldSkipFixture = (metadataType: Data360MetadataType): boolean => metadataType.type === 'Data360Segment';
