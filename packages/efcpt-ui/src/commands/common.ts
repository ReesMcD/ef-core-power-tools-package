import path from 'node:path';
import { UsageError } from '../args.js';
import type { ResolvedConnection } from '../connection.js';
import { locateEngine, type Engine } from '../engine/locate.js';
import { checkDotnetRuntime } from '../engine/runtime.js';
import type { Session } from '../session.js';

/** Where output goes: results on stdout, progress and problems on stderr. */
export interface Output {
  out(line?: string): void;
  err(line?: string): void;
}

export const consoleOutput: Output = {
  out: (line = '') => process.stdout.write(`${line}\n`),
  err: (line = '') => process.stderr.write(`${line}\n`),
};

export interface CommandContext {
  session: Session;
  env: NodeJS.ProcessEnv;
  io: Output;
  enginePath?: string;
  verbose: boolean;
  timeoutMs?: number;
}

export function requireConnection(session: Session): ResolvedConnection {
  if (session.connection) return session.connection;
  throw new UsageError(
    'No database connection. Pass --connection "<connection string>", set EFCPT_CONNECTION, or add to ' +
      `${path.basename(session.configPath)}:\n  "efcpt-ui": { "connection": { "env": "MY_DB_CONNECTION" } }`,
  );
}

/** Checks the runtime and finds the engine, then prints what will be used. */
export async function prepareEngine(context: CommandContext): Promise<Engine> {
  const { session, io } = context;
  const engine = await locateEngine({
    efVersion: session.project.efVersion,
    enginePath: context.enginePath,
    env: context.env,
  });
  if (engine.command === 'dotnet') {
    await checkDotnetRuntime(session.project.efVersion);
  }

  for (const warning of session.warnings) io.err(`warning: ${warning}`);
  io.err(`project:    ${session.project.projectPath}`);
  io.err(`config:     ${session.configPath}${session.config ? '' : ' (new, created by the engine)'}`);
  io.err(`EF Core:    ${session.project.efVersion} (${session.project.efVersionSource})`);
  io.err(
    `connection: ${session.connection?.source ?? 'none'}${session.provider ? `, provider ${session.provider}` : ''}`,
  );
  io.err(`engine:     ${engine.description}`);
  io.err();
  return engine;
}

export function printProblems(io: Output, errors: string[], warnings: string[]): void {
  for (const warning of warnings) io.err(`warning: ${warning}`);
  for (const error of errors) io.err(`error: ${error}`);
}
