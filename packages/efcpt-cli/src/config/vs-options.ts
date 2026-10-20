// How the Visual Studio extension's efpt.config.json options (ReverseEngineerOptions, src/GUI/RevEng.Shared)
// map to efcpt-config.json, in both directions. Shared by --import-vs, by editing an efpt.config.json in place,
// and by the web UI (which options an efpt.config.json can hold). No Node imports: the web UI bundles this file.

export type OptionSection = 'names' | 'code-generation' | 'file-layout' | 'type-mappings' | 'replacements';

export interface VsOption {
  /** Property in efpt.config.json. */
  vs: string;
  section: OptionSection;
  /** Property in that section of efcpt-config.json. */
  key: string;
  toEfcpt?: (value: unknown) => unknown;
  toVs?: (value: unknown) => unknown;
}

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

/** "" and missing mean "not set" in efpt.config.json; efcpt-config.json uses null. */
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

interface Rule {
  Rule?: string;
  Replacement?: string;
}
interface IrregularWord {
  Singular?: string;
  Plural?: string;
  MatchEnding?: boolean;
}

const rulesToEfcpt = (value: unknown) =>
  Array.isArray(value) ? (value as Rule[]).map((r) => ({ rule: r.Rule, replacement: r.Replacement })) : null;
const rulesToVs = (value: unknown) =>
  Array.isArray(value)
    ? (value as { rule?: string; replacement?: string }[]).map((r) => ({
        Replacement: r.replacement,
        Rule: r.rule,
      }))
    : null;

export const vsOptions: VsOption[] = [
  { vs: 'ContextClassName', section: 'names', key: 'dbcontext-name' },
  { vs: 'ContextNamespace', section: 'names', key: 'dbcontext-namespace', toEfcpt: text },
  { vs: 'ModelNamespace', section: 'names', key: 'model-namespace', toEfcpt: text },
  { vs: 'ProjectRootNamespace', section: 'names', key: 'root-namespace' },

  { vs: 'IncludeConnectionString', section: 'code-generation', key: 'enable-on-configuring' },
  {
    vs: 'SelectedToBeGenerated',
    section: 'code-generation',
    key: 'type',
    toEfcpt: (v) => ({ 1: 'dbcontext', 2: 'entities' })[v as number] ?? 'all',
    toVs: (v) => ({ dbcontext: 1, entities: 2 })[v as string] ?? 0,
  },
  { vs: 'UseDatabaseNames', section: 'code-generation', key: 'use-database-names' },
  {
    vs: 'UseFluentApiOnly',
    section: 'code-generation',
    key: 'use-data-annotations',
    toEfcpt: (v) => v === false,
    toVs: (v) => v !== true,
  },
  { vs: 'UseNullableReferences', section: 'code-generation', key: 'use-nullable-reference-types' },
  { vs: 'UseInflector', section: 'code-generation', key: 'use-inflector' },
  { vs: 'UseLegacyPluralizer', section: 'code-generation', key: 'use-legacy-inflector' },
  { vs: 'UseManyToManyEntity', section: 'code-generation', key: 'use-many-to-many-entity' },
  { vs: 'UseT4', section: 'code-generation', key: 'use-t4' },
  { vs: 'UseT4Split', section: 'code-generation', key: 'use-t4-split' },
  { vs: 'T4TemplatePath', section: 'code-generation', key: 't4-template-path', toEfcpt: text },
  {
    vs: 'UseBoolPropertiesWithoutDefaultSql',
    section: 'code-generation',
    key: 'remove-defaultsql-from-bool-properties',
  },
  { vs: 'UseNoNavigations', section: 'code-generation', key: 'use-no-navigations-preview' },
  {
    vs: 'UseDecimalDataAnnotationForSprocResult',
    section: 'code-generation',
    key: 'use-decimal-data-annotation-for-sproc-results',
  },
  { vs: 'UsePrefixNavigationNaming', section: 'code-generation', key: 'use-prefix-navigation-naming' },
  { vs: 'UseDatabaseNamesForRoutines', section: 'code-generation', key: 'use-database-names-for-routines' },
  {
    vs: 'UseInternalAccessModifiersForSprocsAndFunctions',
    section: 'code-generation',
    key: 'use-internal-access-modifiers-for-sprocs-and-functions',
  },
  { vs: 'UseTypedTvpParameters', section: 'code-generation', key: 'use-typed-tvp-parameters' },

  { vs: 'OutputPath', section: 'file-layout', key: 'output-path', toEfcpt: text },
  { vs: 'OutputContextPath', section: 'file-layout', key: 'output-dbcontext-path', toEfcpt: text },
  { vs: 'UseDbContextSplitting', section: 'file-layout', key: 'split-dbcontext-preview' },
  { vs: 'UseSchemaFolders', section: 'file-layout', key: 'use-schema-folders-preview' },
  { vs: 'UseSchemaNamespaces', section: 'file-layout', key: 'use-schema-namespaces-preview' },

  { vs: 'UseDateOnlyTimeOnly', section: 'type-mappings', key: 'use-DateOnly-TimeOnly' },
  { vs: 'UseHierarchyId', section: 'type-mappings', key: 'use-HierarchyId' },
  { vs: 'UseSpatial', section: 'type-mappings', key: 'use-spatial' },
  { vs: 'UseNodaTime', section: 'type-mappings', key: 'use-NodaTime' },

  { vs: 'PreserveCasingWithRegex', section: 'replacements', key: 'preserve-casing-with-regex' },
  {
    vs: 'IrregularWords',
    section: 'replacements',
    key: 'irregular-words',
    toEfcpt: (v) =>
      Array.isArray(v)
        ? (v as IrregularWord[]).map((w) => ({
            singular: w.Singular,
            plural: w.Plural,
            'match-ending': w.MatchEnding ?? true,
          }))
        : null,
    toVs: (v) =>
      Array.isArray(v)
        ? (v as { singular?: string; plural?: string; 'match-ending'?: boolean }[]).map((w) => ({
            MatchEnding: w['match-ending'] ?? true,
            Plural: w.plural,
            Singular: w.singular,
          }))
        : null,
  },
  {
    vs: 'UncountableWords',
    section: 'replacements',
    key: 'uncountable-words',
    toEfcpt: (v) => (Array.isArray(v) ? v : null),
  },
  { vs: 'PluralRules', section: 'replacements', key: 'plural-rules', toEfcpt: rulesToEfcpt, toVs: rulesToVs },
  {
    vs: 'SingularRules',
    section: 'replacements',
    key: 'singular-rules',
    toEfcpt: rulesToEfcpt,
    toVs: rulesToVs,
  },
];

/** "section.key" of every option an efpt.config.json can hold, plus the object list switch. */
export const vsSettingKeys: string[] = [
  ...vsOptions.map((o) => `${o.section}.${o.key}`),
  'code-generation.refresh-object-lists',
];
