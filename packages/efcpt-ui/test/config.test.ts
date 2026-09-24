import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfigFiles, isConfigFileName } from '../src/config/discovery.js';
import {
  ConfigError,
  detectFormat,
  loadConfig,
  saveConfig,
  serializeConfig,
  validateConfig,
} from '../src/config/io.js';
import { isGenerated, isSelected, setSelected, type ConfigEntry } from '../src/config/selection.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'efcpt-ui-test-'));
}

describe('config discovery', () => {
  it('recognises config file names', () => {
    expect(isConfigFileName('efcpt-config.json')).toBe(true);
    expect(isConfigFileName('efcpt-config.sales.json')).toBe(true);
    expect(isConfigFileName('billing.efcpt.json')).toBe(true);
    expect(isConfigFileName('efcpt-config.schema.json')).toBe(false);
    expect(isConfigFileName('efpt.config.json')).toBe(false);
    expect(isConfigFileName('appsettings.json')).toBe(false);
  });

  it('finds configs and skips build and dependency folders', async () => {
    const root = await tempDir();
    for (const dir of ['Data/Sales', 'Data/Billing', 'bin/Debug', 'obj', 'node_modules/x']) {
      await mkdir(path.join(root, dir), { recursive: true });
    }
    await writeFile(path.join(root, 'Data/Sales/efcpt-config.json'), '{}');
    await writeFile(path.join(root, 'Data/Billing/billing.efcpt.json'), '{}');
    await writeFile(path.join(root, 'bin/Debug/efcpt-config.json'), '{}');
    await writeFile(path.join(root, 'obj/efcpt-config.json'), '{}');
    await writeFile(path.join(root, 'node_modules/x/efcpt-config.json'), '{}');

    const found = (await findConfigFiles(root)).map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(found).toEqual(['Data/Billing/billing.efcpt.json', 'Data/Sales/efcpt-config.json']);
  });
});

describe('config io', () => {
  it('reads files written by efcpt (UTF-8 BOM) and writes them back unchanged', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'efcpt-config.json');
    const original =
      '\uFEFF{\r\n  "$schema": "./local.json",\r\n  "names": {\r\n    "root-namespace": "Shop"\r\n  }\r\n}';
    await writeFile(file, original, 'utf8');

    const loaded = await loadConfig(file);
    expect(loaded.config.names?.['root-namespace']).toBe('Shop');
    expect(loaded.format).toEqual({ bom: true, indent: '  ', eol: '\r\n', finalNewline: false });

    await saveConfig(file, loaded.config, loaded.format);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('keeps key order, including unknown sections', () => {
    const text = '{\n    "efcpt-ui": {"connection": {"env": "DB"}},\n    "tables": []\n}\n';
    const format = detectFormat(text);
    expect(format.indent).toBe('    ');
    const round = serializeConfig(JSON.parse(text), format);
    expect(Object.keys(JSON.parse(round))).toEqual(['efcpt-ui', 'tables']);
    expect(round.endsWith('}\n')).toBe(true);
  });

  it('reports invalid JSON with the file path', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'efcpt-config.json');
    await writeFile(file, '{ not json');
    await expect(loadConfig(file)).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig(file)).rejects.toThrow(file);
  });

  it('validates against the efcpt schema', () => {
    expect(validateConfig({ tables: [{ name: 'Users' }] })).toEqual([]);
    expect(validateConfig({ tables: [{ name: 42 as unknown as string }] })).toEqual([
      '/tables/0/name: must be string',
    ]);
    // efcpt has defaults for everything the schema marks as required, so missing options are fine
    expect(validateConfig({ 'code-generation': { type: 'all' } as never })).toEqual([]);
    expect(validateConfig({ 'code-generation': { type: 'everything' } as never })).toEqual([
      '/code-generation/type: must be equal to one of the allowed values',
    ]);
  });
});

describe('selection (mirrors CliConfigMapper exclusion rules)', () => {
  const tables: ConfigEntry[] = [
    { exclusionWildcard: '*Log' },
    { name: 'AuditLog' },
    { name: 'Customers', exclude: true },
    { name: 'Orders' },
  ];

  // Same config as the spike check that was compared with real efcpt output: only Orders is generated
  it('applies explicit excludes and wildcards', () => {
    expect(isSelected(tables, 'AuditLog')).toBe(false);
    expect(isSelected(tables, 'Customers')).toBe(false);
    expect(isSelected(tables, 'Orders')).toBe(true);
  });

  it('does not generate objects missing from the final list', () => {
    expect(isSelected([{ name: 'Customers' }], 'Orders')).toBe(false);
  });

  it('adds missing objects when refresh-object-lists is on (the default)', () => {
    const entries = [{ exclusionWildcard: '*Log' }, { name: 'Customers' }];
    expect(isGenerated({ tables: entries }, 'tables', 'Orders')).toBe(true);
    expect(isGenerated({ tables: entries }, 'tables', 'AuditLog')).toBe(false); // wildcard still applies
    const noRefresh = { 'code-generation': { 'refresh-object-lists': false } as never, tables: entries };
    expect(isGenerated(noRefresh, 'tables', 'Orders')).toBe(false);
  });

  it('lets exclude: false override a wildcard', () => {
    const views = [{ exclusionWildcard: 'Big*' }, { name: 'BigOrders', exclude: false }];
    expect(isSelected(views, 'BigOrders')).toBe(true);
  });

  it('handles the exclude-everything wildcard', () => {
    const entries = [{ exclusionWildcard: '*' }, { name: 'Users', exclude: false }, { name: 'Messages' }];
    expect(isSelected(entries, 'Users')).toBe(true);
    expect(isSelected(entries, 'Messages')).toBe(false);
  });

  it('matches wildcards on the SQL Server display name, case sensitive', () => {
    const entries = [
      { exclusionWildcard: '[other].*' },
      { name: '[other].[Accounts]' },
      { name: '[dbo].[Users]' },
    ];
    expect(isSelected(entries, '[other].[Accounts]')).toBe(false);
    expect(isSelected(entries, '[dbo].[Users]')).toBe(true);
    expect(isSelected([{ exclusionWildcard: '*log' }, { name: 'AuditLog' }], 'AuditLog')).toBe(true);
  });

  it('ignores a wildcard with * only in the middle', () => {
    expect(isSelected([{ exclusionWildcard: 'Au*Log' }, { name: 'AuditLog' }], 'AuditLog')).toBe(true);
  });

  it('setSelected writes the smallest change (refresh-object-lists off)', () => {
    const config = {
      'code-generation': { 'refresh-object-lists': false } as never,
      tables: structuredClone(tables),
    };

    setSelected(config, 'tables', 'AuditLog', true); // wildcard excludes it, needs explicit false
    expect(config.tables.find((t) => t.name === 'AuditLog')).toEqual({ name: 'AuditLog', exclude: false });

    setSelected(config, 'tables', 'Customers', true); // explicit exclude removed, no flag needed
    expect(config.tables.find((t) => t.name === 'Customers')).toEqual({ name: 'Customers' });

    setSelected(config, 'tables', 'Orders', false);
    expect(config.tables.find((t) => t.name === 'Orders')).toEqual({ name: 'Orders', exclude: true });

    setSelected(config, 'tables', 'NewTable', true);
    expect(config.tables.at(-1)).toEqual({ name: 'NewTable' });

    setSelected(config, 'tables', 'Missing', false); // already not generated, nothing added
    expect(config.tables.some((t) => t.name === 'Missing')).toBe(false);

    for (const [name, expected] of [
      ['AuditLog', true],
      ['Customers', true],
      ['Orders', false],
      ['NewTable', true],
      ['Missing', false],
    ] as const) {
      expect(isGenerated(config, 'tables', name)).toBe(expected);
    }
  });

  it('setSelected with refresh-object-lists on (the default)', () => {
    const config = { tables: [{ name: 'Customers' }] as ConfigEntry[] };

    setSelected(config, 'tables', 'NewTable', true); // refresh adds it anyway: no change
    expect(config.tables).toEqual([{ name: 'Customers' }]);

    setSelected(config, 'tables', 'Hidden', false); // must be listed, or refresh would add and generate it
    expect(config.tables.at(-1)).toEqual({ name: 'Hidden', exclude: true });

    expect(isGenerated(config, 'tables', 'NewTable')).toBe(true);
    expect(isGenerated(config, 'tables', 'Hidden')).toBe(false);
  });
});
