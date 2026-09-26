import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Output } from '../src/commands/common.js';
import {
  convertVsConfig,
  efcptPathFor,
  findVsConfigFiles,
  importVsConfig,
  isVsConfigFileName,
} from '../src/config/vs-import.js';
import { main } from '../src/main.js';

const vsFixture = fileURLToPath(new URL('./fixtures/vs-config/efpt.config.json', import.meta.url));
const sampleProject = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));

function capture(): Output & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (line = '') => stdout.push(line), err: (line = '') => stderr.push(line) };
}

describe('Visual Studio config import', () => {
  it('recognises the VS extension file names and maps them to efcpt config names', () => {
    expect(isVsConfigFileName('efpt.config.json')).toBe(true);
    expect(isVsConfigFileName('efpt.Sales.config.json')).toBe(true);
    expect(isVsConfigFileName('efpt.renaming.json')).toBe(false);
    expect(isVsConfigFileName('efcpt-config.json')).toBe(false);
    expect(efcptPathFor(path.join('a', 'efpt.config.json'))).toBe(path.join('a', 'efcpt-config.json'));
    expect(efcptPathFor(path.join('a', 'efpt.Sales.config.json'))).toBe(
      path.join('a', 'efcpt-config.Sales.json'),
    );
  });

  it('converts the selection and options (BOM, CRLF and VS formatting)', async () => {
    const { config, objectCount, warnings } = await importVsConfig(vsFixture, 10);
    expect(warnings).toEqual([]);
    expect(objectCount).toBe(3);
    expect(config.names).toEqual({
      'dbcontext-name': 'ShopDbContext',
      'dbcontext-namespace': null,
      'model-namespace': 'Entities',
      'root-namespace': 'Sample.Shop',
    });
    expect(config['file-layout']).toMatchObject({
      'output-path': 'Data/Entities',
      'output-dbcontext-path': 'Data',
    });
    expect(config['code-generation']).toMatchObject({
      'refresh-object-lists': false, // VS only generates the listed objects
      'use-data-annotations': true, // UseFluentApiOnly: false
      type: 'all',
      'use-typed-tvp-parameters': true,
    });
    expect(config.tables).toEqual([
      { name: 'Customers' },
      { name: 'Orders', excludedColumns: ['CreatedAt'] },
    ]);
    expect(config.views).toEqual([{ name: 'BigOrders' }]);
    expect(config['stored-procedures']).toBeUndefined();
    expect(config.replacements).toEqual({
      'preserve-casing-with-regex': true,
      'irregular-words': [{ singular: 'Octopus', plural: 'Octopi', 'match-ending': false }],
      'uncountable-words': ['Status'],
      'singular-rules': [{ rule: '(.+)ies$', replacement: '$1' }],
    });
    expect(config['type-mappings']).toEqual({
      'use-DateOnly-TimeOnly': true,
      'use-HierarchyId': false,
      'use-spatial': false,
      'use-NodaTime': false,
    });
  });

  it('maps stored procedure and function entries, and "no object filter"', () => {
    const { config } = convertVsConfig({
      Tables: [
        { Name: '[dbo].[GetOrders]', ObjectType: 1, UseLegacyResultSetDiscovery: true, MappedType: 'Order' },
        { Name: '[dbo].[Tax]', ObjectType: 2 },
        { Name: '[dbo].[Orders]', ObjectType: 0, ExcludedIndexes: ['IX_Orders_Date'] },
      ],
      SelectedToBeGenerated: 2,
    });
    expect(config['stored-procedures']).toEqual([
      { name: '[dbo].[GetOrders]', 'use-legacy-resultset-discovery': true, 'mapped-type': 'Order' },
    ]);
    expect(config.functions).toEqual([{ name: '[dbo].[Tax]' }]);
    expect(config.tables).toEqual([{ name: '[dbo].[Orders]', excludedIndexes: ['IX_Orders_Date'] }]);
    expect(config['code-generation']).toEqual({ type: 'entities', 'refresh-object-lists': false });

    const all = convertVsConfig({ UseNoObjectFilter: true, Tables: [{ Name: 'x', ObjectType: 0 }] });
    expect(all.config['code-generation']).toEqual({ 'refresh-object-lists': true });
    expect(all.config.tables).toBeUndefined();
  });

  it('warns about what does not carry over', () => {
    const { warnings } = convertVsConfig(
      { UseHandleBars: true, UseAsyncStoredProcedureCalls: false, CodeGenerationMode: 4 },
      { projectEfVersion: 10 },
    );
    expect(warnings).toHaveLength(3);
    expect(warnings[2]).toMatch(/EF Core 8; this project uses EF Core 10/);
  });

  it('keeps using a config specific renaming file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-vs-'));
    await cp(vsFixture, path.join(dir, 'efpt.Sales.config.json'));
    expect(
      (await importVsConfig(path.join(dir, 'efpt.Sales.config.json'))).config['efcpt-ui'],
    ).toBeUndefined();
    await writeFile(path.join(dir, 'efpt.Sales.renaming.json'), '[]');
    expect((await importVsConfig(path.join(dir, 'efpt.Sales.config.json'))).config['efcpt-ui']).toEqual({
      renaming: 'efpt.Sales.renaming.json',
    });
    expect(await findVsConfigFiles(dir)).toEqual([path.join(dir, 'efpt.Sales.config.json')]);
  });

  it('efcpt-ui --import-vs writes the config next to the VS one, and never overwrites', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-vs-'));
    await cp(sampleProject, dir, { recursive: true });
    await cp(vsFixture, path.join(dir, 'Data', 'efpt.config.json'), { recursive: true });
    const env = { EFCPT_UI_SKIP_CHECKOUT_ENGINE: '1', PATH: '' };

    const io = capture();
    expect(await main(['--import-vs', path.join('Data', 'efpt.config.json')], env, io, dir)).toBe(0);
    expect(io.stdout[0]).toBe(
      `Imported efpt.config.json into ${path.join(dir, 'Data', 'efcpt-config.json')}`,
    );
    const written = JSON.parse(await readFile(path.join(dir, 'Data', 'efcpt-config.json'), 'utf8'));
    expect(written.names['dbcontext-name']).toBe('ShopDbContext');

    const again = capture();
    expect(await main(['--import-vs', path.join('Data', 'efpt.config.json')], env, again, dir)).toBe(2);
    expect(again.stderr.join('\n')).toMatch(/already exists/);
  });
});
