// Request and response shapes of the local UI server. Imported by the web app (type-only), so keep this file
// free of Node imports.
import type { EfcptConfig } from '../config/efcpt-config.generated.js';
import type { EngineObject, GenerateDocument } from '../engine/contract.js';

export type { EfcptConfig, EngineObject, GenerateDocument };

/** Header every API call must send; browsers can't add it to cross-site form posts. */
export const apiHeader = 'x-efcpt-ui';

export interface ProjectSummary {
  path: string;
  name: string;
  rootNamespace: string;
  efVersion: number;
  efVersionSource: string;
}

export interface SessionInfo {
  /** Undefined until a config is chosen (several or no configs found). */
  configPath?: string;
  configExists: boolean;
  /** Config files found in the project, relative to the project folder. */
  configs: string[];
  /** Visual Studio extension configs (efpt.*config.json) not imported yet, relative to the project folder. */
  vsConfigs: string[];
  project?: ProjectSummary;
  /** Where the connection comes from. Never contains the connection string itself. */
  connection?: { source: string; isDacpac: boolean };
  provider?: string;
  warnings: string[];
}

export interface ConfigResponse {
  config: EfcptConfig;
  exists: boolean;
}

export interface ObjectsResponse {
  objects: EngineObject[];
  databaseType?: string;
  warnings: string[];
}

export interface ApiError {
  error: string;
  details?: string[];
}

/** POST /api/connection */
export interface ConnectionRequest {
  connection: string;
  provider?: string;
}

/** POST /api/session: switch to another config (created from a template when it doesn't exist). */
export interface SelectConfigRequest {
  configPath: string;
}

/** POST /api/import-vs: create an efcpt config from a Visual Studio extension config and switch to it. */
export interface ImportVsRequest {
  vsConfigPath: string;
}

/** One line of the POST /api/generate response (newline-delimited JSON). */
export type GenerateEvent =
  | { type: 'log'; line: string }
  | { type: 'result'; result: GenerateDocument; config?: EfcptConfig }
  | { type: 'error'; error: string; details?: string };
