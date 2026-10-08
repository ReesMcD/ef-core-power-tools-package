import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyLineEnding,
  csFiles,
  detectLineEnding,
  lineEndingToKeep,
  parseLineEndingSetting,
} from '../src/line-endings.js';

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-eol-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

describe('line endings', () => {
  it('finds .cs files in schema folders and skips build output', async () => {
    const dir = await folder({ 'A.cs': '', 'dbo/B.cs': '', 'obj/C.cs': '', 'D.txt': '' });
    expect((await csFiles([dir])).map((f) => path.relative(dir, f)).sort()).toEqual([
      'A.cs',
      path.join('dbo', 'B.cs'),
    ]);
  });

  it('detects what most existing files use', async () => {
    const crlf = await folder({ 'A.cs': 'a\r\nb\r\n', 'B.cs': 'a\r\nb\r\n', 'C.cs': 'a\nb\n' });
    expect(await detectLineEnding(await csFiles([crlf]))).toBe('\r\n');
    const lf = await folder({ 'A.cs': 'a\nb\n' });
    expect(await detectLineEnding(await csFiles([lf]))).toBe('\n');
    expect(await detectLineEnding(await csFiles([await folder({ 'A.cs': 'one line' })]))).toBeUndefined();
    expect(await detectLineEnding([])).toBeUndefined();
  });

  it('rewrites only files that differ, keeping the BOM and UTF-8 text', async () => {
    const dir = await folder({ 'A.cs': '﻿class Café\n{\r\n}\n', 'B.cs': 'x\r\ny\r\n' });
    const files = await csFiles([dir]);
    expect(await applyLineEnding(files, '\r\n')).toBe(1);
    expect(await readFile(path.join(dir, 'A.cs'), 'utf8')).toBe('﻿class Café\r\n{\r\n}\r\n');
    expect(await applyLineEnding(files, '\n')).toBe(2);
    expect(await readFile(path.join(dir, 'B.cs'), 'utf8')).toBe('x\ny\n');
  });

  it('uses the configured line endings, or samples the existing code', async () => {
    const dir = await folder({ 'A.cs': 'a\r\nb\r\n' });
    expect(await lineEndingToKeep('auto', [dir])).toBe('\r\n');
    expect(await lineEndingToKeep('lf', [dir])).toBe('\n');
    expect(await lineEndingToKeep('crlf', [path.join(dir, 'missing')])).toBe('\r\n');
    expect(await lineEndingToKeep('auto', [path.join(dir, 'missing')])).toBeUndefined();
    expect(parseLineEndingSetting('CRLF')).toBe('auto');
    expect(parseLineEndingSetting('lf')).toBe('lf');
  });
});
