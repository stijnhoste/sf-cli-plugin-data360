import { performance } from 'node:perf_hooks';
import { Flags } from '@salesforce/sf-plugins-core';
import { Data360Command, data360Flags } from '../../../../shared/data360/Data360Command.js';
import {
  getComponentName,
  listComponents,
  parseMetadataEntries,
  resolveOutputRoot,
  retrieveComponent,
  RetrieveWriteResult,
  toDisplayPath,
  writeComponentFile,
} from '../../../../shared/data360/projectMetadata.js';

export type Data360ProjectRetrieveResult = {
  outputDir: string;
  files: RetrieveWriteResult[];
};

export default class Data360ProjectRetrieveStart extends Data360Command<Data360ProjectRetrieveResult> {
  public static readonly summary = 'Retrieve Data 360 metadata into project source files.';
  public static readonly examples = [
    '$ sf data360 project retrieve start --target-org myorg --metadata Data360DataModelObject',
    '$ sf data360 project retrieve start --target-org myorg --metadata Data360DataGraph:IndividualGraph --output-dir force-app/main/default',
  ];
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    ...data360Flags,
    metadata: Flags.string({
      char: 'm',
      summary: 'Data 360 metadata component to retrieve, such as Data360DataGraph:MyGraph or dmo.',
      multiple: true,
    }),
    'output-dir': Flags.directory({
      char: 'r',
      summary: 'Directory root for retrieved Data 360 source files.',
      exists: false,
    }),
    all: Flags.boolean({
      summary: 'Fetch all pages when retrieving a whole Data 360 metadata type.',
      default: false,
    }),
  };

  public async run(): Promise<Data360ProjectRetrieveResult> {
    const flags = (await this.parseData360Flags()) as unknown as {
      metadata?: string[];
      'output-dir'?: string;
      all: boolean;
    };
    const refs = parseMetadataEntries(flags.metadata);
    const outputRoot = await resolveOutputRoot(flags['output-dir']);
    const tApi = performance.now();
    const files = (
      await Promise.all(
        refs.map(async (ref): Promise<RetrieveWriteResult[]> => {
          const records = ref.name
            ? [await retrieveComponent(this.org, this.apiVersion, ref.type, ref.name)]
            : await listComponents(this.org, this.apiVersion, ref.type, flags.all);

          return Promise.all(
            records.map(async (record): Promise<RetrieveWriteResult> => {
              const name = getComponentName(ref.type, record, ref.name);
              const detail = ref.name ? record : await retrieveComponent(this.org, this.apiVersion, ref.type, name);
              const filePath = await writeComponentFile(outputRoot, ref.type, name, detail);
              return { type: ref.type.type, name, filePath };
            })
          );
        })
      )
    ).flat();

    this.emitTiming(performance.now() - tApi);

    if (files.length === 0) {
      this.log('No Data 360 metadata retrieved.');
    } else {
      this.table({
        data: files.map((file) => ({ ...file, filePath: toDisplayPath(file.filePath) })),
        columns: [
          { key: 'type', name: 'Type' },
          { key: 'name', name: 'Name' },
          { key: 'filePath', name: 'File' },
        ],
      });
    }

    return { outputDir: outputRoot, files };
  }
}
