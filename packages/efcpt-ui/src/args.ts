import { parseArgs } from 'node:util';

export interface CliArgs {
  config?: string;
  project?: string;
  connection?: string;
  connectionEnv?: string;
  provider?: string;
  engine?: string;
  importVs?: string;
  port?: number;
  open: boolean;
  generate: boolean;
  list: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const helpText = `efcpt-ui - EF Core Power Tools UI

Reverse engineer a database into EF Core DbContext and entity classes, driven by an efcpt-config.json.

Usage:
  efcpt-ui [--config <file>] [options]            open the UI in your browser
  efcpt-ui --config <file> --generate [options]   generate code without the UI (for scripts and CI)
  efcpt-ui --config <file> --list [options]       list database objects and which ones the config selects
  efcpt-ui --import-vs <efpt.config.json>         convert a Visual Studio extension config to efcpt-config.json

Options:
  -c, --config <file>          efcpt-config.json to use. Default: the only efcpt config found in the project,
                               or efcpt-config.json in the current folder when there is none yet
  -p, --project <csproj>       .NET project. Default: the nearest .csproj at or above the config
      --connection <string>    Connection string, or path to a .dacpac
      --connection-env <var>   Read the connection string from this environment variable
      --provider <name>        mssql, postgres, sqlite, oracle, mysql, firebird or snowflake.
                               Default: from the project's EF Core provider package or the connection string
      --engine <path>          Engine to use (efcpt.<N>.dll or efcpt-ui-engine). Also EFCPT_UI_ENGINE
      --port <number>          UI port (default: a free port)
      --no-open                Don't open the browser
  -v, --verbose                Show the engine's progress output
  -h, --help                   Show this help
      --version                Show the version

Connection string lookup order: --connection, --connection-env, EFCPT_CONNECTION, then the
"efcpt-ui": { "connection": ... } section of the config file, which can point at an environment
variable, a user secret, an appsettings key or a .dacpac, so no secret is stored in the config.

Exit codes: 0 success, 1 generation failed, 2 usage or setup problem.`;

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        config: { type: 'string', short: 'c' },
        project: { type: 'string', short: 'p' },
        connection: { type: 'string' },
        'connection-env': { type: 'string' },
        provider: { type: 'string' },
        engine: { type: 'string' },
        'import-vs': { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean', default: false },
        generate: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  const { values } = parsed;
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new UsageError(`--port must be a number from 0 to 65535`);
  }
  if (values.generate && values.list) throw new UsageError('Use either --generate or --list, not both');
  if (values['import-vs'] !== undefined && (values.generate || values.list)) {
    throw new UsageError('--import-vs only creates the config; run --list or --generate afterwards');
  }

  return {
    config: values.config,
    project: values.project,
    connection: values.connection,
    connectionEnv: values['connection-env'],
    provider: values.provider,
    engine: values.engine,
    importVs: values['import-vs'],
    port,
    open: !values['no-open'],
    generate: values.generate,
    list: values.list,
    verbose: values.verbose,
    help: values.help,
    version: values.version,
  };
}
