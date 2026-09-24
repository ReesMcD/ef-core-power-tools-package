#!/usr/bin/env node
// Throwaway spike: proves the Node -> efcpt --json path the npm package will use.
// Lists the database objects and shows which ones a given efcpt-config.json selects.
//
// Usage:
//   node planning/spikes/list-objects.mjs --engine <efcpt.N.dll> --connection "<conn>" [--provider sqlite] [--config efcpt-config.json]
//
// No dependencies; needs Node 20+ and dotnet on PATH.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    engine: { type: 'string' },
    connection: { type: 'string' },
    provider: { type: 'string' },
    config: { type: 'string' },
  },
});

if (!args.engine || !args.connection) {
  console.error('usage: list-objects.mjs --engine <efcpt.N.dll> --connection "<conn>" [--provider <p>] [--config <file>]');
  process.exit(2);
}

// Run efcpt without a shell, so connection strings are passed through untouched
function runEngine(engineArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('dotnet', [args.engine, ...engineArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        resolve({ code, doc: JSON.parse(stdout), stderr });
      } catch {
        reject(new Error(`efcpt did not return JSON (exit ${code}):\n${stderr || stdout}`));
      }
    });
  });
}

// Config files written by efcpt start with a UTF-8 BOM
async function readConfig(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text.replace(/^﻿/, ''));
}

// Mirrors CliConfigMapper.GetFilters / ExclusionFilter in src/GUI/RevEng.Shared/Cli/CliConfigMapper.cs
function parseWildcard(w) {
  if (w.startsWith('*') && w.endsWith('*') && w.length > 2) return (n) => n.includes(w.slice(1, -1));
  if (w.startsWith('*')) return (n) => n.endsWith(w.slice(1));
  if (w.endsWith('*')) return (n) => n.startsWith(w.slice(0, -1));
  return null; // a '*' in the middle is ignored by the CLI
}

function isSelected(entries = [], displayName) {
  // Objects missing from the config are not generated
  const entry = entries.find((e) => e.name === displayName && !e.exclusionWildcard);
  if (!entry) return false;

  const wildcards = entries.map((e) => e.exclusionWildcard).filter(Boolean);
  if (wildcards.includes('*')) return entry.exclude === false;
  if (entry.exclude === false) return true;

  const filters = wildcards.filter((w) => w.includes('*')).map(parseWildcard).filter(Boolean);
  if (filters.some((matches) => matches(displayName))) return false;
  return entry.exclude !== true;
}

const sections = { table: 'tables', view: 'views', storedProcedure: 'stored-procedures', function: 'functions' };

const engineArgs = [args.connection, ...(args.provider ? [args.provider] : []), '--list-objects', '--json'];
const started = Date.now();
const { code, doc } = await runEngine(engineArgs);

if (!doc.success) {
  console.error(`efcpt failed (exit ${code}):`);
  for (const e of doc.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const config = args.config ? await readConfig(args.config) : null;

console.log(`${doc.objects.length} objects from ${doc.databaseType} (EF Core ${doc.efCoreVersion}) in ${Date.now() - started} ms\n`);
for (const [type, section] of Object.entries(sections)) {
  const objects = doc.objects.filter((o) => o.type === type);
  if (objects.length === 0) continue;
  console.log(`${section}:`);
  for (const o of objects) {
    const mark = config ? (isSelected(config[section], o.displayName) ? '[x]' : '[ ]') : ' - ';
    const cols = o.columns?.map((c) => c.name + (c.isPrimaryKey ? '*' : '') + (c.isForeignKey ? '→' : '')).join(', ') ?? '';
    console.log(`  ${mark} ${o.displayName}  (${cols})`);
  }
}
