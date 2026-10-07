import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { UsageError, type CliArgs } from '../args.js';
import { defaultFormat, saveConfig } from '../config/io.js';
import { efcptPathFor, importVsConfig } from '../config/vs-import.js';
import { findProjectFile, readProject } from '../project.js';
import type { Output } from './common.js';

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/**
 * Creates an efcpt config from the Visual Studio extension's efpt.config.json. Returns the path written and
 * the lines to show. Never overwrites an existing config.
 */
export async function importVs(
  vsConfigPath: string,
  options: { target?: string; projectPath?: string },
): Promise<{ target: string; messages: string[]; warnings: string[] }> {
  if (!(await exists(vsConfigPath))) throw new UsageError(`${vsConfigPath} does not exist`);
  const target = options.target ?? efcptPathFor(vsConfigPath);
  if (await exists(target)) {
    throw new UsageError(`${target} already exists. Choose another file with --config, or delete it first`);
  }
  const project = await readProject(options.projectPath ?? (await findProjectFile(target)));
  const result = await importVsConfig(vsConfigPath, project.efVersion);
  await mkdir(path.dirname(target), { recursive: true });
  await saveConfig(target, result.config, defaultFormat);

  const everything = result.config['code-generation']?.['refresh-object-lists'] === true;
  return {
    target,
    messages: [
      `Imported ${path.basename(vsConfigPath)} into ${target}`,
      everything
        ? '  All database objects are generated, as in Visual Studio ("no object filter")'
        : `  ${result.objectCount} selected objects. New database objects are not added automatically, as in Visual Studio (refresh-object-lists is off)`,
    ],
    warnings: result.warnings,
  };
}

export async function runImportVs(context: { args: CliArgs; io: Output; cwd: string }): Promise<number> {
  const { args, io, cwd } = context;
  const vsConfigPath = path.resolve(cwd, args.importVs!);
  const { target, messages, warnings } = await importVs(vsConfigPath, {
    target: args.config ? path.resolve(cwd, args.config) : undefined,
    projectPath: args.project ? path.resolve(cwd, args.project) : undefined,
  });
  for (const warning of warnings) io.err(`warning: ${warning}`);
  for (const line of messages) io.out(line);
  const relative = path.relative(cwd, target) || target;
  io.out();
  io.out('The connection string is not part of the Visual Studio config. Next:');
  io.out(`  efcpt-ui --config ${relative} --connection-env MY_DB --list`);
  io.out(`  efcpt-ui --config ${relative}              (the UI asks for the connection)`);
  return 0;
}
