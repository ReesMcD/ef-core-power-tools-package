import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultFormat, loadConfig, saveConfig } from '../config/io.js';
import { completeNames, createConfigTemplate } from '../config/template.js';
import { getUiSection, type ResolvedConnection } from '../connection.js';
import { generate, type GenerateRequest } from '../engine/run.js';
import type { Session } from '../session.js';
import { prepareEngine, printProblems, requireConnection, type CommandContext } from './common.js';

export const generateTimeoutMs = 15 * 60_000;
const defaultTimeoutMs = generateTimeoutMs;

/** The engine request for generating from a session's config. */
export function generateRequest(session: Session, connection: ResolvedConnection): GenerateRequest {
  return {
    connection: connection.value,
    provider: session.provider,
    configPath: session.configPath,
    // Generated paths in the config (file-layout) are relative to the project folder
    outputDir: session.project.projectDir,
    renamingPath: path.resolve(
      path.dirname(session.configPath),
      getUiSection(session.config?.config ?? {}).renaming ?? 'efpt.renaming.json',
    ),
  };
}

/**
 * Makes sure the config exists and names a root namespace and DbContext before the engine runs, using the
 * project's RootNamespace (the engine would use the config's folder name, or nothing). Returns what changed.
 */
export async function prepareConfig(session: Session, connection: ResolvedConnection): Promise<string[]> {
  const options = {
    rootNamespace: session.project.rootNamespace,
    projectName: path.basename(session.project.projectPath, path.extname(session.project.projectPath)),
    connection: connection.value,
  };
  if (!session.config) {
    await mkdir(path.dirname(session.configPath), { recursive: true });
    await saveConfig(session.configPath, createConfigTemplate(options), defaultFormat);
    session.config = await loadConfig(session.configPath);
    return [`Created ${session.configPath}`];
  }
  const config = structuredClone(session.config.config);
  const added = completeNames(config, options);
  if (added.length === 0) return [];
  await saveConfig(session.configPath, config, session.config.format);
  session.config = await loadConfig(session.configPath);
  const names = config.names as Record<string, unknown>;
  return [
    `Added ${added.map((key) => `names.${key} "${String(names[key])}"`).join(' and ')} to ${path.basename(session.configPath)}`,
  ];
}

/** Generates the DbContext and entities without the UI. Returns the process exit code. */
export async function runGenerate(context: CommandContext): Promise<number> {
  const { session, io } = context;
  const connection = requireConnection(session);
  const engine = await prepareEngine(context);
  for (const change of await prepareConfig(session, connection)) io.err(change);

  const started = Date.now();
  const doc = await generate(engine, generateRequest(session, connection), {
    timeoutMs: context.timeoutMs ?? defaultTimeoutMs,
    onLog: context.verbose ? (line) => io.err(line) : undefined,
  });

  printProblems(io, doc.errors, doc.warnings);
  if (!doc.success) {
    io.err(`Generation failed.`);
    return 1;
  }

  const files = [
    doc.contextFilePath,
    ...(doc.contextConfigurationFilePaths ?? []),
    ...(doc.entityTypeFilePaths ?? []),
  ].filter((f): f is string => Boolean(f));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  io.out(`Generated ${files.length} files in ${seconds}s`);
  for (const folder of doc.outputFolders ?? [])
    io.out(`  ${path.relative(session.project.projectDir, folder) || '.'}`);
  if (context.verbose)
    for (const file of files) io.out(`    ${path.relative(session.project.projectDir, file)}`);
  if (doc.readmePath) io.out(`Next steps: ${doc.readmePath}`);
  if (doc.diagramPath) io.out(`Diagram: ${doc.diagramPath}`);
  return 0;
}
