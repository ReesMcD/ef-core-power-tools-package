import schema from '../../schema/efcpt-config.schema.json';
import type { EfcptConfig } from '../../src/server/api';

export type SectionKey = 'names' | 'file-layout' | 'code-generation' | 'type-mappings' | 'replacements';

export type FieldKind = 'boolean' | 'text' | 'nullable-text' | 'enum' | 'string-list' | 'unsupported';

export interface Field {
  key: string;
  title: string;
  kind: FieldKind;
  options?: string[];
}

export interface Section {
  key: SectionKey;
  title: string;
  fields: Field[];
}

interface SchemaProperty {
  type?: string | string[];
  title?: string;
  enum?: string[];
  items?: { type?: string; $ref?: string };
}

const sectionDefinitions: [SectionKey, string, string][] = [
  ['names', 'Names', 'Names'],
  ['file-layout', 'File layout', 'FileLayout'],
  ['code-generation', 'Code generation', 'CodeGeneration'],
  ['type-mappings', 'Type mappings', 'TypeMappings'],
  ['replacements', 'Naming replacements', 'Replacements'],
];

/**
 * The engine's defaults (src/GUI/RevEng.Shared/Cli/Configuration/*.cs). Options not listed default to false/empty.
 * The schema's own defaults are incomplete (for example use-nullable-reference-types is true in the engine).
 */
export const engineDefaults: Record<string, unknown> = {
  'code-generation.type': 'all',
  'code-generation.use-inflector': true,
  'code-generation.use-nullable-reference-types': true,
  'code-generation.soft-delete-obsolete-files': true,
  'code-generation.use-stored-procedure-resultset-fallback': true,
  'code-generation.refresh-object-lists': true,
  'code-generation.use-decimal-data-annotation-for-sproc-results': true,
  'code-generation.use-database-names-for-routines': true,
  'file-layout.output-path': 'Models',
};

function kindOf(property: SchemaProperty): FieldKind {
  const types = Array.isArray(property.type) ? property.type : [property.type];
  if (property.enum) return 'enum';
  if (types.includes('boolean')) return 'boolean';
  if (types.includes('string')) return types.includes('null') ? 'nullable-text' : 'text';
  if (types.includes('array') && property.items?.$ref?.endsWith('/UncountableWord')) return 'string-list';
  return 'unsupported';
}

function titleOf(key: string, property: SchemaProperty): string {
  return (property.title ?? key).replace(/\s+/g, ' ').trim();
}

const definitions = (
  schema as unknown as { definitions: Record<string, { properties?: Record<string, SchemaProperty> }> }
).definitions;

export const sections: Section[] = sectionDefinitions.map(([key, title, definition]) => ({
  key,
  title,
  fields: Object.entries(definitions[definition]?.properties ?? {}).map(([fieldKey, property]) => ({
    key: fieldKey,
    title: titleOf(fieldKey, property),
    kind: kindOf(property),
    options: property.enum,
  })),
}));

export function getValue(config: EfcptConfig, section: SectionKey, key: string): unknown {
  const values = config[section] as Record<string, unknown> | undefined;
  return values?.[key];
}

export function effectiveValue(config: EfcptConfig, section: SectionKey, field: Field): unknown {
  const value = getValue(config, section, field.key);
  if (value !== undefined && value !== null) return value;
  const fallback = engineDefaults[`${section}.${field.key}`];
  if (fallback !== undefined) return fallback;
  return field.kind === 'boolean' ? false : undefined;
}

/** Returns a copy of the config with one option set. `undefined` removes it (back to the engine default). */
export function setValue(config: EfcptConfig, section: SectionKey, key: string, value: unknown): EfcptConfig {
  const next = structuredClone(config);
  const values = { ...((next[section] as Record<string, unknown> | undefined) ?? {}) };
  if (value === undefined) delete values[key];
  else values[key] = value;
  if (Object.keys(values).length === 0) delete next[section];
  else (next as Record<string, unknown>)[section] = values;
  return next;
}

/** Why an option can't be used right now, if at all (mirrors the rules in the option descriptions). */
export function disabledReason(
  config: EfcptConfig,
  section: SectionKey,
  key: string,
  isDacpac: boolean,
): string | undefined {
  const on = (s: SectionKey, k: string) => getValue(config, s, k) === true;
  if (
    section === 'code-generation' &&
    key === 't4-template-path' &&
    !on('code-generation', 'use-t4') &&
    !on('code-generation', 'use-t4-split')
  ) {
    return 'Only used with T4 templates';
  }
  if (
    section === 'code-generation' &&
    key === 'use-t4-split' &&
    (on('code-generation', 'use-t4') || on('file-layout', 'split-dbcontext-preview'))
  ) {
    return 'Cannot be combined with T4 templates or Split DbContext';
  }
  if (section === 'code-generation' && key === 'use-t4' && on('code-generation', 'use-t4-split')) {
    return 'Turn off the EntityTypeConfiguration T4 option first';
  }
  if (section === 'code-generation' && key === 'merge-dacpacs' && !isDacpac) {
    return 'Only used with a .dacpac';
  }
  return undefined;
}
