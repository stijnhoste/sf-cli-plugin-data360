import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Data360ProjectRetrieveStart from '../../../src/commands/data360/project/retrieve/start.js';
import Data360ProjectDeployStart from '../../../src/commands/data360/project/deploy/start.js';
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
    const sourceDir = join(tempDir, 'data360', 'data-graphs');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'IndividualGraph.json'),
      JSON.stringify({ name: 'IndividualGraph', label: 'Individual Graph' }, null, 2),
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
      responses: new Map([['/data-graphs/IndividualGraph', { success: true }]]),
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].operation, 'update');
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].method, 'PATCH');
    assert.ok(requestLog[0].url.endsWith('/ssot/data-graphs/IndividualGraph'));
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
