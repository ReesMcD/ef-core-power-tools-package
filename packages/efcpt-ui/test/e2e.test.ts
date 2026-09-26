// End-to-end test against the real engine. Runs only when EFCPT_UI_E2E_ENGINE points at a built
// efcpt.10.dll (see .github/workflows/efcpt-ui.yml). Set EFCPT_UI_E2E_BUILD=1 to also compile the result.
// With EFCPT_UI_E2E_REVENG pointing at a built efreveng100.dll (the Visual Studio extension's code generator),
// it also checks that an imported VS config generates the same code as the extension.
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Output } from '../src/commands/common.js';
import { main } from '../src/main.js';

const engine = process.env['EFCPT_UI_E2E_ENGINE'];
const reveng = process.env['EFCPT_UI_E2E_REVENG'];
const sampleProject = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));
const vsFixture = fileURLToPath(new URL('./fixtures/vs-config/efpt.config.json', import.meta.url));

function capture(): Output & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (line = '') => stdout.push(line), err: (line = '') => stderr.push(line) };
}

describe.runIf(engine)('end to end with the real engine', () => {
  it('lists, generates exactly the listed objects, and keeps the efcpt-ui section', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-e2e-'));
    await cp(sampleProject, dir, { recursive: true });
    const env = { ...process.env, SAMPLE_SHOP_DB: `Data Source=${path.join(dir, 'shop.db')}` };

    const list = capture();
    expect(await main(['--list', '--engine', engine!], env, list, dir)).toBe(0);
    const marks = list.stdout.filter((l) => /^\s+\[[x ]\]/.test(l)).map((l) => l.trim().split('  ')[0]);
    expect(marks).toEqual(['[ ] AuditLog', '[x] Customers', '[x] Orders', '[x] BigOrders']);

    const gen = capture();
    const code = await main(['--generate', '--engine', engine!], env, gen, dir);
    expect(code, gen.stderr.join('\n')).toBe(0);

    // What --list predicted (refresh-object-lists on, AuditLog excluded) is what was generated
    const models = (await readdir(path.join(dir, 'Models'))).sort();
    expect(models).toEqual(['BigOrder.cs', 'Customer.cs', 'Order.cs', 'ShopContext.cs']);

    const config = JSON.parse(
      (await readFile(path.join(dir, 'efcpt-config.json'), 'utf8')).replace(/^\uFEFF/, ''),
    );
    expect(config['efcpt-ui']).toEqual({ provider: 'sqlite', connection: { env: 'SAMPLE_SHOP_DB' } });
    expect(JSON.stringify(config)).not.toContain(dir); // the connection string never ends up in the config

    if (process.env['EFCPT_UI_E2E_BUILD'] === '1') {
      const build = spawnSync('dotnet', ['build', path.join(dir, 'Sample.csproj'), '-nologo', '-v', 'q'], {
        encoding: 'utf8',
        timeout: 600_000,
      });
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    }
  }, 900_000);
});

/** Relative path -> content of every .cs file below a folder. */
async function sources(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.cs')) continue;
    const full = path.join(entry.parentPath, entry.name);
    if (/[\\/](bin|obj)[\\/]/.test(full)) continue;
    files.set(path.relative(root, full), await readFile(full, 'utf8'));
  }
  return files;
}

/**
 * The options the Visual Studio extension passes to efreveng for an efpt.config.json, as built by
 * EfRevEngLauncher.LaunchExternalRunnerAsync (src/GUI/Shared/Handlers/ReverseEngineer/EfRevEngLauncher.cs),
 * with the extension's advanced options at their defaults (src/GUI/Shared/Options/AdvancedOptions.cs).
 */
function vsLauncherOptions(vs: Record<string, unknown>, projectDir: string, connection: string) {
  const copied = [
    'ContextClassName',
    'IncludeConnectionString',
    'OutputPath',
    'ContextNamespace',
    'ModelNamespace',
    'OutputContextPath',
    'UseSchemaFolders',
    'ProjectRootNamespace',
    'SelectedToBeGenerated',
    'Tables',
    'UseDatabaseNames',
    'UseFluentApiOnly',
    'UseHandleBars',
    'SelectedHandlebarsLanguage',
    'UseT4',
    'UseT4Split',
    'T4TemplatePath',
    'UseInflector',
    'UseLegacyPluralizer',
    'UncountableWords',
    'SingularRules',
    'PluralRules',
    'IrregularWords',
    'UseSpatial',
    'UseHierarchyId',
    'UseDbContextSplitting',
    'UseNodaTime',
    'UseBoolPropertiesWithoutDefaultSql',
    'UseNullableReferences',
    'UseNoObjectFilter',
    'UseNoNavigations',
    'UseNoDefaultConstructor',
    'UseManyToManyEntity',
    'PreserveCasingWithRegex',
    'UseDateOnlyTimeOnly',
    'UseSchemaNamespaces',
    'UsePrefixNavigationNaming',
    'UseDatabaseNamesForRoutines',
    'UseTypedTvpParameters',
  ];
  return {
    ...Object.fromEntries(copied.map((key) => [key, vs[key]])),
    ConnectionString: connection,
    DatabaseType: 4, // SQLite
    ProjectPath: projectDir + path.sep,
    RunCleanup: true,
    UseMultipleSprocResultSets: false,
    MergeDacpacs: false,
    UseLegacyResultSetDiscovery: false,
    UseStoredProcedureResultSetFallback: true,
    UseAsyncCalls: vs['UseAsyncStoredProcedureCalls'],
    UseDecimalDataAnnotation: vs['UseDecimalDataAnnotationForSprocResult'],
  };
}

describe.runIf(engine && reveng)('parity with the Visual Studio extension', () => {
  it('generates the same code from an imported efpt.config.json as the extension does', async () => {
    const vs = JSON.parse((await readFile(vsFixture, 'utf8')).replace(/^\uFEFF/, '')) as Record<
      string,
      unknown
    >;
    const dirs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-parity-'));
      await cp(sampleProject, dir, { recursive: true });
      await rm(path.join(dir, 'efcpt-config.json'));
      await cp(vsFixture, path.join(dir, 'efpt.config.json'));
      dirs.push(dir);
    }
    const [vsDir, uiDir] = dirs as [string, string];

    // The extension's code generator
    const optionsFile = path.join(vsDir, 'options.json');
    await writeFile(
      optionsFile,
      JSON.stringify(vsLauncherOptions(vs, vsDir, `Data Source=${path.join(vsDir, 'shop.db')}`)),
    );
    const run = spawnSync('dotnet', [reveng!, optionsFile], { encoding: 'utf8', timeout: 300_000 });
    expect(run.stdout.trimStart().startsWith('Result:'), `${run.stdout}\n${run.stderr}`).toBe(true);

    // efcpt-ui
    const env = { ...process.env, EFCPT_UI_SKIP_CHECKOUT_ENGINE: '1' };
    const imported = capture();
    expect(await main(['--import-vs', 'efpt.config.json'], env, imported, uiDir)).toBe(0);
    const gen = capture();
    const connection = `Data Source=${path.join(uiDir, 'shop.db')}`;
    const code = await main(['--generate', '--engine', engine!, '--connection', connection], env, gen, uiDir);
    expect(code, gen.stderr.join('\n')).toBe(0);

    const expected = await sources(vsDir);
    expect(expected.size).toBeGreaterThan(0);
    expect(await sources(uiDir)).toEqual(expected);
  }, 900_000);
});
