// JSON written by `efcpt-ui-engine ... --json` (schemaVersion 1).
// Source of truth: src/GUI/RevEng.Shared/Cli/CliJsonOutput.cs, documented in planning/ENGINE_INTERFACE.md.

export const supportedSchemaVersion = 1;

export type ObjectType = 'table' | 'view' | 'storedProcedure' | 'function';

export interface EngineColumn {
  name: string;
  storeType?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface EngineObject {
  /** The name used for this object's entry in efcpt-config.json. */
  displayName: string;
  schema?: string;
  name: string;
  type: ObjectType;
  columns?: EngineColumn[];
}

interface EngineDocumentBase {
  schemaVersion: number;
  success: boolean;
  errors: string[];
  warnings: string[];
}

export interface ListObjectsDocument extends EngineDocumentBase {
  command: 'list-objects';
  efCoreVersion?: number;
  databaseType?: string;
  objects?: EngineObject[];
}

export interface GenerateDocument extends EngineDocumentBase {
  command: 'generate';
  efCoreVersion?: number;
  databaseType?: string;
  configPath?: string;
  contextFilePath?: string;
  contextConfigurationFilePaths?: string[];
  entityTypeFilePaths?: string[];
  outputFolders?: string[];
  readmePath?: string;
  diagramPath?: string;
}

export type EngineDocument = ListObjectsDocument | GenerateDocument;
