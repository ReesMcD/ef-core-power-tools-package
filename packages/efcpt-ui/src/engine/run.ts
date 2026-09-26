import { redact } from '../redact.js';
import { connectionHint } from './hints.js';
import {
  supportedSchemaVersion,
  type EngineDocument,
  type GenerateDocument,
  type ListObjectsDocument,
} from './contract.js';
import type { Engine } from './locate.js';
import { runProcess } from './process.js';

export class EngineError extends Error {
  constructor(
    message: string,
    readonly details = '',
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface EngineRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Receives the engine's progress output (stderr), already redacted. */
  onLog?: (line: string) => void;
}

export interface ListObjectsRequest {
  connection: string;
  provider?: string;
  /** Only read, for merge-dacpacs. */
  configPath?: string;
}

export interface GenerateRequest {
  connection: string;
  provider?: string;
  configPath: string;
  outputDir: string;
  renamingPath?: string;
}

export function listObjectsArgs(request: ListObjectsRequest): string[] {
  const args = [request.connection];
  if (request.provider) args.push(request.provider);
  if (request.configPath) args.push('-i', request.configPath);
  args.push('--list-objects', '--json');
  return args;
}

export function generateArgs(request: GenerateRequest): string[] {
  const args = [request.connection];
  if (request.provider) args.push(request.provider);
  args.push('-i', request.configPath, '-o', request.outputDir);
  if (request.renamingPath) args.push('-r', request.renamingPath);
  args.push('--json');
  return args;
}

function tail(text: string, lines = 20): string {
  return text.trim().split(/\r?\n/).slice(-lines).join('\n');
}

/** Parses the single JSON document the engine writes to stdout with --json. */
export function parseEngineOutput(stdout: string): EngineDocument | undefined {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (!line) return undefined;
  try {
    const doc = JSON.parse(line) as EngineDocument;
    return typeof doc === 'object' && doc !== null && 'schemaVersion' in doc ? doc : undefined;
  } catch {
    return undefined;
  }
}

async function runEngine(
  engine: Engine,
  args: string[],
  secrets: string[],
  options: EngineRunOptions,
): Promise<EngineDocument> {
  let result;
  try {
    result = await runProcess(engine.command, [...engine.prefixArgs, ...args], {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStderrLine: options.onLog ? (line) => options.onLog!(redact(line, secrets)) : undefined,
    });
  } catch (error) {
    throw new EngineError(`Cannot start the engine (${engine.description}): ${(error as Error).message}`);
  }

  const stderr = redact(result.stderr, secrets);
  if (result.timedOut) {
    throw new EngineError(
      `The engine did not finish within ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds`,
      tail(stderr),
    );
  }

  const doc = parseEngineOutput(result.stdout);
  if (!doc) {
    throw new EngineError(
      `The engine (${engine.description}) did not return a result (exit code ${result.code}). ` +
        `It may be an engine build without --json support.`,
      tail(redact(`${result.stdout}\n${stderr}`, secrets)),
    );
  }
  if (doc.schemaVersion !== supportedSchemaVersion) {
    throw new EngineError(
      `The engine returned result format ${doc.schemaVersion}, this version of efcpt-ui understands format ${supportedSchemaVersion}. Update efcpt-ui or the engine.`,
    );
  }

  doc.errors = (doc.errors ?? []).map((e) => redact(e, secrets));
  doc.warnings = (doc.warnings ?? []).map((w) => redact(w, secrets));
  return doc;
}

/** Adds what to do next to a failed run's last error, for the connection errors that need explaining. */
function withHint<T extends EngineDocument>(doc: T, connection: string): T {
  if (doc.success || !doc.errors?.length) return doc;
  const hint = connectionHint(doc.errors, connection);
  if (hint) doc.errors[doc.errors.length - 1] += `\nHint: ${hint}`;
  return doc;
}

export async function listObjects(
  engine: Engine,
  request: ListObjectsRequest,
  options: EngineRunOptions = {},
): Promise<ListObjectsDocument> {
  const doc = await runEngine(engine, listObjectsArgs(request), [request.connection], options);
  if (doc.command !== 'list-objects') throw new EngineError(`Unexpected engine result '${doc.command}'`);
  return withHint(doc, request.connection);
}

export async function generate(
  engine: Engine,
  request: GenerateRequest,
  options: EngineRunOptions = {},
): Promise<GenerateDocument> {
  const doc = await runEngine(engine, generateArgs(request), [request.connection], options);
  if (doc.command !== 'generate') throw new EngineError(`Unexpected engine result '${doc.command}'`);
  return withHint(doc, request.connection);
}
