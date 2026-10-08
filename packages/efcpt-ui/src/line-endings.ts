// The engine writes Environment.NewLine, so generating from WSL or macOS writes LF where Visual Studio on Windows
// wrote CRLF, and every generated file shows up as changed. Generated files keep the line endings of the code
// that is already there instead.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LineEndingSetting = 'auto' | 'crlf' | 'lf';
export type LineEnding = '\r\n' | '\n';

const skipped = new Set(['bin', 'obj', 'node_modules', '.git']);
const sampleBytes = 16 * 1024;
const maxSampledFiles = 200;

/** .cs files below the folders (recursively, skipping build output), at most `limit`. */
export async function csFiles(folders: string[], limit = Number.POSITIVE_INFINITY): Promise<string[]> {
  const found = new Set<string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.size >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name.toLowerCase())) await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
        found.add(full);
      }
    }
  }
  for (const folder of new Set(folders.map((f) => path.resolve(f)))) await walk(folder);
  return [...found];
}

/** The line ending most of the files use, or undefined when none of them has a line break. */
export async function detectLineEnding(files: string[]): Promise<LineEnding | undefined> {
  let crlf = 0;
  let lf = 0;
  for (const file of files.slice(0, maxSampledFiles)) {
    const text = (await readFile(file).catch(() => Buffer.alloc(0)))
      .subarray(0, sampleBytes)
      .toString('latin1');
    const breaks = text.match(/\r?\n/g);
    if (!breaks) continue;
    if (breaks.filter((b) => b === '\r\n').length * 2 >= breaks.length) crlf++;
    else lf++;
  }
  if (crlf === 0 && lf === 0) return undefined;
  return crlf > lf ? '\r\n' : '\n';
}

/** Rewrites the files that use other line endings. Returns how many changed. */
export async function applyLineEnding(files: string[], ending: LineEnding): Promise<number> {
  let changed = 0;
  for (const file of new Set(files)) {
    const bytes = await readFile(file).catch(() => undefined);
    if (!bytes) continue;
    // latin1 maps every byte to one character and back, so the BOM and UTF-8 text are kept as they are
    const before = bytes.toString('latin1');
    const after = before.replace(/\r?\n/g, ending);
    if (after === before) continue;
    await writeFile(file, Buffer.from(after, 'latin1'));
    changed++;
  }
  return changed;
}

/** .cs files below the folders written at or after `since` (ms). */
export async function filesWrittenSince(folders: string[], since: number): Promise<string[]> {
  const recent: string[] = [];
  for (const file of await csFiles(folders)) {
    const info = await stat(file).catch(() => undefined);
    if (info && info.mtimeMs >= since) recent.push(file);
  }
  return recent;
}

export function parseLineEndingSetting(value: unknown): LineEndingSetting {
  return value === 'crlf' || value === 'lf' ? value : 'auto';
}

/** Samples the existing code before generating, when the setting is "auto". */
export async function lineEndingToKeep(
  setting: LineEndingSetting,
  folders: string[],
): Promise<LineEnding | undefined> {
  if (setting === 'crlf') return '\r\n';
  if (setting === 'lf') return '\n';
  return detectLineEnding(await csFiles(folders, maxSampledFiles));
}

export function describeLineEnding(ending: LineEnding): string {
  return ending === '\r\n' ? 'CRLF' : 'LF';
}
