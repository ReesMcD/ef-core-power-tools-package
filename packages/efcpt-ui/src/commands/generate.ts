import path from 'node:path';
import { generate } from '../engine/run.js';
import { prepareEngine, printProblems, requireConnection, type CommandContext } from './common.js';

const defaultTimeoutMs = 15 * 60_000;

/** Generates the DbContext and entities without the UI. Returns the process exit code. */
export async function runGenerate(context: CommandContext): Promise<number> {
  const { session, io } = context;
  const connection = requireConnection(session);
  const engine = await prepareEngine(context);

  const started = Date.now();
  const doc = await generate(
    engine,
    {
      connection: connection.value,
      provider: session.provider,
      configPath: session.configPath,
      // Generated paths in the config (file-layout) are relative to the project folder
      outputDir: session.project.projectDir,
      renamingPath: path.join(path.dirname(session.configPath), 'efpt.renaming.json'),
    },
    {
      timeoutMs: context.timeoutMs ?? defaultTimeoutMs,
      onLog: context.verbose ? (line) => io.err(line) : undefined,
    },
  );

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
