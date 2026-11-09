// Downloads the engine for an EF Core version from the engines release this copy of efcpt-cli was built with,
// into the download cache: <cache>/engines/<engines tag>/ef<N>/efcpt.<N>.dll. So code generation always
// matches the efcpt-cli version. Engines of other releases are removed once they're replaced.
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
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

/**
 * GETs a URL, following redirects (GitHub sends release downloads to its file storage). Uses node:http(s)
 * rather than fetch: streaming a large fetch body to disk can crash Node 22's built-in HTTP client
 * (undici's "assert(!this.paused)") when the server closes the connection while the stream waits on the disk.
 */
function download(url: string, redirectsLeft = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    const request = get(url, { headers: { 'user-agent': 'efcpt-cli' } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft === 0) {
          reject(new Error('too many redirects'));
          return;
        }
        download(new URL(location, url).toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      resolve(response);
    });
    request.on('error', reject);
  });
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
  let response: IncomingMessage;
  try {
    response = await download(url);
  } catch (error) {
    throw fail(describeFetchError(error));
  }

  const engines = path.join(cacheRoot, 'engines');
  await mkdir(engines, { recursive: true });
  const temp = await mkdtemp(path.join(engines, '.download-'));
  try {
    const archive = path.join(temp, 'engine.tar.gz');
    try {
      await pipeline(response, createWriteStream(archive));
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
