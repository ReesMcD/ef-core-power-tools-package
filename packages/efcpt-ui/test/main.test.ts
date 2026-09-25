import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Output } from '../src/commands/common.js';
import { main } from '../src/main.js';

const fakeEngine = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));
const sampleProject = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));

function capture(): Output & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (line = '') => stdout.push(line), err: (line = '') => stderr.push(line) };
}

async function copySample(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-main-'));
  await cp(sampleProject, dir, { recursive: true });
  return dir;
}

// Isolated environment: no real engine on PATH, empty download cache
async function env(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  return { EFCPT_UI_CACHE: await mkdtemp(path.join(tmpdir(), 'efcpt-ui-cache-')), PATH: '', ...extra };
}

afterEach(() => {
  delete process.env['FAKE_ENGINE_MODE'];
});

describe('efcpt-ui main', () => {
  it('prints help and version', async () => {
    const io = capture();
    expect(await main(['--help'], {}, io)).toBe(0);
    expect(io.stdout[0]).toContain('efcpt-ui - EF Core Power Tools UI');

    const version = capture();
    expect(await main(['--version'], {}, version)).toBe(0);
    expect(version.stdout[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects bad arguments with exit code 2', async () => {
    const io = capture();
    expect(await main(['--nope'], {}, io)).toBe(2);
    expect(io.stderr[0]).toMatch(/^error: .*--nope/);
    expect(await main(['--generate', '--list'], {}, capture())).toBe(2);
    expect(await main(['--port', 'abc'], {}, capture())).toBe(2);
  });

  it('asks for --config when a project has several configs', async () => {
    const dir = await copySample();
    await writeFile(path.join(dir, 'other.efcpt.json'), '{}');
    const io = capture();
    expect(await main(['--list'], await env(), io, dir)).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/several efcpt configs[\s\S]*other\.efcpt\.json/);
  });

  it('explains how to provide a connection', async () => {
    const dir = await copySample();
    const io = capture();
    // the sample config reads SAMPLE_SHOP_DB, which is not set
    expect(await main(['--generate'], await env(), io, dir)).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/SAMPLE_SHOP_DB/);
  });

  it('explains how to get an engine', async () => {
    const dir = await copySample();
    const io = capture();
    expect(await main(['--generate'], await env({ SAMPLE_SHOP_DB: 'Data Source=x.db' }), io, dir)).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/No engine found for EF Core 10[\s\S]*efcpt\.10\.csproj/);
  });

  it('lists objects with the fake engine', async () => {
    const dir = await copySample();
    const io = capture();
    const code = await main(
      ['--list', '--engine', fakeEngine],
      await env({ SAMPLE_SHOP_DB: 'Data Source=x.db' }),
      io,
      dir,
    );
    expect(code).toBe(0);
    expect(io.stdout).toContain('  [x] Customers  (Id*, Name)');
    expect(io.stdout).toContain('  [x] BigOrders');
    expect(io.stderr.join('\n')).toContain(
      'connection: environment variable SAMPLE_SHOP_DB, provider sqlite',
    );
  });

  it('generates with the fake engine, passing the project folder as output', async () => {
    const dir = await copySample();
    const io = capture();
    const code = await main(
      ['--generate', '--engine', fakeEngine, '--connection', 'Data Source=flag.db'],
      await env(),
      io,
      dir,
    );
    expect(code).toBe(0);
    expect(io.stdout[0]).toMatch(/^Generated 1 files in/);
  });

  it('returns 1 and redacts the connection when the engine reports an error', async () => {
    const dir = await copySample();
    process.env['FAKE_ENGINE_MODE'] = 'error';
    const io = capture();
    const secret = 'Server=db;Password=hunter2';
    expect(await main(['--list', '--engine', fakeEngine, '--connection', secret], await env(), io, dir)).toBe(
      1,
    );
    const all = [...io.stdout, ...io.stderr].join('\n');
    expect(all).toContain('error: cannot open <connection string>');
    expect(all).not.toContain('hunter2');
  });

  it('uses --project to find the config', async () => {
    const dir = await copySample();
    await mkdir(path.join(dir, 'nested'));
    const io = capture();
    const code = await main(
      ['--list', '--project', path.join(dir, 'Sample.csproj'), '--engine', fakeEngine],
      await env({ SAMPLE_SHOP_DB: 'Data Source=x.db' }),
      io,
      path.join(dir, 'nested'),
    );
    expect(code).toBe(0);
  });
});
