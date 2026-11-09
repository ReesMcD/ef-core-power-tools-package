// Downloads the engine for an EF Core version from the engines release this copy of efcpt-cli was built with,
// into the download cache: <cache>/engines/<engines tag>/ef<N>/efcpt.<N>.dll. So code generation always
// matches the efcpt-cli version. Engines of other releases are removed once they're replaced.
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { extract } from 'tar';
import { assetUrl, describeFetchError, engineAsset } from '../release.js';
import { EngineNotFoundError } from './errors.js';

export function releaseEnginePath(cacheRoot: string, tag: string, efVersion: number): string {
  return path.join(cacheRoot, 'engines', tag, `ef${efVersion}`, `efcpt.${efVersion}.dll`);
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

export interface DownloadOptions {
  efVersion: number;
  tag: string;
  cacheRoot: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

/** Returns the engine's path, downloading it first when it isn't in the cache yet. */
export async function downloadEngine(options: DownloadOptions): Promise<string> {
  const { efVersion, tag, cacheRoot, env } = options;
  const dll = releaseEnginePath(cacheRoot, tag, efVersion);
  if (await exists(dll)) return dll;

  const url = assetUrl(env, tag, engineAsset(efVersion));
  const fail = (reason: string) =>
    new EngineNotFoundError(
      `Could not download the EF Core ${efVersion} engine from ${url}: ${reason}\n` +
        `Check your network connection and try again. Or download that file yourself, extract it ` +
        `and run efcpt with --engine <folder>/efcpt.${efVersion}.dll.`,
    );
  options.log(`Downloading the EF Core ${efVersion} engine (${tag}, only when the engine changes)...`);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw fail(describeFetchError(error));
  }
  if (!response.ok || !response.body) throw fail(`HTTP ${response.status}`);

  const engines = path.join(cacheRoot, 'engines');
  await mkdir(engines, { recursive: true });
  const temp = await mkdtemp(path.join(engines, '.download-'));
  try {
    const archive = path.join(temp, 'engine.tar.gz');
    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
        createWriteStream(archive),
      );
    } catch (error) {
      throw fail(describeFetchError(error));
    }
    const unpacked = path.join(temp, 'engine');
    await mkdir(unpacked);
    await extract({ file: archive, cwd: unpacked });
    if (!(await exists(path.join(unpacked, `efcpt.${efVersion}.dll`)))) {
      throw fail(`the download has no efcpt.${efVersion}.dll`);
    }
    await mkdir(path.dirname(path.dirname(dll)), { recursive: true });
    try {
      await rename(unpacked, path.dirname(dll));
    } catch (error) {
      // Another efcpt run downloaded it at the same time
      if (!(await exists(dll))) throw error;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  // Engines of other efcpt-cli versions aren't used any more
  for (const entry of await readdir(engines)) {
    if (entry !== tag && !entry.startsWith('.download-')) {
      await rm(path.join(engines, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return dll;
}
