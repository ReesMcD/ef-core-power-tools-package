import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cachedEnginePath,
  engineFromPath,
  EngineNotFoundError,
  locateEngine,
  probeEngineVersion,
  type Engine,
} from '../src/engine/locate.js';
import {
  EngineError,
  generate,
  generateArgs,
  listObjects,
  listObjectsArgs,
  parseEngineOutput,
} from '../src/engine/run.js';
import { parseRuntimes, requiredRuntimeMajor } from '../src/engine/runtime.js';

const fakeEngine: Engine = {
  command: process.execPath,
  prefixArgs: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))],
  description: 'fake engine',
};
const connection = 'Data Source=shop.db;Password=hunter2';

afterEach(() => {
  delete process.env['FAKE_ENGINE_MODE'];
});

describe('engine arguments', () => {
  it('builds list and generate arguments', () => {
    expect(listObjectsArgs({ connection: 'c', provider: 'sqlite', configPath: 'cfg.json' })).toEqual([
      'c',
      'sqlite',
      '-i',
      'cfg.json',
      '--list-objects',
      '--json',
    ]);
    expect(
      generateArgs({ connection: 'c', configPath: 'cfg.json', outputDir: 'out', renamingPath: 'r.json' }),
    ).toEqual(['c', '-i', 'cfg.json', '-o', 'out', '-r', 'r.json', '--json']);
  });

  it('takes the last JSON line of stdout', () => {
    expect(parseEngineOutput('noise\n{"schemaVersion":1,"command":"generate"}\n')?.command).toBe('generate');
    expect(parseEngineOutput('nothing here')).toBeUndefined();
  });
});

describe('engine runner', () => {
  it('lists objects and passes arguments through untouched', async () => {
    const logs: string[] = [];
    const doc = await listObjects(
      fakeEngine,
      { connection, provider: 'sqlite' },
      { onLog: (l) => logs.push(l) },
    );
    expect(doc.objects?.[0]?.displayName).toBe('Customers');
    expect((doc as unknown as { args: string[] }).args[0]).toBe(connection);
    // progress output is streamed with the connection string hidden
    expect(logs).toEqual(['Getting database objects from <connection string>...', 'second line']);
  });

  it('generates', async () => {
    const doc = await generate(fakeEngine, {
      connection,
      configPath: 'efcpt-config.json',
      outputDir: '/out',
    });
    expect(doc.entityTypeFilePaths).toEqual(['/out/Customer.cs']);
  });

  it('returns engine errors with secrets redacted', async () => {
    process.env['FAKE_ENGINE_MODE'] = 'error';
    const doc = await listObjects(fakeEngine, { connection });
    expect(doc.success).toBe(false);
    expect(doc.errors).toEqual(['cannot open <connection string>']);
  });

  it('fails clearly when the engine gives no JSON', async () => {
    process.env['FAKE_ENGINE_MODE'] = 'garbage';
    const error = await listObjects(fakeEngine, { connection }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).message).toMatch(/exit code 3/);
    expect((error as EngineError).details).not.toContain('hunter2');
  });

  it('rejects an unknown result format', async () => {
    process.env['FAKE_ENGINE_MODE'] = 'future';
    await expect(listObjects(fakeEngine, { connection })).rejects.toThrow(/format 99/);
  });

  it('times out', async () => {
    process.env['FAKE_ENGINE_MODE'] = 'hang';
    await expect(listObjects(fakeEngine, { connection }, { timeoutMs: 500 })).rejects.toThrow(
      /did not finish/,
    );
  });

  it('reports an engine that cannot start', async () => {
    const missing: Engine = {
      command: path.join(tmpdir(), 'no-such-engine'),
      prefixArgs: [],
      description: 'missing',
    };
    await expect(listObjects(missing, { connection })).rejects.toThrow(/Cannot start the engine/);
  });
});

describe('locateEngine', () => {
  it('runs .dll engines through dotnet', () => {
    expect(engineFromPath('/x/efcpt.10.dll', 'd')).toEqual({
      command: 'dotnet',
      prefixArgs: [path.resolve('/x/efcpt.10.dll')],
      description: 'd',
    });
    expect(engineFromPath('/x/efcpt-ui-engine', 'd').prefixArgs).toEqual([]);
  });

  it('uses --engine, then EFCPT_UI_ENGINE, then the cache', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-cache-'));
    const env = { EFCPT_UI_ENGINE: '/env/efcpt.10.dll' };
    const common = { efVersion: 10 as const, cacheRoot, searchPath: false };

    expect((await locateEngine({ ...common, env, enginePath: '/flag/efcpt.10.dll' })).description).toMatch(
      /^--engine/,
    );
    expect((await locateEngine({ ...common, env })).description).toMatch(/^EFCPT_UI_ENGINE/);

    const cached = cachedEnginePath(cacheRoot, 10);
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, '');
    expect((await locateEngine({ ...common, env: {} })).prefixArgs).toEqual([cached]);
  });

  it('explains how to get an engine when none is found', async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-cache-'));
    const error = await locateEngine({ efVersion: 9, env: {}, cacheRoot, searchPath: false }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EngineNotFoundError);
    expect((error as Error).message).toContain('src/Core/efcpt.9/efcpt.9.csproj');
  });

  it('reads the EF Core version an engine was built for', async () => {
    expect(await probeEngineVersion(fakeEngine)).toBe(10);
  });
});

describe('runtime check', () => {
  it('parses dotnet --list-runtimes', () => {
    const output = [
      'Microsoft.AspNetCore.App 10.0.12 [/usr/lib/dotnet/shared/Microsoft.AspNetCore.App]',
      'Microsoft.NETCore.App 8.0.31 [/usr/lib/dotnet/shared/Microsoft.NETCore.App]',
      'Microsoft.NETCore.App 10.0.0-rc.2.25502.107 [/usr/lib/dotnet/shared/Microsoft.NETCore.App]',
    ].join('\n');
    expect(parseRuntimes(output)).toEqual(['8.0.31', '10.0.0-rc.2.25502.107']);
  });

  it('knows which runtime each engine needs', () => {
    expect(requiredRuntimeMajor(8)).toBe(8);
    expect(requiredRuntimeMajor(9)).toBe(8);
    expect(requiredRuntimeMajor(10)).toBe(10);
  });
});
