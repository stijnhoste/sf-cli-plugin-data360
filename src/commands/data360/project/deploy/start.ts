import { performance } from 'node:perf_hooks';
import { Flags } from '@salesforce/sf-plugins-core';
import { Data360Command, data360Flags } from '../../../../shared/data360/Data360Command.js';
import {
  deployComponent,
  DeployWriteResult,
  parseMetadataEntries,
  readProjectFiles,
  resolveOutputRoot,
  toDisplayPath,
} from '../../../../shared/data360/projectMetadata.js';

export type Data360ProjectDeployResult = {
  sourceDirs: string[];
  dryRun: boolean;
  files: DeployWriteResult[];
};

export default class Data360ProjectDeployStart extends Data360Command<Data360ProjectDeployResult> {
  public static readonly summary = 'Deploy Data 360 metadata from project source files.';
  public static readonly examples = [
    '$ sf data360 project deploy start --target-org myorg --source-dir force-app/main/default/data360',
    '$ sf data360 project deploy start --target-org myorg --metadata Data360DataGraph:IndividualGraph --dry-run',
  ];
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    ...data360Flags,
    metadata: Flags.string({
      char: 'm',
      summary: 'Data 360 metadata component to deploy, such as Data360DataGraph:MyGraph or dmo.',
      multiple: true,
    }),
    'source-dir': Flags.directory({
      char: 'd',
      summary: 'Path to Data 360 source files or directories.',
      multiple: true,
      exists: true,
    }),
    operation: Flags.string({
      char: 'p',
      summary: 'Deployment operation.',
      options: ['upsert', 'create', 'update'],
      default: 'upsert',
    }),
    'dry-run': Flags.boolean({
      summary: 'Validate local Data 360 source files without writing to the org.',
      default: false,
    }),
  };

  public async run(): Promise<Data360ProjectDeployResult> {
    const flags = (await this.parseData360Flags()) as unknown as {
      metadata?: string[];
      'source-dir'?: string[];
      operation: 'upsert' | 'create' | 'update';
      'dry-run': boolean;
    };
    const tApi = performance.now();
    const filters = flags.metadata?.length ? parseMetadataEntries(flags.metadata) : undefined;
    const sourceDirs = flags['source-dir']?.length ? flags['source-dir'] : [`${await resolveOutputRoot()}/data360`];
    const files = await readProjectFiles(sourceDirs, filters);
    const results = await Promise.all(
      files.map(async (file): Promise<DeployWriteResult> => {
        const operation = flags['dry-run']
          ? 'dry-run'
          : await deployComponent(this.org, this.apiVersion, file, flags.operation);
        return { type: file.type.type, name: file.name, filePath: file.path, operation };
      })
    );

    this.emitTiming(performance.now() - tApi);

    if (results.length === 0) {
      this.log('No Data 360 metadata files found to deploy.');
    } else {
      this.table({
        data: results.map((file) => ({ ...file, filePath: toDisplayPath(file.filePath) })),
        columns: [
          { key: 'operation', name: 'Operation' },
          { key: 'type', name: 'Type' },
          { key: 'name', name: 'Name' },
          { key: 'filePath', name: 'File' },
        ],
      });
    }

    return { sourceDirs, dryRun: flags['dry-run'], files: results };
  }
}
