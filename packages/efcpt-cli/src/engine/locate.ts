import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EfVersion } from '../project.js';
import { downloadEngine, releaseEnginePath } from './download.js';
import { EngineNotFoundError } from './errors.js';
import { runProcess } from './process.js';

export interface Engine {
  /** Program to start, for example "dotnet" or a tool executable. */
  command: string;
  /** Arguments placed before the engine arguments, for example the path of efcpt.10.dll. */
  prefixArgs: string[];
  /** Where the engine was found, for display. */
  description: string;
}

export const engineEnvVar = 'EFCPT_CLI_ENGINE';
export const engineToolCommand = 'efcpt-cli-engine';

export { EngineNotFoundError };

/**
 * An engine given as a path: a .dll runs through `dotnet`, a .js/.mjs script (for example a test double
 * or wrapper) through Node, anything else is started directly.
 */
export function engineFromPath(enginePath: string, description: string): Engine {
  const full = path.resolve(enginePath);
  const lower = full.toLowerCase();
  if (lower.endsWith('.dll')) return { command: 'dotnet', prefixArgs: [full], description };
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return { command: process.execPath, prefixArgs: [full], description };
  }
  return { command: full, prefixArgs: [], description };
}

export function defaultCacheRoot(env: NodeJS.ProcessEnv): string {
  if (env['EFCPT_CLI_CACHE']) return env['EFCPT_CLI_CACHE'];
  if (process.platform === 'win32') {
    return path.join(env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local'), 'efcpt-cli', 'Cache');
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Caches', 'efcpt-cli');
  return path.join(env['XDG_CACHE_HOME'] ?? path.join(homedir(), '.cache'), 'efcpt-cli');
}

/** Where the engine downloaded from an engines release for an EF Core version lives. */
export function cachedEnginePath(cacheRoot: string, tag: string, efVersion: EfVersion): string {
  return releaseEnginePath(cacheRoot, tag, efVersion);
}

/** Reads the EF Core major version from `<engine> --version`, which prints for example "efcpt.10 10.0.0+abc". */
export async function probeEngineVersion(engine: Engine): Promise<number | undefined> {
  try {
    const { stdout } = await runProcess(engine.command, [...engine.prefixArgs, '--version'], {
      timeoutMs: 30_000,
    });
    const match = /efcpt\.(\d+)/.exec(stdout);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** The repository root when efcpt-cli runs from a checkout (packages/efcpt-cli/{src,dist}/engine/locate). */
export const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * An engine built in a checkout of this repository (src/Core/efcpt.N/bin/<Release|Debug>/<tfm>/efcpt.N.dll),
 * so efcpt-cli run from a checkout needs no --engine or EFCPT_CLI_ENGINE. Release builds win over Debug builds.
 */
export async function findCheckoutEngine(
  repoRoot: string,
  efVersion: EfVersion,
): Promise<string | undefined> {
  for (const configuration of ['Release', 'Debug']) {
    const bin = path.join(repoRoot, 'src', 'Core', `efcpt.${efVersion}`, 'bin', configuration);
    const frameworks = (await readdir(bin).catch(() => [] as string[])).filter((f) => f.startsWith('net'));
    for (const framework of frameworks.sort().reverse()) {
      const dll = path.join(bin, framework, `efcpt.${efVersion}.dll`);
      if (await exists(dll)) return dll;
    }
  }
  return undefined;
}

export interface LocateOptions {
  efVersion: EfVersion;
  enginePath?: string;
  env: NodeJS.ProcessEnv;
  cacheRoot?: string;
  /** Repository checkout to look for a built engine in, or false to skip; defaults to {@link checkoutRoot}. */
  repoRoot?: string | false;
  /** Check the dotnet tool on PATH; disabled in tests. */
  searchPath?: boolean;
  /**
   * The engines release of this copy of efcpt-cli (package.json efcptEngines): engines are downloaded from it
   * into the cache when they're needed. Undefined when running from a checkout.
   */
  release?: { tag: string; log: (line: string) => void };
}

/**
 * Finds the engine for the project's EF Core version, in order:
 * --engine, EFCPT_CLI_ENGINE, an engine built in this repository checkout, the download cache, the
 * efcpt-cli-engine dotnet tool on PATH, then a download from this copy's release.
 */
export async function locateEngine(options: LocateOptions): Promise<Engine> {
  if (options.enginePath) return engineFromPath(options.enginePath, `--engine ${options.enginePath}`);

  // EFCPT_UI_ENGINE is the variable's name from before the rename to efcpt-cli
  const envName = options.env[engineEnvVar]
    ? engineEnvVar
    : options.env['EFCPT_UI_ENGINE']
      ? 'EFCPT_UI_ENGINE'
      : undefined;
  const fromEnv = envName && options.env[envName];
  if (envName && fromEnv) return engineFromPath(fromEnv, `${envName}=${fromEnv}`);

  // EFCPT_CLI_SKIP_CHECKOUT_ENGINE=1 ignores engines built in the checkout (tests)
  const repoRoot =
    options.repoRoot ?? (options.env['EFCPT_CLI_SKIP_CHECKOUT_ENGINE'] === '1' ? false : checkoutRoot);
  const built = repoRoot ? await findCheckoutEngine(repoRoot, options.efVersion) : undefined;
  if (built) return engineFromPath(built, `built in this checkout ${built}`);

  const cacheRoot = options.cacheRoot ?? defaultCacheRoot(options.env);
  if (options.release) {
    const cached = cachedEnginePath(cacheRoot, options.release.tag, options.efVersion);
    if (await exists(cached)) return engineFromPath(cached, `downloaded ${cached}`);
  }

  const tool: Engine = {
    command: engineToolCommand,
    prefixArgs: [],
    description: `${engineToolCommand} on PATH`,
  };
  let toolMismatch = '';
  if (options.searchPath !== false) {
    const toolVersion = await probeEngineVersion(tool);
    if (toolVersion === options.efVersion) return tool;
    if (toolVersion !== undefined) {
      toolMismatch = `\nThe ${engineToolCommand} tool on PATH is for EF Core ${toolVersion}, but this project uses EF Core ${options.efVersion}.`;
    }
  }

  if (options.release) {
    const downloaded = await downloadEngine({
      efVersion: options.efVersion,
      tag: options.release.tag,
      cacheRoot,
      env: options.env,
      log: options.release.log,
    });
    return engineFromPath(downloaded, `downloaded ${downloaded}`);
  }

  const project = `src/Core/efcpt.${options.efVersion}/efcpt.${options.efVersion}.csproj`;
  // Running from a checkout: the build is all that's missing
  if (repoRoot && (await exists(path.join(repoRoot, project)))) {
    throw new EngineNotFoundError(
      `No engine found for EF Core ${options.efVersion}.${toolMismatch}\n` +
        `Build it once in this checkout and efcpt-cli will find it:\n` +
        `  dotnet build "${path.join(repoRoot, project)}" -c Release`,
    );
  }
  throw new EngineNotFoundError(
    `No engine found for EF Core ${options.efVersion}.${toolMismatch}\n` +
      `Install efcpt-cli from a release (see the README), which downloads engines as needed, or build the ` +
      `engine from this repository and point efcpt-cli at it:\n` +
      `  dotnet build ${project} -c Release\n` +
      `  efcpt --engine <path to efcpt.${options.efVersion}.dll> ...   (or set ${engineEnvVar})`,
  );
}
