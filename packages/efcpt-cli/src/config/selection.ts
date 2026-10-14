import type { EfcptConfig } from './efcpt-config.generated.js';
import type { ObjectType } from '../engine/contract.js';

/** Common shape of the entries in the tables / views / stored-procedures / functions sections. */
export interface ConfigEntry {
  name?: string;
  exclude?: boolean;
  exclusionWildcard?: string;
  [key: string]: unknown;
}

export type ConfigSection = 'tables' | 'views' | 'stored-procedures' | 'functions';

export const sectionForType: Record<ObjectType, ConfigSection> = {
  table: 'tables',
  view: 'views',
  storedProcedure: 'stored-procedures',
  function: 'functions',
};

export function getEntries(config: EfcptConfig, section: ConfigSection): ConfigEntry[] {
  return (config[section] as ConfigEntry[] | undefined) ?? [];
}

// Mirrors CliConfigMapper.GetFilters / ExclusionFilter in src/GUI/RevEng.Shared/Cli/CliConfigMapper.cs
function parseWildcard(wildcard: string): ((name: string) => boolean) | undefined {
  if (wildcard.startsWith('*') && wildcard.endsWith('*') && wildcard.length > 2) {
    const part = wildcard.slice(1, -1);
    return (name) => name.includes(part);
  }
  if (wildcard.startsWith('*')) {
    const part = wildcard.slice(1);
    return (name) => name.endsWith(part);
  }
  if (wildcard.endsWith('*')) {
    const part = wildcard.slice(0, -1);
    return (name) => name.startsWith(part);
  }
  return undefined; // a '*' in the middle is ignored by the CLI
}

/**
 * Whether an object is generated, given the final entries of its config section (after any refresh).
 * `displayName` is the object's displayName from `efcpt --list-objects --json`.
 */
export function isSelected(entries: ConfigEntry[], displayName: string): boolean {
  // Objects missing from the list are not generated
  const entry = entries.find((e) => e.name === displayName && !e.exclusionWildcard);
  if (!entry) return false;

  const wildcards = entries.map((e) => e.exclusionWildcard).filter((w): w is string => Boolean(w));
  if (wildcards.includes('*')) return entry.exclude === false;
  if (entry.exclude === false) return true;

  const filters = wildcards
    .filter((w) => w.includes('*'))
    .map(parseWildcard)
    .filter((f) => f !== undefined);
  if (filters.some((matches) => matches(displayName))) return false;
  return entry.exclude !== true;
}

/**
 * Whether efcpt refreshes the object lists on the next run: it then adds every object found in the
 * database that is missing from the config. On by default (CodeGeneration.RefreshObjectLists = true).
 */
export function refreshesObjectLists(config: EfcptConfig): boolean {
  return config['code-generation']?.['refresh-object-lists'] !== false;
}

/** Entries as efcpt will see them on the next run: with refresh on, a missing object is added as `{ name }`. */
function effectiveEntries(config: EfcptConfig, section: ConfigSection, displayName: string): ConfigEntry[] {
  const entries = getEntries(config, section);
  const listed = entries.some((e) => e.name === displayName && !e.exclusionWildcard);
  return listed || !refreshesObjectLists(config) ? entries : [...entries, { name: displayName }];
}

/** Whether the next efcpt run generates code for this database object. */
export function isGenerated(config: EfcptConfig, section: ConfigSection, displayName: string): boolean {
  return isSelected(effectiveEntries(config, section, displayName), displayName);
}

/**
 * Selects or deselects an object, changing as little as possible:
 * adds a missing entry only when needed, and only writes an explicit `exclude` when the result would otherwise differ.
 */
export function setSelected(
  config: EfcptConfig,
  section: ConfigSection,
  displayName: string,
  selected: boolean,
): void {
  if (isGenerated(config, section, displayName) === selected) return;

  const entries = [...getEntries(config, section)];
  let entry = entries.find((e) => e.name === displayName && !e.exclusionWildcard);
  if (!entry) {
    // a missing object is generated only with refresh on, so deselecting it needs an explicit entry
    entry = { name: displayName };
    entries.push(entry);
  }

  delete entry.exclude;
  if (isSelected(entries, displayName) !== selected) entry.exclude = !selected;
  config[section] = entries;
}
