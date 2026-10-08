import { access, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { EfcptConfig } from './config/io.js';
import { isWsl } from './platform.js';
import { readProject } from './project.js';

/** Optional `efcpt-ui` section in efcpt-config.json. efcpt keeps unknown top-level sections when it rewrites the file. */
export interface UiConfigSection {
  provider?: string;
  connection?: ConnectionReference;
  /** Renaming file, relative to the config. Default: efpt.renaming.json next to the config. */
  renaming?: string;
}

/** Where to read the connection from. Never a plain connection string, so secrets stay out of the config file. */
export type ConnectionReference =
  | { env: string }
  | {
      'user-secrets': string;
      /** Another project whose user secrets hold it (relative to this project), for example the startup project. */
      project?: string;
      /** The UserSecretsId to read, when it isn't this project's. */
      id?: string;
    }
  | { appsettings: string; key: string }
  | { dacpac: string };

export interface ResolvedConnection {
  /** Connection string, or the full path of a .dacpac file. */
  value: string;
  /** Human readable origin, safe to display (never contains the secret). */
  source: string;
  isDacpac: boolean;
}

export interface ConnectionOptions {
  connection?: string;
  connectionEnv?: string;
  env: NodeJS.ProcessEnv;
  config: EfcptConfig;
  /** Relative paths in the efcpt-ui section are resolved from the project folder. */
  projectDir: string;
  userSecretsId?: string;
  /** Overrides where user secrets are read from, for tests. */
  userSecretsRoot?: string;
  /** In WSL, the Windows users folder whose user secrets are also searched. False to skip; for tests. */
  windowsUsersRoot?: string | false;
}

export const connectionEnvVar = 'EFCPT_CONNECTION';

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export function getUiSection(config: EfcptConfig): UiConfigSection {
  const section = config['efcpt-ui'];
  return typeof section === 'object' && section !== null ? (section as UiConfigSection) : {};
}

function result(value: string, source: string): ResolvedConnection {
  return { value, source, isDacpac: value.trim().toLowerCase().endsWith('.dacpac') };
}

/** Removes // and /* *\/ comments outside strings. appsettings files may contain them. */
export function stripJsonComments(text: string): string {
  let output = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      output += char;
      if (char === '\\') output += text[++i] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      output += char;
    }
  }
  return output;
}

/** Looks up a .NET configuration key ("ConnectionStrings:Sales") in flat or nested JSON. */
export function lookupKey(data: unknown, key: string): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  const flat = Object.entries(record).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  if (typeof flat === 'string') return flat;

  const [head, ...rest] = key.split(':');
  if (rest.length === 0) return undefined;
  const child = Object.entries(record).find(([k]) => k.toLowerCase() === head!.toLowerCase())?.[1];
  return lookupKey(child, rest.join(':'));
}

async function readJsonFile(file: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ConnectionError(`Cannot read ${what} file ${file}`);
  }
  try {
    return JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, '')));
  } catch (error) {
    throw new ConnectionError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

export function userSecretsFile(id: string, env: NodeJS.ProcessEnv, root?: string): string {
  if (root) return path.join(root, id, 'secrets.json');
  if (process.platform === 'win32') {
    return path.join(
      env['APPDATA'] ?? path.join(homedir(), 'AppData', 'Roaming'),
      'Microsoft',
      'UserSecrets',
      id,
      'secrets.json',
    );
  }
  // Like dotnet: %APPDATA% on Windows, $HOME elsewhere
  return path.join(env['HOME'] || homedir(), '.microsoft', 'usersecrets', id, 'secrets.json');
}

/**
 * User secrets set with `dotnet user-secrets` on Windows live under %APPDATA%, which a WSL process doesn't
 * see as its home. Finds this project's secrets there (the UserSecretsId is a GUID, so a match is the project's).
 */
export async function windowsUserSecretsFiles(id: string, usersRoot = '/mnt/c/Users'): Promise<string[]> {
  const found: string[] = [];
  for (const user of await readdir(usersRoot).catch(() => [] as string[])) {
    const file = path.join(
      usersRoot,
      user,
      'AppData',
      'Roaming',
      'Microsoft',
      'UserSecrets',
      id,
      'secrets.json',
    );
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      found.push(file);
  }
  return found;
}

/** Reads a project's user secrets, from the Linux/macOS or Windows location, or from Windows' side in WSL. */
async function readUserSecrets(
  id: string,
  options: ConnectionOptions,
): Promise<{ file: string; data: unknown }> {
  let file = userSecretsFile(id, options.env, options.userSecretsRoot);
  const windowsUsersRoot = options.windowsUsersRoot ?? (isWsl() ? '/mnt/c/Users' : false);
  if (windowsUsersRoot && !(await exists(file))) {
    file = (await windowsUserSecretsFiles(id, windowsUsersRoot))[0] ?? file;
  }
  return { file, data: await readJsonFile(file, 'user secrets') };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** The ConnectionStrings:* keys in user secrets, whether written flat (dotnet user-secrets) or nested. */
export function connectionStringKeys(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (/^ConnectionStrings:./i.test(key) && typeof value === 'string' && value.trim()) keys.push(key);
    if (key.toLowerCase() === 'connectionstrings' && typeof value === 'object' && value !== null) {
      for (const [name, nested] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nested === 'string' && nested.trim()) keys.push(`ConnectionStrings:${name}`);
      }
    }
  }
  return [...new Set(keys)];
}

/**
 * The connection strings in this project's user secrets, which is where the app itself reads them from in
 * development. Missing or unreadable secrets give an empty list.
 */
export async function userSecretConnectionKeys(options: ConnectionOptions): Promise<string[]> {
  if (!options.userSecretsId) return [];
  try {
    return connectionStringKeys((await readUserSecrets(options.userSecretsId, options)).data);
  } catch {
    return [];
  }
}

export class SeveralConnectionsError extends ConnectionError {
  constructor(readonly keys: string[]) {
    super(
      `The project's user secrets have several connection strings (${keys.join(', ')}). Choose one in ` +
        `efcpt-config.json:\n  "efcpt-ui": { "connection": { "user-secrets": "${keys[0]}" } }`,
    );
  }
}

async function fromReference(
  reference: ConnectionReference,
  options: ConnectionOptions,
): Promise<ResolvedConnection> {
  if ('env' in reference) {
    const value = options.env[reference.env];
    if (!value)
      throw new ConnectionError(
        `Environment variable ${reference.env} (from efcpt-ui.connection.env) is not set`,
      );
    return result(value, `environment variable ${reference.env}`);
  }

  if ('user-secrets' in reference) {
    const key = reference['user-secrets'];
    let id = reference.id ?? options.userSecretsId;
    if (!reference.id && reference.project) {
      const other = path.resolve(options.projectDir, reference.project);
      const project = await readProject(other).catch((error: Error) => {
        throw new ConnectionError(`efcpt-ui.connection.project: ${error.message}`);
      });
      id = project.userSecretsId;
      if (!id) throw new ConnectionError(`${reference.project} has no UserSecretsId`);
    }
    if (!id) {
      throw new ConnectionError(
        `efcpt-ui.connection uses user-secrets, but the project has no UserSecretsId. If another project ` +
          `(for example the startup project) has the secrets, add "project": "../Other/Other.csproj"; ` +
          `or run: dotnet user-secrets init`,
      );
    }
    const { data } = await readUserSecrets(id, options);
    const value = lookupKey(data, key);
    if (!value)
      throw new ConnectionError(`User secret '${key}' not found (dotnet user-secrets set "${key}" "...")`);
    return result(value, `user secret ${key}`);
  }

  if ('appsettings' in reference) {
    const file = path.resolve(options.projectDir, reference.appsettings);
    const value = lookupKey(await readJsonFile(file, 'appsettings'), reference.key);
    if (!value) throw new ConnectionError(`'${reference.key}' not found in ${file}`);
    return result(value, `${path.basename(file)} ${reference.key}`);
  }

  if ('dacpac' in reference) {
    const file = path.resolve(options.projectDir, reference.dacpac);
    return { value: file, source: `dacpac ${file}`, isDacpac: true };
  }

  throw new ConnectionError(
    'efcpt-ui.connection must have one of: env, user-secrets, appsettings (with key) or dacpac',
  );
}

/**
 * Resolves the connection in order: --connection, --connection-env, EFCPT_CONNECTION,
 * then the efcpt-ui.connection section of the config. Returns undefined when nothing is configured.
 */
export async function resolveConnection(options: ConnectionOptions): Promise<ResolvedConnection | undefined> {
  if (options.connection) return result(options.connection, '--connection');

  if (options.connectionEnv) {
    const value = options.env[options.connectionEnv];
    if (!value)
      throw new ConnectionError(
        `Environment variable ${options.connectionEnv} (from --connection-env) is not set`,
      );
    return result(value, `environment variable ${options.connectionEnv}`);
  }

  const fromEnv = options.env[connectionEnvVar];
  if (fromEnv) return result(fromEnv, `environment variable ${connectionEnvVar}`);

  const reference = getUiSection(options.config).connection;
  if (reference) return fromReference(reference, options);

  // Nothing configured: use the connection string the app itself reads in development, if it's unambiguous
  const keys = await userSecretConnectionKeys(options);
  if (keys.length === 1) {
    const resolved = await fromReference({ 'user-secrets': keys[0]! }, options);
    return { ...resolved, source: `${resolved.source} (found in the project's user secrets)` };
  }
  if (keys.length > 1) throw new SeveralConnectionsError(keys);
  return undefined;
}
