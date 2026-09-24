import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CliArgs } from '../args.js';
import { generateRequest, generateTimeoutMs } from '../commands/generate.js';
import { prepareEngine, type Output } from '../commands/common.js';
import { findConfigFiles } from '../config/discovery.js';
import {
  ConfigError,
  defaultFormat,
  loadConfig,
  saveConfig,
  validateConfig,
  type EfcptConfig,
} from '../config/io.js';
import { createConfigTemplate } from '../config/template.js';
import { getUiSection } from '../connection.js';
import type { Engine } from '../engine/locate.js';
import { generate, listObjects } from '../engine/run.js';
import { findProjectFile, readProject } from '../project.js';
import { redact } from '../redact.js';
import { resolveSession, type Session } from '../session.js';
import type {
  ConfigResponse,
  ConnectionRequest,
  GenerateDocument,
  ObjectsResponse,
  SessionInfo,
} from './api.js';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

export interface ControllerOptions {
  args: CliArgs;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Terminal output (engine details, warnings). */
  io: Output;
  listTimeoutMs?: number;
}

/** Everything the UI can do, independent of HTTP. One instance per `efcpt-ui` run. */
export class UiController {
  private session?: Session;
  private rootDir: string;
  private objects?: ObjectsResponse;
  private connectionOverride?: ConnectionRequest;
  private engines = new Map<number, Engine>();
  private busy = false;

  constructor(private readonly options: ControllerOptions) {
    this.rootDir = options.cwd;
  }

  /** Resolves the starting config: the one given, or the only one found. Several or none: the UI asks. */
  async init(): Promise<void> {
    const { args, cwd } = this.options;
    if (args.project) {
      this.rootDir = path.dirname(path.resolve(cwd, args.project));
    } else {
      // The project folder is the natural place to look for configs
      this.rootDir = await findProjectFile(path.join(cwd, 'efcpt-config.json')).then(
        (p) => path.dirname(p),
        () => cwd,
      );
    }

    if (args.config) {
      await this.load(path.resolve(cwd, args.config));
      return;
    }
    const configs = await findConfigFiles(this.rootDir);
    if (configs.length === 1) await this.load(configs[0]!);
  }

  private async load(configPath: string): Promise<void> {
    this.session = await resolveSession(
      { ...this.options.args, config: configPath },
      this.options.env,
      this.options.cwd,
      {
        tolerateConnectionErrors: true,
      },
    );
    this.objects = undefined;
    this.applyConnectionOverride();
  }

  private applyConnectionOverride(): void {
    if (!this.session || !this.connectionOverride) return;
    const value = this.connectionOverride.connection;
    this.session.connection = {
      value,
      source: 'entered in the UI',
      isDacpac: value.trim().toLowerCase().endsWith('.dacpac'),
    };
    if (this.connectionOverride.provider) this.session.provider = this.connectionOverride.provider;
  }

  private requireSession(): Session {
    if (!this.session) throw new RequestError('Choose or create a config first', 409);
    return this.session;
  }

  /** Values that must never reach the browser or the logs. */
  secrets(): string[] {
    return [this.session?.connection?.value, this.connectionOverride?.connection].filter((s): s is string =>
      Boolean(s),
    );
  }

  async info(): Promise<SessionInfo> {
    const session = this.session;
    const configs = (await findConfigFiles(this.rootDir)).map((f) => path.relative(this.rootDir, f));
    if (session) {
      const relative = path.relative(this.rootDir, session.configPath);
      if (!configs.includes(relative) && !relative.startsWith('..')) configs.push(relative);
    }
    return {
      configPath: session?.configPath,
      configExists: Boolean(session?.config),
      configs: configs.sort(),
      project: session && {
        path: session.project.projectPath,
        name: path.basename(session.project.projectPath, path.extname(session.project.projectPath)),
        rootNamespace: session.project.rootNamespace,
        efVersion: session.project.efVersion,
        efVersionSource: session.project.efVersionSource,
      },
      connection: session?.connection && {
        source: session.connection.source,
        isDacpac: session.connection.isDacpac,
      },
      provider: session?.provider,
      warnings: (session?.warnings ?? []).map((w) => redact(w, this.secrets())),
    };
  }

  /** Switches to another config. A path that doesn't exist yet gets a new config from the template. */
  async selectConfig(configPath: string): Promise<void> {
    if (!configPath || !configPath.toLowerCase().endsWith('.json')) {
      throw new RequestError('The config file name must end with .json');
    }
    const full = path.resolve(this.rootDir, configPath);
    if (!(await exists(full))) await this.createConfig(full);
    this.connectionOverride = undefined;
    await this.load(full);
  }

  private async createConfig(configPath: string): Promise<void> {
    const project = await readProject(
      this.options.args.project
        ? path.resolve(this.options.cwd, this.options.args.project)
        : await findProjectFile(configPath),
    );
    const current = this.session?.config?.config;
    const config = createConfigTemplate({
      rootNamespace: project.rootNamespace,
      projectName: path.basename(project.projectPath, path.extname(project.projectPath)),
      connection: this.session?.connection?.value,
      // A new config for the same project most likely reads its connection the same way
      ui: current ? getUiSection(current) : undefined,
    });
    await mkdir(path.dirname(configPath), { recursive: true });
    await saveConfig(configPath, config, defaultFormat);
  }

  async getConfig(): Promise<ConfigResponse> {
    const session = this.requireSession();
    return { config: session.config?.config ?? {}, exists: Boolean(session.config) };
  }

  async saveConfig(config: unknown): Promise<void> {
    const session = this.requireSession();
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new RequestError('config must be a JSON object');
    }
    const problems = validateConfig(config as EfcptConfig);
    if (problems.length > 0) throw new RequestError('The config has invalid values', 400, problems);

    await saveConfig(session.configPath, config as EfcptConfig, session.config?.format ?? defaultFormat);
    await this.reloadConfig(session);
  }

  private async reloadConfig(session: Session): Promise<void> {
    try {
      session.config = await loadConfig(session.configPath);
    } catch (error) {
      if (error instanceof ConfigError) throw new RequestError(error.message, 500);
      throw error;
    }
  }

  private async engine(session: Session): Promise<Engine> {
    const cached = this.engines.get(session.project.efVersion);
    if (cached) return cached;
    const engine = await prepareEngine({
      session,
      env: this.options.env,
      io: this.options.io,
      enginePath: this.options.args.engine,
      verbose: this.options.args.verbose,
    });
    this.engines.set(session.project.efVersion, engine);
    return engine;
  }

  private requireConnection(session: Session): string {
    if (!session.connection) throw new RequestError('No database connection yet', 409);
    return session.connection.value;
  }

  async listObjects(refresh = false): Promise<ObjectsResponse> {
    const session = this.requireSession();
    if (this.objects && !refresh) return this.objects;
    const connection = this.requireConnection(session);
    const doc = await listObjects(
      await this.engine(session),
      { connection, provider: session.provider, configPath: session.config ? session.configPath : undefined },
      { timeoutMs: this.options.listTimeoutMs ?? 5 * 60_000 },
    );
    if (!doc.success) throw new RequestError('Could not read the database', 502, doc.errors);
    this.objects = { objects: doc.objects ?? [], databaseType: doc.databaseType, warnings: doc.warnings };
    return this.objects;
  }

  /** Uses a connection typed in the UI (kept in memory only) if the engine can read the database with it. */
  async setConnection(request: ConnectionRequest): Promise<ObjectsResponse> {
    const session = this.requireSession();
    if (!request.connection?.trim()) throw new RequestError('Enter a connection string or a .dacpac path');
    const previous = {
      override: this.connectionOverride,
      connection: session.connection,
      provider: session.provider,
    };

    this.connectionOverride = {
      connection: request.connection.trim(),
      provider: request.provider || undefined,
    };
    this.applyConnectionOverride();
    try {
      return await this.listObjects(true);
    } catch (error) {
      this.connectionOverride = previous.override;
      session.connection = previous.connection;
      session.provider = previous.provider;
      throw error;
    }
  }

  /** Generates from the saved config. The engine may rewrite the config (object lists), so it is reloaded. */
  async generate(onLog: (line: string) => void): Promise<{ result: GenerateDocument; config?: EfcptConfig }> {
    const session = this.requireSession();
    if (this.busy) throw new RequestError('Generation is already running', 409);
    const connection = session.connection;
    if (!connection) throw new RequestError('No database connection yet', 409);

    this.busy = true;
    try {
      const result = await generate(await this.engine(session), generateRequest(session, connection), {
        timeoutMs: generateTimeoutMs,
        onLog,
      });
      if (await exists(session.configPath)) await this.reloadConfig(session);
      return { result, config: session.config?.config };
    } finally {
      this.busy = false;
    }
  }
}
