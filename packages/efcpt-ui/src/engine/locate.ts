import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { EfVersion } from '../project.js';
import { runProcess } from './process.js';

export interface Engine {
  /** Program to start, for example "dotnet" or a tool executable. */
  command: string;
  /** Arguments placed before the engine arguments, for example the path of efcpt.10.dll. */
  prefixArgs: string[];
  /** Where the engine was found, for display. */
  description: string;
}

export const engineEnvVar = 'EFCPT_UI_ENGINE';
export const engineToolCommand = 'efcpt-ui-engine';

export class EngineNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineNotFoundError';
  }
}

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
  if (env['EFCPT_UI_CACHE']) return env['EFCPT_UI_CACHE'];
  if (process.platform === 'win32') {
    return path.join(env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local'), 'efcpt-ui', 'Cache');
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Caches', 'efcpt-ui');
  return path.join(env['XDG_CACHE_HOME'] ?? path.join(homedir(), '.cache'), 'efcpt-ui');
}

/** Where a downloaded engine for this EF Core version lives (downloads are added with the release pipeline, task R5). */
export function cachedEnginePath(cacheRoot: string, efVersion: EfVersion): string {
  return path.join(cacheRoot, 'engines', `ef${efVersion}`, `efcpt.${efVersion}.dll`);
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

export interface LocateOptions {
  efVersion: EfVersion;
  enginePath?: string;
  env: NodeJS.ProcessEnv;
  cacheRoot?: string;
  /** Check the dotnet tool on PATH; disabled in tests. */
  searchPath?: boolean;
}

/**
 * Finds the engine for the project's EF Core version, in order:
 * --engine, EFCPT_UI_ENGINE, the download cache, then the efcpt-ui-engine dotnet tool on PATH.
 */
export async function locateEngine(options: LocateOptions): Promise<Engine> {
  if (options.enginePath) return engineFromPath(options.enginePath, `--engine ${options.enginePath}`);

  const fromEnv = options.env[engineEnvVar];
  if (fromEnv) return engineFromPath(fromEnv, `${engineEnvVar}=${fromEnv}`);

  const cached = cachedEnginePath(options.cacheRoot ?? defaultCacheRoot(options.env), options.efVersion);
  if (await exists(cached)) return engineFromPath(cached, `cache ${cached}`);

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

  throw new EngineNotFoundError(
    `No engine found for EF Core ${options.efVersion}.${toolMismatch}\n` +
      `Engine downloads are not available yet. Build the engine from this repository and point efcpt-ui at it:\n` +
      `  dotnet build src/Core/efcpt.${options.efVersion}/efcpt.${options.efVersion}.csproj -c Release\n` +
      `  efcpt-ui --engine <path to efcpt.${options.efVersion}.dll> ...   (or set ${engineEnvVar})`,
  );
}
