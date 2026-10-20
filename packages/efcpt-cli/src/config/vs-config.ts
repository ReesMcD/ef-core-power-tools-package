// Uses the Visual Studio extension's efpt.config.json (efpt.Sales.config.json, ...) as the config, so a team where
// some people use the extension and some use efcpt shares one file. It is read as an efcpt-config.json and
// changes are written back in place: only what changed, in the format the extension writes
// (DataContractJsonSerializer: properties in ordinal order, 3 space indent, BOM, "\/").
// The extension rewrites the whole file from its own options class and drops anything it doesn't know, so
// efcpt-cli's own settings (which connection string, line endings) live next to it in efcpt-cli.json.
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigError, type EfcptConfig } from './io.js';
import { isSelected, type ConfigEntry, type ConfigSection } from './selection.js';
import {
  convertVsConfig,
  efcptPathFor,
  isVsConfigFileName,
  parseVsConfig,
  renamingFileFor,
  type VsConfig,
} from './vs-import.js';
import { engineDefaults, vsOptions, vsSettingKeys } from './vs-options.js';

export const vsSettingsFileName = 'efcpt-cli.json';
const uiKey = 'efcpt-cli';
const legacyUiKey = 'efcpt-ui';

export function isVsConfigPath(configPath: string): boolean {
  return isVsConfigFileName(path.basename(configPath));
}

interface VsFormat {
  bom: boolean;
  eol: '\n' | '\r\n';
  indent: string;
  finalNewline: boolean;
  escapedSlashes: boolean;
}

export interface VsConfigFile {
  /** The file as it is on disk. */
  text: string;
  vs: VsConfig;
  format: VsFormat;
  /** The file as an efcpt-config.json, with efcpt-cli's own settings for it from efcpt-cli.json. */
  config: EfcptConfig;
  warnings: string[];
}

type UiSection = Record<string, unknown>;
type SettingsFile = { configs?: Record<string, UiSection> } & Record<string, unknown>;

function detectVsFormat(text: string): VsFormat {
  const body = text.replace(/^\uFEFF/, '');
  return {
    bom: text.startsWith('﻿'),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    indent: /^\{\r?\n([ \t]+)\S/.exec(body)?.[1] ?? '   ',
    finalNewline: /\r?\n$/.test(body),
    escapedSlashes: body.includes('\\/'),
  };
}

function serializeVs(vs: VsConfig, format: VsFormat): string {
  let text = JSON.stringify(vs, null, format.indent);
  // Slashes only occur inside strings, where the extension writes them as \/
  if (format.escapedSlashes) text = text.replace(/\//g, '\\/');
  if (format.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (format.finalNewline) text += format.eol;
  return (format.bom ? '﻿' : '') + text;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

function settingsPath(vsConfigPath: string): string {
  return path.join(path.dirname(vsConfigPath), vsSettingsFileName);
}

async function readSettingsFile(file: string): Promise<SettingsFile> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as SettingsFile)
      : {};
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`, file);
  }
}

/** efcpt-cli's settings for one efpt config: from efcpt-cli.json, else from an old --import-vs copy of it. */
async function readUiSettings(vsConfigPath: string): Promise<UiSection | undefined> {
  const settings = await readSettingsFile(settingsPath(vsConfigPath));
  const own = settings.configs?.[path.basename(vsConfigPath)];
  if (own) return own;
  const twin = efcptPathFor(vsConfigPath);
  if (!(await exists(twin))) return undefined;
  try {
    const imported = JSON.parse((await readFile(twin, 'utf8')).replace(/^\uFEFF/, '')) as Record<
      string,
      unknown
    >;
    const section = (imported[uiKey] ?? imported[legacyUiKey]) as UiSection | undefined;
    if (!section || typeof section !== 'object') return undefined;
    const rest = { ...section };
    delete rest.renaming;
    return Object.keys(rest).length > 0 ? rest : undefined;
  } catch {
    return undefined;
  }
}

/** Reads an efpt.config.json as an efcpt config. */
export async function readVsConfig(vsConfigPath: string, projectEfVersion?: number): Promise<VsConfigFile> {
  let text: string;
  try {
    text = await readFile(vsConfigPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read ${vsConfigPath}: ${(error as Error).message}`, vsConfigPath);
  }
  const vs = parseVsConfig(text, vsConfigPath);
  const renamingFile = await renamingFileFor(vsConfigPath);
  const converted = convertVsConfig(vs, { projectEfVersion, renamingFile });
  const config = converted.config;
  delete config.$schema;
  delete config[uiKey];
  const ui = { ...(await readUiSettings(vsConfigPath)), ...(renamingFile ? { renaming: renamingFile } : {}) };
  if (Object.keys(ui).length > 0) config[uiKey] = ui;
  return { text, vs, format: detectVsFormat(text), config, warnings: converted.warnings };
}

// ObjectType in RevEng.Shared: Table = 0, Procedure = 1, ScalarFunction = 2, View = 3
const objectSections: [ConfigSection, number][] = [
  ['tables', 0],
  ['views', 3],
  ['stored-procedures', 1],
  ['functions', 2],
];
/** The extension lists tables, then views, then procedures, then functions. */
const typeRank: Record<number, number> = { 0: 0, 3: 1, 1: 2, 2: 3 };
/**
 * How the extension orders names (Windows string sorting of "[schema].[name]"): case-insensitive, symbols before
 * digits before letters, symbols by character code. So [Player] < [Player_Backup] < [PlayerAIQ] and
 * [UserRoles] < [USRegion], as in the extension's files.
 */
export function compareVsNames(a: string, b: string): number {
  const weight = (c: string): [number, number] => {
    const lower = c.toLowerCase();
    if (lower !== c.toUpperCase()) return [2, lower.codePointAt(0)!];
    if (c >= '0' && c <= '9') return [1, c.codePointAt(0)!];
    return [0, c.codePointAt(0)!];
  };
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [classA, keyA] = weight(a[i]!);
    const [classB, keyB] = weight(b[i]!);
    if (classA !== classB) return classA - classB;
    if (keyA !== keyB) return keyA - keyB;
  }
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface VsTable {
  Name?: string;
  ObjectType?: number;
  [key: string]: unknown;
}

/** The objects a config generates (listed and not excluded), as efpt.config.json entries by type and name. */
function selectedObjects(config: EfcptConfig): Map<string, VsTable> {
  const selected = new Map<string, VsTable>();
  for (const [section, objectType] of objectSections) {
    const entries = (config[section] as ConfigEntry[] | undefined) ?? [];
    for (const entry of entries) {
      if (!entry.name || entry.exclusionWildcard || !isSelected(entries, entry.name)) continue;
      selected.set(`${objectType}:${entry.name}`, toVsTable(entry, section, objectType));
    }
  }
  return selected;
}

/** An entry as the extension writes it: properties in ordinal order, defaults left out. */
function toVsTable(entry: ConfigEntry, section: ConfigSection, objectType: number): VsTable {
  const table: VsTable = {};
  const columns = entry['excludedColumns'] as string[] | undefined;
  const indexes = entry['excludedIndexes'] as string[] | undefined;
  if (columns?.length && (section === 'tables' || section === 'views')) table['ExcludedColumns'] = columns;
  if (indexes?.length && section === 'tables') table['ExcludedIndexes'] = indexes;
  if (section === 'stored-procedures' && entry['generate-empty-result-type'] === true) {
    table['GenerateEmptyResultType'] = true;
  }
  if (section === 'stored-procedures' && typeof entry['mapped-type'] === 'string' && entry['mapped-type']) {
    table['MappedType'] = entry['mapped-type'];
  }
  table.Name = entry.name;
  table.ObjectType = objectType;
  if (section === 'stored-procedures' && entry['use-legacy-resultset-discovery'] === true) {
    table['UseLegacyResultSetDiscovery'] = true;
  }
  return table;
}

const tableKey = (table: VsTable) => `${table.ObjectType ?? 0}:${table.Name}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setVsProperty(vs: VsConfig, key: string, value: unknown): VsConfig {
  if (key in vs) {
    vs[key] = value;
    return vs;
  }
  // A property the file doesn't have yet goes where the extension would write it: ordinal order
  const result: VsConfig = {};
  let placed = false;
  for (const [existing, existingValue] of Object.entries(vs)) {
    if (!placed && key < existing) {
      result[key] = value;
      placed = true;
    }
    result[existing] = existingValue;
  }
  if (!placed) result[key] = value;
  return result;
}

const get = (config: EfcptConfig, section: string, key: string) =>
  (config[section] as Record<string, unknown> | undefined)?.[key];

/**
 * Applies the changes between two versions of a config (as read from the file, and as edited) to the file's
 * contents. Returns what efpt.config.json has no place for.
 */
export function applyToVs(
  original: VsConfig,
  before: EfcptConfig,
  after: EfcptConfig,
): { vs: VsConfig; notSaved: string[] } {
  let vs = structuredClone(original);
  const notSaved: string[] = [];

  for (const option of vsOptions) {
    const was = get(before, option.section, option.key);
    const now = get(after, option.section, option.key);
    if (sameJson(was, now)) continue;
    const fallback =
      engineDefaults[`${option.section}.${option.key}`] ??
      (typeof vs[option.vs] === 'boolean' ? false : null);
    const value = now === undefined ? fallback : now;
    vs = setVsProperty(vs, option.vs, option.toVs ? option.toVs(value) : value);
  }

  const refreshWas = get(before, 'code-generation', 'refresh-object-lists');
  const refreshNow = get(after, 'code-generation', 'refresh-object-lists');
  if (!sameJson(refreshWas, refreshNow)) vs = setVsProperty(vs, 'UseNoObjectFilter', refreshNow !== false);

  // Options efpt.config.json can't hold
  const supported = new Set(vsSettingKeys);
  for (const section of ['names', 'code-generation', 'file-layout', 'type-mappings', 'replacements']) {
    const keys = new Set([
      ...Object.keys((before[section] as object | undefined) ?? {}),
      ...Object.keys((after[section] as object | undefined) ?? {}),
    ]);
    for (const key of keys) {
      if (supported.has(`${section}.${key}`)) continue;
      if (!sameJson(get(before, section, key), get(after, section, key))) notSaved.push(`${section}.${key}`);
    }
  }

  // The object list
  const hadRules = objectSections.some(([s]) =>
    ((before[s] as ConfigEntry[] | undefined) ?? []).some((e) => e.exclusionWildcard),
  );
  if (
    !hadRules &&
    objectSections.some(([s]) =>
      ((after[s] as ConfigEntry[] | undefined) ?? []).some((e) => e.exclusionWildcard),
    )
  ) {
    notSaved.push(
      'exclusion rules (applied to the selected objects, but efpt.config.json only keeps the list)',
    );
  }
  const was = selectedObjects(before);
  const now = selectedObjects(after);
  const changed = was.size !== now.size || [...now].some(([key, table]) => !sameJson(was.get(key), table));
  if (changed) {
    const tables: VsTable[] = [];
    for (const table of (Array.isArray(vs['Tables']) ? vs['Tables'] : []) as VsTable[]) {
      const wanted = now.get(tableKey(table));
      if (!wanted) continue;
      // Entries that didn't change stay exactly as they were
      tables.push(sameJson(was.get(tableKey(table)), wanted) ? table : wanted);
    }
    const listed = new Set(tables.map(tableKey));
    const sortsBefore = (a: VsTable, b: VsTable) => {
      const rank = (typeRank[a.ObjectType ?? 0] ?? 9) - (typeRank[b.ObjectType ?? 0] ?? 9);
      return rank !== 0 ? rank < 0 : compareVsNames(a.Name ?? '', b.Name ?? '') < 0;
    };
    for (const [key, table] of now) {
      if (listed.has(key)) continue;
      const at = tables.findIndex((existing) => sortsBefore(table, existing));
      tables.splice(at < 0 ? tables.length : at, 0, table);
    }
    vs = setVsProperty(vs, 'Tables', tables);
  }

  return { vs, notSaved };
}

/**
 * Writes an edited config back to its efpt.config.json (only what changed) and efcpt-cli's own settings to
 * efcpt-cli.json. Returns what couldn't be saved.
 */
export async function writeVsConfig(vsConfigPath: string, config: EfcptConfig): Promise<string[]> {
  const current = await readVsConfig(vsConfigPath);
  const { vs, notSaved } = applyToVs(current.vs, current.config, config);
  const text = serializeVs(vs, current.format);
  if (text !== current.text) await writeFile(vsConfigPath, text, 'utf8');

  // efcpt-cli's own settings, without the renaming file the extension's naming convention already gives
  const derivedRenaming = await renamingFileFor(vsConfigPath);
  const { renaming, ...ui } = ((config[uiKey] ?? config[legacyUiKey]) as UiSection | undefined) ?? {};
  if (renaming !== undefined && renaming !== derivedRenaming) ui['renaming'] = renaming;
  const file = settingsPath(vsConfigPath);
  const settings = await readSettingsFile(file);
  const name = path.basename(vsConfigPath);
  const existing = settings.configs?.[name];
  if (sameJson(existing ?? {}, ui)) return notSaved;
  // Settings that only came from an old --import-vs copy aren't copied over unless they changed
  if (!existing && sameJson((await readUiSettings(vsConfigPath)) ?? {}, ui)) return notSaved;
  await writeUiSettings(file, settings, name, ui);
  return notSaved;
}

async function writeUiSettings(
  file: string,
  settings: SettingsFile,
  name: string,
  ui: UiSection,
): Promise<void> {
  const configs = { ...settings.configs };
  if (Object.keys(ui).length > 0) configs[name] = ui;
  else delete configs[name];
  const next: SettingsFile = { ...settings, configs: Object.fromEntries(Object.entries(configs).sort()) };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/**
 * Copies efcpt-cli's settings (such as which connection to use) from an old --import-vs copy of an efpt config
 * into efcpt-cli.json, so the copy can be deleted. Does nothing when efcpt-cli.json already has settings for it.
 * Returns whether it copied anything.
 */
export async function adoptImportedSettings(vsConfigPath: string): Promise<boolean> {
  const file = settingsPath(vsConfigPath);
  const settings = await readSettingsFile(file);
  const name = path.basename(vsConfigPath);
  if (settings.configs?.[name]) return false;
  const ui = await readUiSettings(vsConfigPath);
  if (!ui) return false;
  await writeUiSettings(file, settings, name, ui);
  return true;
}
