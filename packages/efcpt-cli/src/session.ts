import { access } from 'node:fs/promises';
import path from 'node:path';
import type { CliArgs } from './args.js';
import { UsageError } from './args.js';
import { findConfigFiles } from './config/discovery.js';
import { validateConfig } from './config/io.js';
import { loadAnyConfig, type StoredConfig } from './config/store.js';
import { adoptImportedSettings, isVsConfigPath, vsSettingsFileName } from './config/vs-config.js';
import { efcptPathFor, findVsConfigFiles } from './config/vs-import.js';
import { ConnectionError, getUiSection, resolveConnection, type ResolvedConnection } from './connection.js';
import { findProjectFile, readProject, type ProjectInfo } from './project.js';

/** Everything resolved from the arguments before the engine runs. */
export interface Session {
  configPath: string;
  /** Undefined when the config file doesn't exist yet; efcpt creates it on the first generate. */
  config?: StoredConfig;
  project: ProjectInfo;
  connection?: ResolvedConnection;
  provider?: string;
  warnings: string[];
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function resolveConfigPath(args: CliArgs, cwd: string): Promise<string> {
  if (args.config) return path.resolve(cwd, args.config);

  const searchRoot = args.project ? path.dirname(path.resolve(cwd, args.project)) : cwd;
  const found = await findConfigFiles(searchRoot);
  if (found.length === 1) return found[0]!;
  // None yet: efcpt-config.json next to the project, which the engine creates on the first --generate
  if (found.length === 0) return path.join(searchRoot, 'efcpt-config.json');
  throw new UsageError(
    `Found several efcpt configs, choose one with --config:\n${found.map((f) => `  ${path.relative(cwd, f)}`).join('\n')}`,
  );
}

/**
 * A config imported with --import-vs and its Visual Studio original are two copies that drift apart as soon as
 * someone edits one. efcpt uses the original directly, so the copy isn't needed.
 */
async function twinWarnings(configPath: string, cwd: string, readOnly: boolean): Promise<string[]> {
  const show = (p: string) => path.relative(cwd, p);
  if (isVsConfigPath(configPath)) {
    const copy = efcptPathFor(configPath);
    if (!(await exists(copy))) return [];
    const intro =
      `${show(copy)} is an old --import-vs copy of ${show(configPath)}. efcpt now uses ` +
      `${path.basename(configPath)} directly, so everyone shares one file.`;
    // Keep its efcpt-cli settings (such as the connection), so deleting it loses nothing
    if (readOnly) {
      return [
        `${intro} Run efcpt or --generate once to move its settings into efcpt-cli.json, then delete it.`,
      ];
    }
    const copied = await adoptImportedSettings(configPath);
    return [
      `${intro}${copied ? ` Its settings (such as the connection) were copied into ${vsSettingsFileName}.` : ''} ` +
        `Delete ${path.basename(copy)}.`,
    ];
  }
  for (const vs of await findVsConfigFiles(path.dirname(configPath))) {
    if (efcptPathFor(vs) !== configPath) continue;
    return [
      `${show(configPath)} is a copy of the Visual Studio config ${show(vs)}, and the two drift apart. ` +
        `Use --config ${show(vs)} instead (efcpt reads and saves it directly) and delete ${path.basename(configPath)}.`,
    ];
  }
  return [];
}

export interface ResolveOptions {
  /** Report connection problems as warnings instead of failing (the UI lets the user enter one). */
  tolerateConnectionErrors?: boolean;
}

export async function resolveSession(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
  options: ResolveOptions = {},
): Promise<Session> {
  const configPath = await resolveConfigPath(args, cwd);
  const projectPath = args.project ? path.resolve(cwd, args.project) : await findProjectFile(configPath);
  const project = await readProject(projectPath);
  const config = (await exists(configPath)) ? await loadAnyConfig(configPath, project.efVersion) : undefined;

  const warnings = [...project.warnings, ...(config?.warnings ?? [])];
  warnings.push(...(await twinWarnings(configPath, cwd, args.list)));
  if (config) {
    // efcpt accepts files the schema calls incomplete, so these are only warnings
    warnings.push(
      ...validateConfig(config.config).map((problem) => `${path.basename(configPath)} ${problem}`),
    );
  }

  let connection: ResolvedConnection | undefined;
  try {
    connection = await resolveConnection({
      connection: args.connection,
      connectionEnv: args.connectionEnv,
      env,
      config: config?.config ?? {},
      projectDir: project.projectDir,
      userSecretsId: project.userSecretsId,
    });
  } catch (error) {
    if (!(options.tolerateConnectionErrors && error instanceof ConnectionError)) throw error;
    warnings.push(error.message);
  }

  // A connection string alone can be ambiguous (Postgres and Firebird look alike), the project's provider package is not
  const provider =
    args.provider ??
    getUiSection(config?.config ?? {}).provider ??
    (connection?.isDacpac ? 'mssql' : project.provider);

  return { configPath, config, project, connection, provider, warnings };
}
