import path from 'node:path';
import type { EfcptConfig } from './io.js';
import type { UiConfigSection } from '../connection.js';

export const schemaUrl =
  'https://raw.githubusercontent.com/ErikEJ/EFCorePowerTools/master/samples/efcpt-config.schema.json';

/** Reads one key of an ADO.NET style connection string ("Key=Value;..."), case-insensitively. */
function connectionValue(connection: string, keys: string[]): string | undefined {
  for (const part of connection.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    if (keys.includes(key))
      return (
        part
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, '') || undefined
      );
  }
  return undefined;
}

/** "sales-db v2" -> "SalesDbV2". Returns undefined when nothing usable is left. */
export function toIdentifier(text: string): string | undefined {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  if (!name) return undefined;
  return /^[0-9]/.test(name) ? `Db${name}` : name;
}

/**
 * Suggests a DbContext name. The engine derives it from the connection string too, but uses the whole
 * `Data Source` value, which for file databases gives names like "tmpdatashopdbContext".
 */
export function suggestDbContextName(connection: string | undefined, projectName: string): string {
  let database: string | undefined;
  if (connection) {
    if (connection.trim().toLowerCase().endsWith('.dacpac')) {
      database = path.basename(connection.trim(), path.extname(connection.trim()));
    } else {
      database =
        connectionValue(connection, ['initial catalog', 'database']) ??
        (() => {
          const source = connectionValue(connection, ['data source', 'datasource', 'filename']);
          // file databases (SQLite, Firebird): use the file name only
          return source && /[\\/.]/.test(source) ? path.basename(source, path.extname(source)) : source;
        })();
    }
  }
  const base = toIdentifier(database ?? '') ?? toIdentifier(projectName.split('.').at(-1) ?? '') ?? 'App';
  return base.endsWith('Context') ? base : `${base}Context`;
}

export interface NewConfigOptions {
  rootNamespace: string;
  projectName: string;
  connection?: string;
  ui?: UiConfigSection;
}

/**
 * A new efcpt-config.json. Only what differs from the engine's defaults is written; the engine fills in
 * the object lists and the remaining options on the first generate (refresh-object-lists is on by default).
 */
export function createConfigTemplate(options: NewConfigOptions): EfcptConfig {
  const config: EfcptConfig = { $schema: schemaUrl };
  if (options.ui && Object.keys(options.ui).length > 0) config['efcpt-ui'] = options.ui;
  config.names = {
    'dbcontext-name': suggestDbContextName(options.connection, options.projectName),
    'root-namespace': options.rootNamespace,
  } as EfcptConfig['names'];
  // Same default the engine uses for a new config (CliConfigMapper.TryGetCliConfig)
  config['type-mappings'] = { 'use-DateOnly-TimeOnly': true } as EfcptConfig['type-mappings'];
  return config;
}
