import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import type { Output } from '../src/commands/common.js';
import { updateFromRelease } from '../src/commands/update.js';
import { downloadEngine } from '../src/engine/download.js';
import { cachedEnginePath, EngineNotFoundError, locateEngine } from '../src/engine/locate.js';
import { latestReleaseTag } from '../src/release.js';

function capture(): Output & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (line = '') => stdout.push(line), err: (line = '') => stderr.push(line) };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

/** A stand-in for GitHub Releases: /latest redirects to the latest tag, /download/<tag>/<file> serves files. */
async function releases(latest: string, files: Record<string, Buffer>) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push(url);
    if (url === '/releases/latest') {
      response.writeHead(302, { location: `https://example.test/owner/repo/releases/tag/${latest}` }).end();
      return;
    }
    const file = files[url.replace('/releases/download/', '')];
    if (file) response.writeHead(200).end(file);
    else response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    EFCPT_CLI_RELEASES_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases/`,
  };
  return { env, requests };
}

/** An engine archive as the release workflow makes it: the published engine's files at the top level. */
async function engineArchive(efVersion: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-engine-'));
  await writeFile(path.join(dir, `efcpt.${efVersion}.dll`), 'engine');
  await mkdir(path.join(dir, 'runtimes'));
  await writeFile(path.join(dir, 'runtimes', 'native.so'), 'native');
  const archive = path.join(dir, '..', `${path.basename(dir)}.tar.gz`);
  await create({ gzip: true, file: archive, cwd: dir }, ['.']);
  return readFile(archive);
}

describe('installing from releases', () => {
  it('finds the latest release', async () => {
    const { env } = await releases('v0.2.7', {});
    expect(await latestReleaseTag(env)).toBe('v0.2.7');
  });

  it("downloads the release's engine once, into the cache, and removes engines of other releases", async () => {
    const { env, requests } = await releases('v0.2.7', {
      'engines-abc123/efcpt-engine-ef10.tar.gz': await engineArchive(10),
    });
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-cache-'));
    const old = cachedEnginePath(cacheRoot, 'engines-old111', 10);
    await mkdir(path.dirname(old), { recursive: true });
    await writeFile(old, '');

    const log: string[] = [];
    const release = { tag: 'engines-abc123', log: (line: string) => log.push(line) };
    const options = {
      efVersion: 10 as const,
      env,
      cacheRoot,
      repoRoot: false as const,
      searchPath: false,
      release,
    };
    const engine = await locateEngine(options);
    const dll = cachedEnginePath(cacheRoot, 'engines-abc123', 10);
    expect(engine).toMatchObject({ command: 'dotnet', prefixArgs: [dll] });
    expect(await readFile(dll, 'utf8')).toBe('engine');
    expect(await readFile(path.join(path.dirname(dll), 'runtimes', 'native.so'), 'utf8')).toBe('native');
    expect(log.join('\n')).toContain('Downloading the EF Core 10 engine');
    expect(await readdir(path.join(cacheRoot, 'engines'))).toEqual(['engines-abc123']);

    // Cached: no second download
    await locateEngine(options);
    expect(requests.filter((r) => r.endsWith('.tar.gz'))).toHaveLength(1);
  });

  it('says what to do when the engine cannot be downloaded', async () => {
    const { env } = await releases('v0.2.7', {});
    const cacheRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-cache-'));
    const error = await downloadEngine({
      efVersion: 9,
      tag: 'engines-abc123',
      cacheRoot,
      env,
      log: () => {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineNotFoundError);
    expect((error as Error).message).toMatch(/efcpt-engine-ef9\.tar\.gz: HTTP 404[\s\S]*--engine/);
    // Nothing half-downloaded is left behind
    expect(await readdir(path.join(cacheRoot, 'engines')).catch(() => [])).toEqual([]);
  });

  it('efcpt --update installs the latest release with npm, or says it is up to date', async () => {
    const { env } = await releases('v0.2.7', {});
    const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-update-'));
    const args = path.join(dir, 'args.txt');
    // Records how "npm" was called
    const script = path.join(dir, 'npm.cjs');
    await writeFile(
      script,
      `require('fs').writeFileSync(${JSON.stringify(args)}, process.argv.slice(2).join(' '));\n`,
    );
    const npm = [process.execPath, script];

    const current = capture();
    const info = { version: '0.2.7', efcptRelease: 'v0.2.7' };
    expect(await updateFromRelease({ info, env, io: current, npm })).toBe(0);
    expect(current.stdout.join('\n')).toContain('Already up to date');

    const older = capture();
    const old = { version: '0.2.5', efcptRelease: 'v0.2.5' };
    expect(await updateFromRelease({ info: old, env, io: older, npm }), older.stderr.join('\n')).toBe(0);
    expect(await readFile(args, 'utf8')).toBe(
      `install --global --no-audit --no-fund ${env.EFCPT_CLI_RELEASES_URL}download/v0.2.7/efcpt-cli.tgz`,
    );
    expect(older.stdout.join('\n')).toContain('Updated to v0.2.7');
  });
});
