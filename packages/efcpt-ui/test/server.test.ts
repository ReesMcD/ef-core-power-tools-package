import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/args.js';
import type { Output } from '../src/commands/common.js';
import type { GenerateEvent, SessionInfo } from '../src/server/api.js';
import { UiController } from '../src/server/controller.js';
import { startUiServer, type UiServer } from '../src/server/server.js';

const fakeEngine = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));
const sampleProject = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));
const vsFixture = fileURLToPath(new URL('./fixtures/vs-config/efpt.config.json', import.meta.url));
const quiet: Output = { out: () => {}, err: () => {} };
const servers: UiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

interface Started {
  server: UiServer;
  dir: string;
  api(pathname: string, init?: RequestInit): Promise<Response>;
}

async function start(
  argv: string[] = [],
  env: Record<string, string> = { SAMPLE_SHOP_DB: 'Data Source=shop.db' },
): Promise<Started> {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-server-'));
  await cp(sampleProject, dir, { recursive: true });
  const webRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-web-'));
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>efcpt-ui</title>');
  await writeFile(path.join(webRoot, 'app.js'), 'console.log(1)');

  const cache = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-cache-'));
  const controller = new UiController({
    args: parseCliArgs(['--engine', fakeEngine, ...argv]),
    env: { EFCPT_UI_CACHE: cache, ...env },
    cwd: dir,
    io: quiet,
  });
  await controller.init();
  const server = await startUiServer({ controller, webRoot });
  servers.push(server);

  // Log in once with the token, keep the cookie
  const login = await fetch(server.launchUrl, { redirect: 'manual' });
  expect(login.status).toBe(302);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;

  return {
    server,
    dir,
    api: (pathname, init = {}) =>
      fetch(new URL(pathname, server.url), {
        ...init,
        headers: { cookie, 'x-efcpt-ui': '1', 'content-type': 'application/json', ...(init.headers ?? {}) },
      }),
  };
}

function rawRequest(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('UI server security', () => {
  it('requires the token, then a cookie', async () => {
    const { server, api } = await start();
    expect((await fetch(server.url)).status).toBe(403);
    expect((await fetch(`${server.url}?token=wrong`)).status).toBe(403);
    expect((await api('/')).status).toBe(200);
    expect((await api('/app.js')).headers.get('content-type')).toContain('javascript');
  });

  it('rejects other hosts (DNS rebinding)', async () => {
    const { server } = await start();
    expect(await rawRequest(server.url, { host: 'evil.example:80' })).toBe(403);
  });

  it('requires the API header and a local origin', async () => {
    const { api } = await start();
    expect((await api('/api/session', { headers: { 'x-efcpt-ui': '' } })).status).toBe(403);
    expect((await api('/api/session', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await api('/api/session')).status).toBe(200);
  });

  it('never serves files outside the web folder', async () => {
    const { api } = await start();
    const response = await api('/..%2f..%2fpackage.json');
    expect(await response.text()).toContain('<title>efcpt-ui</title>');
  });
});

describe('UI server API', () => {
  it('describes the session without the connection string', async () => {
    const { api } = await start();
    const response = await api('/api/session');
    const text = await response.text();
    const info = JSON.parse(text) as SessionInfo;
    expect(info.configs).toEqual(['efcpt-config.json']);
    expect(info.project).toMatchObject({ name: 'Sample', efVersion: 10 });
    expect(info.connection).toEqual({ source: 'environment variable SAMPLE_SHOP_DB', isDacpac: false });
    expect(info.provider).toBe('sqlite');
    expect(text).not.toContain('Data Source');
  });

  it('starts without a connection and accepts one from the UI, kept out of responses', async () => {
    const { api } = await start([], {});
    const info = (await (await api('/api/session')).json()) as SessionInfo;
    expect(info.connection).toBeUndefined();
    expect(info.warnings.join()).toMatch(/SAMPLE_SHOP_DB/);
    expect((await api('/api/objects')).status).toBe(409);

    const secret = 'Data Source=typed.db;Password=hunter2';
    const response = await api('/api/connection', {
      method: 'POST',
      body: JSON.stringify({ connection: secret, provider: 'sqlite' }),
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain('hunter2');
    expect(JSON.parse(text).session.connection.source).toBe('entered in the UI');
    expect(JSON.parse(text).objects.objects[0].displayName).toBe('Customers');
  });

  it('lists objects through the engine', async () => {
    const { api } = await start();
    const body = (await (await api('/api/objects')).json()) as {
      databaseType: string;
      objects: { displayName: string }[];
    };
    expect(body.databaseType).toBe('SQLite');
    expect(body.objects.map((o) => o.displayName)).toEqual(['Customers', 'Orders', 'BigOrders']);
  });

  it('saves the config, keeping unknown sections and rejecting invalid values', async () => {
    const { api, dir } = await start();
    const { config } = (await (await api('/api/config')).json()) as { config: { tables: object[] } };

    const bad = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ config: { tables: [{ name: 1 }] } }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { details: string[] }).details).toEqual(['/tables/0/name: must be string']);

    config.tables.push({ name: 'Orders', exclude: true });
    const ok = await api('/api/config', { method: 'PUT', body: JSON.stringify({ config }) });
    expect(ok.status).toBe(200);
    const saved = JSON.parse(await readFile(path.join(dir, 'efcpt-config.json'), 'utf8'));
    expect(saved.tables).toContainEqual({ name: 'Orders', exclude: true });
    expect(saved['efcpt-ui'].connection).toEqual({ env: 'SAMPLE_SHOP_DB' });
  });

  it('streams generation progress and the result', async () => {
    const { api } = await start();
    const text = await (await api('/api/generate', { method: 'POST' })).text();
    const events = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as GenerateEvent);
    expect(events.filter((e) => e.type === 'log').length).toBeGreaterThan(0);
    const result = events.at(-1)!;
    expect(result.type).toBe('result');
    expect(result.type === 'result' && result.result.entityTypeFilePaths).toEqual(['/out/Customer.cs']);
    expect(text).not.toContain('Data Source');
  });

  it('reports engine failures with details', async () => {
    const { api } = await start(['--engine', path.join(tmpdir(), 'no-such-engine.mjs')]);
    const response = await api('/api/objects');
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toMatch(/engine/i);
  });

  it('lets the UI pick one of several configs, or create a new one from the template', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-server-'));
    await cp(sampleProject, dir, { recursive: true });
    await writeFile(path.join(dir, 'billing.efcpt.json'), '{}');

    const controller = new UiController({
      args: parseCliArgs(['--engine', fakeEngine]),
      env: { SAMPLE_SHOP_DB: 'Data Source=/data/shop.db' },
      cwd: dir,
      io: quiet,
    });
    await controller.init();
    const before = await controller.info();
    expect(before.configPath).toBeUndefined();
    expect(before.configs).toEqual(['billing.efcpt.json', 'efcpt-config.json']);

    await controller.selectConfig('efcpt-config.json');
    await controller.selectConfig(path.join('Data', 'Sales', 'efcpt-config.json'));
    const created = JSON.parse(await readFile(path.join(dir, 'Data/Sales/efcpt-config.json'), 'utf8'));
    expect(created.names).toEqual({ 'dbcontext-name': 'ShopContext', 'root-namespace': 'Sample.Shop' });
    // the new config reads the connection the same way as the one it was created from
    expect(created['efcpt-ui']).toEqual({ provider: 'sqlite', connection: { env: 'SAMPLE_SHOP_DB' } });
    expect((await controller.info()).configs).toContain(path.join('Data', 'Sales', 'efcpt-config.json'));
  });

  it('offers and imports Visual Studio extension configs, only from the project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-server-'));
    await cp(sampleProject, dir, { recursive: true });
    await rm(path.join(dir, 'efcpt-config.json'));
    await cp(vsFixture, path.join(dir, 'efpt.config.json'));

    const controller = new UiController({
      args: parseCliArgs(['--engine', fakeEngine]),
      env: {},
      cwd: dir,
      io: quiet,
    });
    await controller.init();
    expect((await controller.info()).vsConfigs).toEqual(['efpt.config.json']);

    await expect(controller.importVs('../elsewhere/efpt.config.json')).rejects.toThrow(/not a Visual Studio/);
    await controller.importVs('efpt.config.json');
    const info = await controller.info();
    expect(info.configPath).toBe(path.join(dir, 'efcpt-config.json'));
    expect(info.vsConfigs).toEqual([]); // imported: no longer offered
    expect((await controller.getConfig()).config.names?.['dbcontext-name']).toBe('ShopDbContext');
  });
});
