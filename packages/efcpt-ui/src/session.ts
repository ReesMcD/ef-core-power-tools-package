import { access } from 'node:fs/promises';
import path from 'node:path';
import type { CliArgs } from './args.js';
import { UsageError } from './args.js';
import { findConfigFiles } from './config/discovery.js';
import { loadConfig, validateConfig, type LoadedConfig } from './config/io.js';
import { findVsConfigFiles } from './config/vs-import.js';
import { ConnectionError, getUiSection, resolveConnection, type ResolvedConnection } from './connection.js';
import { findProjectFile, readProject, type ProjectInfo } from './project.js';

/** Everything resolved from the arguments before the engine runs. */
export interface Session {
  configPath: string;
  /** Undefined when the config file doesn't exist yet; efcpt creates it on the first generate. */
  config?: LoadedConfig;
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
  const config = (await exists(configPath)) ? await loadConfig(configPath) : undefined;

  const projectPath = args.project ? path.resolve(cwd, args.project) : await findProjectFile(configPath);
  const project = await readProject(projectPath);

  const warnings = [...project.warnings];
  if (!config) {
    const vsConfigs = await findVsConfigFiles(project.projectDir);
    if (vsConfigs.length > 0) {
      warnings.push(
        `No efcpt config yet, but found the Visual Studio extension's ${vsConfigs.map((f) => path.relative(cwd, f)).join(', ')}. ` +
          `Convert it with: efcpt-ui --import-vs ${path.relative(cwd, vsConfigs[0]!)}`,
      );
    }
  }
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
