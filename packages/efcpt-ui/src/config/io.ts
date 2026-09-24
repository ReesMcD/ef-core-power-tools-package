import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvDraft04Import from 'ajv-draft-04';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { EfcptConfig } from './efcpt-config.generated.js';

export type { EfcptConfig };

/** How the file was formatted, so it can be written back with a minimal diff. */
export interface ConfigFormat {
  bom: boolean;
  indent: string;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
}

export interface LoadedConfig {
  path: string;
  config: EfcptConfig;
  format: ConfigFormat;
}

/** Formatting used by efcpt when it writes the file (System.Text.Json, indented). */
export const defaultFormat: ConfigFormat = { bom: false, indent: '  ', eol: '\n', finalNewline: true };

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function detectFormat(text: string): ConfigFormat {
  const bom = text.startsWith('\uFEFF');
  const indent = /^[{[]\r?\n([ \t]+)\S/.exec(text.replace(/^\uFEFF/, ''))?.[1] ?? defaultFormat.indent;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = /\r?\n$/.test(text);
  return { bom, indent, eol, finalNewline };
}

export function parseConfig(text: string, configPath = '<config>'): EfcptConfig {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new ConfigError(`${configPath} is not valid JSON: ${(error as Error).message}`, configPath);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${configPath} must contain a JSON object`, configPath);
  }
  return value as EfcptConfig;
}

/** Reads an efcpt-config.json. Config files written by efcpt start with a UTF-8 BOM, which is handled here. */
export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read ${configPath}: ${(error as Error).message}`, configPath);
  }
  return { path: configPath, config: parseConfig(text, configPath), format: detectFormat(text) };
}

/** Serializes keeping the original key order, indentation, line endings and BOM. */
export function serializeConfig(config: EfcptConfig, format: ConfigFormat = defaultFormat): string {
  let text = JSON.stringify(config, null, format.indent);
  if (format.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (format.finalNewline) text += format.eol;
  return (format.bom ? '\uFEFF' : '') + text;
}

export async function saveConfig(
  configPath: string,
  config: EfcptConfig,
  format?: ConfigFormat,
): Promise<void> {
  await writeFile(configPath, serializeConfig(config, format), 'utf8');
}

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../schema/efcpt-config.schema.json',
);
let validator: ValidateFunction | undefined;

type AjvConstructor = new (options: object) => { compile(schema: object): ValidateFunction };

function getValidator(): ValidateFunction {
  if (!validator) {
    // ajv-draft-04 is CommonJS; depending on the loader the class is the module or its default export
    const imported = AjvDraft04Import as unknown as AjvConstructor & { default?: AjvConstructor };
    const Ajv = imported.default ?? imported;
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8').replace(/^\uFEFF/, '')) as object;
    validator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  }
  return validator;
}

function describe(error: ErrorObject): string {
  const where = error.instancePath || '(root)';
  return `${where}: ${error.message ?? error.keyword}`;
}

/**
 * Validates against efcpt-config.schema.json. Returns problems as readable strings (empty when valid).
 * The schema marks many code-generation options as required, but efcpt fills in defaults for all of
 * them, so missing properties are not reported; wrong types and values are.
 */
export function validateConfig(config: EfcptConfig): string[] {
  const validate = getValidator();
  if (validate(config)) return [];
  return (validate.errors ?? []).filter((e) => e.keyword !== 'required').map(describe);
}
