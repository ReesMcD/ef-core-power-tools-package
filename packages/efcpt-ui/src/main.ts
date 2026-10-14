import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { helpText, parseCliArgs, UsageError } from './args.js';
import { runGenerate } from './commands/generate.js';
import { runImportVs } from './commands/import-vs.js';
import { consoleOutput, type Output } from './commands/common.js';
import { runList } from './commands/list.js';
import { runUi } from './commands/ui.js';
import { ConfigError } from './config/io.js';
import { ConnectionError } from './connection.js';
import { EngineNotFoundError } from './engine/locate.js';
import { EngineError } from './engine/run.js';
import { RuntimeError } from './engine/runtime.js';
import { ProjectError } from './project.js';
import { redact } from './redact.js';
import { resolveSession } from './session.js';

function packageVersion(): string {
  const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(text) as { version: string }).version;
}

/** Runs scripts/update.mjs, which pulls this checkout and rebuilds what changed. */
function runUpdate(io: Output): number {
  const script = fileURLToPath(new URL('../scripts/update.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.error) {
    io.err(`error: could not run ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const setupErrors = [
  UsageError,
  ConfigError,
  ProjectError,
  ConnectionError,
  EngineNotFoundError,
  RuntimeError,
];

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: Output = consoleOutput,
  cwd = process.cwd(),
): Promise<number> {
  let verbose = false;
  const secrets: string[] = [];
  try {
    const args = parseCliArgs(argv);
    verbose = args.verbose;
    if (args.connection) secrets.push(args.connection);
    if (args.help) {
      io.out(helpText);
      return 0;
    }
    if (args.version) {
      io.out(packageVersion());
      return 0;
    }
    if (args.update) return runUpdate(io);

    if (args.importVs !== undefined) return await runImportVs({ args, io, cwd });

    // The UI resolves its own session: it can start without a config and without a connection
    if (!args.generate && !args.list) return await runUi({ args, env, io, cwd });

    const session = await resolveSession(args, env, cwd);
    if (session.connection) secrets.push(session.connection.value);
    const context = { session, env, io, enginePath: args.engine, verbose };

    if (args.generate) return await runGenerate(context);
    return await runList(context);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), secrets);
    io.err(`error: ${message}`);
    if (error instanceof EngineError && error.details) io.err(redact(error.details, secrets));
    if (setupErrors.some((type) => error instanceof type)) return 2;
    if (verbose && error instanceof Error && error.stack && !(error instanceof EngineError)) {
      io.err(redact(error.stack, secrets));
    }
    return 1;
  }
}
