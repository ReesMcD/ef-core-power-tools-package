import { isGenerated, sectionForType } from '../config/selection.js';
import type { ObjectType } from '../engine/contract.js';
import { listObjects } from '../engine/run.js';
import { prepareEngine, printProblems, requireConnection, type CommandContext } from './common.js';

const defaultTimeoutMs = 5 * 60_000;

/** Lists the database objects and whether the config selects each one. Returns the process exit code. */
export async function runList(context: CommandContext): Promise<number> {
  const { session, io } = context;
  const connection = requireConnection(session);
  const engine = await prepareEngine(context);

  const doc = await listObjects(
    engine,
    {
      connection: connection.value,
      provider: session.provider,
      configPath: session.config ? session.configPath : undefined,
    },
    {
      timeoutMs: context.timeoutMs ?? defaultTimeoutMs,
      onLog: context.verbose ? (line) => io.err(line) : undefined,
    },
  );

  printProblems(io, doc.errors, doc.warnings);
  if (!doc.success) return 1;

  const objects = doc.objects ?? [];
  const config = session.config?.config;
  io.out(
    `${objects.length} objects in ${doc.databaseType ?? 'the database'} ([x] = generated on the next --generate)`,
  );

  for (const [type, section] of Object.entries(sectionForType) as [ObjectType, string][]) {
    const ofType = objects.filter((o) => o.type === type);
    if (ofType.length === 0) continue;
    io.out();
    io.out(`${section}:`);
    for (const object of ofType) {
      // Without a config file, efcpt creates one that includes every object
      const generated = config ? isGenerated(config, sectionForType[type], object.displayName) : true;
      const mark = generated ? '[x] ' : '[ ] ';
      const columns = object.columns?.map((c) => c.name + (c.isPrimaryKey ? '*' : '')).join(', ');
      io.out(`  ${mark}${object.displayName}${columns ? `  (${columns})` : ''}`);
    }
  }
  return 0;
}
