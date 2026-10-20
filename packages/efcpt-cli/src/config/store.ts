// Loads and saves either kind of config: efcpt-config.json, or the Visual Studio extension's efpt.config.json used
// in place (see vs-config.ts).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  defaultFormat,
  loadConfig,
  saveConfig,
  serializeConfig,
  type ConfigFormat,
  type EfcptConfig,
  type LoadedConfig,
} from './io.js';
import { isVsConfigPath, readVsConfig, writeVsConfig } from './vs-config.js';

export interface StoredConfig extends LoadedConfig {
  /** 'vs' for an efpt.config.json used in place. */
  kind: 'efcpt' | 'vs';
  warnings: string[];
}

export async function loadAnyConfig(configPath: string, projectEfVersion?: number): Promise<StoredConfig> {
  if (isVsConfigPath(configPath)) {
    const vs = await readVsConfig(configPath, projectEfVersion);
    return { path: configPath, config: vs.config, format: defaultFormat, kind: 'vs', warnings: vs.warnings };
  }
  return { ...(await loadConfig(configPath)), kind: 'efcpt', warnings: [] };
}

/** Saves a config. Returns what couldn't be saved (an efpt.config.json has no place for some options). */
export async function saveAnyConfig(
  configPath: string,
  config: EfcptConfig,
  format?: ConfigFormat,
): Promise<string[]> {
  if (isVsConfigPath(configPath)) return writeVsConfig(configPath, config);
  await saveConfig(configPath, config, format);
  return [];
}

/**
 * The config file to give the engine. The engine reads efcpt-config.json, so an efpt.config.json gets a temporary
 * one with the same contents; the engine never sees or rewrites the real file.
 */
export async function engineConfigFile(
  configPath: string,
  config: EfcptConfig | undefined,
): Promise<{ path: string; dispose: () => Promise<void> }> {
  if (!isVsConfigPath(configPath) || !config) return { path: configPath, dispose: async () => {} };
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-config-'));
  const file = path.join(dir, 'efcpt-config.json');
  const engineConfig = { ...config } as Record<string, unknown>;
  delete engineConfig['efcpt-cli'];
  await writeFile(file, serializeConfig(engineConfig as EfcptConfig), 'utf8');
  return { path: file, dispose: () => rm(dir, { recursive: true, force: true }) };
}
