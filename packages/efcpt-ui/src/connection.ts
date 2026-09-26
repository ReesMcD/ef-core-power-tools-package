import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { EfcptConfig } from './config/io.js';

/** Optional `efcpt-ui` section in efcpt-config.json. efcpt keeps unknown top-level sections when it rewrites the file. */
export interface UiConfigSection {
  provider?: string;
  connection?: ConnectionReference;
  /** Renaming file, relative to the config. Default: efpt.renaming.json next to the config. */
  renaming?: string;
}

/** Where to read the connection from. Never a plain connection string, so secrets stay out of the config file. */
export type ConnectionReference =
  { env: string } | { 'user-secrets': string } | { appsettings: string; key: string } | { dacpac: string };

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
  return path.join(homedir(), '.microsoft', 'usersecrets', id, 'secrets.json');
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
    if (!options.userSecretsId) {
      throw new ConnectionError(
        `efcpt-ui.connection uses user-secrets, but the project has no UserSecretsId (run: dotnet user-secrets init)`,
      );
    }
    const file = userSecretsFile(options.userSecretsId, options.env, options.userSecretsRoot);
    const value = lookupKey(await readJsonFile(file, 'user secrets'), key);
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
  return reference ? fromReference(reference, options) : undefined;
}
