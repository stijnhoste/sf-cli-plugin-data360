import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProjectFlags, runProjectData360Hook } from '../../../src/hooks/projectData360.js';
import { createMockOrg } from '../../helpers/mockOrg.js';

describe('project Data 360 hook', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'data360-project-hook-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses core project retrieve flags used for Data 360 routing', () => {
    const flags = parseProjectFlags([
      '-o',
      'modelsapi',
      '-m',
      'Data360DataGraph:IndividualGraph',
      '--output-dir',
      'force-app/main/default',
      '--json',
    ]);

    assert.equal(flags.targetOrg, 'modelsapi');
    assert.deepEqual(flags.metadata, ['Data360DataGraph:IndividualGraph']);
    assert.equal(flags.outputDir, 'force-app/main/default');
    assert.equal(flags.json, true);
  });

  it('handles sf project retrieve start for Data 360 metadata', async () => {
    const { org, requestLog } = createMockOrg({
      responses: new Map([
        [
          '/data-graphs/IndividualGraph',
          {
            name: 'IndividualGraph',
            label: 'Individual Graph',
          },
        ],
      ]),
    });

    const result = await runProjectData360Hook(
      'project retrieve start',
      ['-o', 'modelsapi', '-m', 'Data360DataGraph:IndividualGraph', '--output-dir', tempDir],
      async () => org
    );

    const filePath = join(tempDir, 'data360', 'data-graphs', 'IndividualGraph.json');
    const body = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;

    assert.equal(result.handled, true);
    if (result.handled) assert.equal(result.exitCode, 0);
    assert.equal(body.label, 'Individual Graph');
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].method, 'GET');
  });

  it('handles sf project deploy start for Data 360 source directories', async () => {
    const sourceDir = join(tempDir, 'data360', 'segments');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'HighValue.json'), JSON.stringify({ segmentApiName: 'HighValue' }), 'utf8');

    const { org, requestLog } = createMockOrg();

    const result = await runProjectData360Hook(
      'project deploy start',
      ['-o', 'modelsapi', '--source-dir', join(tempDir, 'data360'), '--dry-run'],
      async () => org
    );

    assert.equal(result.handled, true);
    if (result.handled) assert.equal(result.exitCode, 0);
    assert.equal(requestLog.length, 0);
    if (result.handled) {
      assert.deepEqual(result.result, {
        sourceDirs: [join(tempDir, 'data360')],
        dryRun: true,
        files: [
          {
            type: 'Data360Segment',
            name: 'HighValue',
            filePath: join(tempDir, 'data360', 'segments', 'HighValue.json'),
            operation: 'dry-run',
          },
        ],
      });
    }
  });

  it('does not handle regular Metadata API project commands', async () => {
    const result = await runProjectData360Hook('project retrieve start', [
      '-o',
      'modelsapi',
      '-m',
      'ApexClass:MyClass',
    ]);

    assert.deepEqual(result, { handled: false });
  });
});
