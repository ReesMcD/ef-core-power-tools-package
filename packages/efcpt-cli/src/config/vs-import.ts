// Converts the Visual Studio extension's efpt.config.json (ReverseEngineerOptions, src/GUI/RevEng.Shared) into an
// efcpt-config.json with the same result. The key names are the engine's (src/GUI/RevEng.Shared/Cli/Configuration).
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigError, type EfcptConfig } from './io.js';
import { schemaUrl } from './template.js';
import { vsOptions, type OptionSection } from './vs-options.js';

const skippedDirectories = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', '.idea']);

/** efpt.config.json and efpt.<name>.config.json, the names the VS extension looks for. */
export function isVsConfigFileName(fileName: string): boolean {
  return /^efpt\.(.+\.)?config\.json$/i.test(fileName);
}

/** Finds VS extension configs below a folder, skipping build output and dependency folders. */
export async function findVsConfigFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name.toLowerCase())) await walk(full);
      } else if (entry.isFile() && isVsConfigFileName(entry.name)) {
        found.push(full);
      }
    }
  }
  await walk(path.resolve(root));
  return found.sort();
}

/** efpt.config.json -> efcpt-config.json, efpt.Sales.config.json -> efcpt-config.Sales.json, same folder. */
export function efcptPathFor(vsConfigPath: string): string {
  const middle = /^efpt\.(.+)\.config\.json$/i.exec(path.basename(vsConfigPath))?.[1];
  return path.join(path.dirname(vsConfigPath), middle ? `efcpt-config.${middle}.json` : 'efcpt-config.json');
}

export type VsConfig = Record<string, unknown>;

interface VsObject {
  Name?: string;
  ObjectType?: number;
  ExcludedColumns?: string[] | null;
  ExcludedIndexes?: string[] | null;
  UseLegacyResultSetDiscovery?: boolean;
  MappedType?: string | null;
  GenerateEmptyResultType?: boolean;
}

export interface VsImportResult {
  config: EfcptConfig;
  /** Number of selected objects carried over. */
  objectCount: number;
  warnings: string[];
}

// ObjectType in RevEng.Shared: Table = 0, Procedure = 1, ScalarFunction = 2, View = 3
const sectionForObjectType: Record<number, 'tables' | 'stored-procedures' | 'functions' | 'views'> = {
  0: 'tables',
  1: 'stored-procedures',
  2: 'functions',
  3: 'views',
};

// CodeGenerationMode: EFCore8 = 4, EFCore9 = 5, EFCore10 = 6
const efVersionForMode: Record<number, number> = { 4: 8, 5: 9, 6: 10 };

/**
 * Converts a parsed efpt.config.json. Only options present in the file are written, so anything else keeps the
 * engine's default. `renamingFile` is the file the VS extension would use for renaming, when it isn't the
 * default efpt.renaming.json.
 */
export function convertVsConfig(
  vs: VsConfig,
  options: { projectEfVersion?: number; renamingFile?: string } = {},
): VsImportResult {
  const warnings: string[] = [];
  const has = (key: string) => vs[key] !== undefined;
  const bool = (key: string) => vs[key] === true;

  // Options, grouped by efcpt-config.json section in the table's order
  const sections: Record<OptionSection, Record<string, unknown>> = {
    names: {},
    'code-generation': {},
    'file-layout': {},
    'type-mappings': {},
    replacements: {},
  };
  for (const option of vsOptions) {
    if (!has(option.vs)) continue;
    sections[option.section][option.key] = option.toEfcpt ? option.toEfcpt(vs[option.vs]) : vs[option.vs];
  }
  const names = sections.names;
  const codeGeneration = sections['code-generation'];
  const fileLayout = sections['file-layout'];
  const typeMappings = sections['type-mappings'];
  const replacements = sections.replacements;
  for (const [key, value] of Object.entries(replacements)) if (value === null) delete replacements[key];

  // The VS extension generates exactly the listed objects and never adds new ones, unless "no object filter"
  // is on, which generates everything
  const lists: Record<string, Record<string, unknown>[]> = {};
  let objectCount = 0;
  if (bool('UseNoObjectFilter')) {
    codeGeneration['refresh-object-lists'] = true;
  } else {
    codeGeneration['refresh-object-lists'] = false;
    for (const object of (Array.isArray(vs['Tables']) ? vs['Tables'] : []) as VsObject[]) {
      const target = sectionForObjectType[object.ObjectType ?? 0];
      if (!object.Name || !target) continue;
      const entry: Record<string, unknown> = { name: object.Name };
      if (object.ExcludedColumns?.length && (target === 'tables' || target === 'views')) {
        entry['excludedColumns'] = object.ExcludedColumns;
      }
      if (object.ExcludedIndexes?.length && target === 'tables')
        entry['excludedIndexes'] = object.ExcludedIndexes;
      if (target === 'stored-procedures') {
        if (object.UseLegacyResultSetDiscovery) entry['use-legacy-resultset-discovery'] = true;
        if (object.MappedType) entry['mapped-type'] = object.MappedType;
        if (object.GenerateEmptyResultType) entry['generate-empty-result-type'] = true;
      }
      (lists[target] ??= []).push(entry);
      objectCount++;
    }
  }

  if (bool('UseHandleBars')) {
    warnings.push('Handlebars templates are not supported outside Visual Studio; use T4 templates instead');
  }
  if (bool('UseNoDefaultConstructor')) {
    warnings.push(
      '"No default DbContext constructor" is not supported outside Visual Studio and was dropped',
    );
  }
  if (vs['UseAsyncStoredProcedureCalls'] === false) {
    warnings.push('Stored procedure calls are always generated as async outside Visual Studio');
  }
  if (bool('FilterSchemas') && bool('UseNoObjectFilter')) {
    warnings.push(
      'The schema filter was dropped: all objects are generated. Use exclusion rules to leave schemas out',
    );
  }
  const mode = efVersionForMode[vs['CodeGenerationMode'] as number];
  if (mode && options.projectEfVersion && mode !== options.projectEfVersion) {
    warnings.push(
      `The Visual Studio config was set up for EF Core ${mode}; this project uses EF Core ${options.projectEfVersion}, which is what will be generated`,
    );
  }

  const config: EfcptConfig = { $schema: schemaUrl };
  if (options.renamingFile) config['efcpt-cli'] = { renaming: options.renamingFile };
  const put = (key: string, value: Record<string, unknown>) => {
    if (Object.keys(value).length > 0) (config as Record<string, unknown>)[key] = value;
  };
  put('code-generation', codeGeneration);
  put('file-layout', fileLayout);
  put('names', names);
  put('replacements', replacements);
  put('type-mappings', typeMappings);
  for (const key of ['tables', 'views', 'stored-procedures', 'functions']) {
    if (lists[key]) (config as Record<string, unknown>)[key] = lists[key];
  }
  return { config, objectCount, warnings };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** Parses an efpt.config.json. */
export function parseVsConfig(text: string, vsConfigPath: string): VsConfig {
  let vs: unknown;
  try {
    vs = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new ConfigError(`Cannot read ${vsConfigPath}: ${(error as Error).message}`, vsConfigPath);
  }
  if (typeof vs !== 'object' || vs === null || Array.isArray(vs)) {
    throw new ConfigError(`${vsConfigPath} is not an EF Core Power Tools config`, vsConfigPath);
  }
  return vs as VsConfig;
}

/** efpt.Sales.config.json uses efpt.Sales.renaming.json when it exists (CustomNameOptionsExtensions.TryRead). */
export async function renamingFileFor(vsConfigPath: string): Promise<string | undefined> {
  const middle = /^efpt\.(.+)\.config\.json$/i.exec(path.basename(vsConfigPath))?.[1];
  const specific = middle ? `efpt.${middle}.renaming.json` : undefined;
  return specific && (await exists(path.join(path.dirname(vsConfigPath), specific))) ? specific : undefined;
}

/** Reads and converts a VS extension config file. */
export async function importVsConfig(
  vsConfigPath: string,
  projectEfVersion?: number,
): Promise<VsImportResult> {
  let text: string;
  try {
    text = await readFile(vsConfigPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read ${vsConfigPath}: ${(error as Error).message}`, vsConfigPath);
  }
  const vs = parseVsConfig(text, vsConfigPath);
  return convertVsConfig(vs, { projectEfVersion, renamingFile: await renamingFileFor(vsConfigPath) });
}
