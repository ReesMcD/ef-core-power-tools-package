import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/args.js';

const updateScript = fileURLToPath(new URL('../scripts/update.mjs', import.meta.url));

function git(cwd: string, ...args: string[]) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'init.defaultBranch=master', ...args],
    { cwd, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

/** An "origin" repository laid out like this one, and a checkout of it with efcpt-ui installed. */
async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-update-'));
  const origin = path.join(root, 'origin');
  const packageDir = path.join(origin, 'packages', 'efcpt-ui');
  await mkdir(packageDir, { recursive: true });
  // The build writes a marker, so the tests can see whether it ran
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'fake',
      scripts: {
        build:
          "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/cli.js','built')\"",
      },
    }),
  );
  await writeFile(path.join(packageDir, 'index.js'), '// v1\n');
  git(origin, 'init', '-q');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'v1');
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', origin, clone);
  const installed = path.join(clone, 'packages', 'efcpt-ui');
  await mkdir(path.join(installed, 'node_modules'));
  await mkdir(path.join(installed, 'dist'));
  await writeFile(path.join(installed, 'dist', 'cli.js'), 'old build');
  return { origin, clone, installed };
}

function update(clone: string) {
  return spawnSync(process.execPath, [updateScript, '--root', clone], { encoding: 'utf8' });
}

describe('updating efcpt-ui', () => {
  it('is available as efcpt --update', () => {
    expect(parseCliArgs(['--update']).update).toBe(true);
    expect(parseCliArgs([]).update).toBe(false);
  });

  it('says so when there is nothing new, and rebuilds nothing', async () => {
    const { clone, installed } = await checkout();
    const result = update(clone);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Already up to date');
    expect(await readFile(path.join(installed, 'dist', 'cli.js'), 'utf8')).toBe('old build');
  });

  it('pulls new changes and rebuilds efcpt-ui, without reinstalling unchanged dependencies', async () => {
    const { origin, clone, installed } = await checkout();
    await writeFile(path.join(origin, 'packages', 'efcpt-ui', 'index.js'), '// v2\n');
    git(origin, 'commit', '-q', '-am', 'v2: better things');

    const result = update(clone);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('v2: better things');
    expect(result.stdout).toContain('No engines are built');
    expect(result.stdout).not.toContain('Installing npm dependencies');
    expect(await readFile(path.join(installed, 'index.js'), 'utf8')).toBe('// v2\n');
    expect(await readFile(path.join(installed, 'dist', 'cli.js'), 'utf8')).toBe('built');
  });

  it('stops before pulling when the checkout has local changes', async () => {
    const { origin, clone, installed } = await checkout();
    await writeFile(path.join(installed, 'index.js'), '// my local edit\n');
    await writeFile(path.join(origin, 'packages', 'efcpt-ui', 'index.js'), '// v2\n');
    git(origin, 'commit', '-q', '-am', 'v2');

    const result = update(clone);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('local changes');
    expect(result.stderr).toContain('git stash');
    expect(await readFile(path.join(installed, 'index.js'), 'utf8')).toBe('// my local edit\n');
    await expect(access(path.join(installed, 'dist', 'cli.js'))).resolves.toBeUndefined();
  });
});
