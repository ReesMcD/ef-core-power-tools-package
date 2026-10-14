import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

/**
 * An "origin" repository laid out like this one (with a copy of the update script), a checkout of it with
 * efcpt-cli installed, and a home folder and global npm folder of its own.
 */
async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-update-'));
  const origin = path.join(root, 'origin');
  const packageDir = path.join(origin, 'packages', 'efcpt-cli');
  await mkdir(path.join(packageDir, 'scripts'), { recursive: true });
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
  await copyFile(updateScript, path.join(packageDir, 'scripts', 'update.mjs'));
  git(origin, 'init', '-q');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'v1');
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', origin, clone);
  const installed = path.join(clone, 'packages', 'efcpt-cli');
  await mkdir(path.join(installed, 'node_modules'));
  await mkdir(path.join(installed, 'dist'));
  await writeFile(path.join(installed, 'dist', 'cli.js'), 'old build');
  const home = path.join(root, 'home');
  await mkdir(home);
  return { root, origin, clone, installed, home };
}

function update(clone: string, home: string) {
  return spawnSync(process.execPath, [updateScript, '--root', clone], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      // Global npm commands look in a folder of the test's own
      npm_config_prefix: path.join(home, 'npm-global'),
    },
  });
}

describe('updating efcpt-cli', () => {
  it('is available as efcpt --update', () => {
    expect(parseCliArgs(['--update']).update).toBe(true);
    expect(parseCliArgs([]).update).toBe(false);
  });

  it('says so when there is nothing new, and rebuilds nothing', async () => {
    const { clone, installed, home } = await checkout();
    const result = update(clone, home);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Already up to date');
    expect(await readFile(path.join(installed, 'dist', 'cli.js'), 'utf8')).toBe('old build');
  });

  it('pulls new changes and rebuilds efcpt-cli, without reinstalling unchanged dependencies', async () => {
    const { origin, clone, installed, home } = await checkout();
    await writeFile(path.join(origin, 'packages', 'efcpt-cli', 'index.js'), '// v2\n');
    git(origin, 'commit', '-q', '-am', 'v2: better things');

    const result = update(clone, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('v2: better things');
    expect(result.stdout).toContain('No engines are built');
    expect(result.stdout).not.toContain('Installing npm dependencies');
    // Git may check the file out with CRLF line endings (core.autocrlf on Windows)
    expect(await readFile(path.join(installed, 'index.js'), 'utf8')).toMatch(/^\/\/ v2\r?\n$/);
    expect(await readFile(path.join(installed, 'dist', 'cli.js'), 'utf8')).toBe('built');
  });

  it('lets the freshly pulled update script finish the update', async () => {
    const { origin, clone, home } = await checkout();
    const script = path.join(origin, 'packages', 'efcpt-cli', 'scripts', 'update.mjs');
    // After the #! line, which has to stay first
    const [shebang, ...rest] = (await readFile(script, 'utf8')).split('\n');
    await writeFile(script, [shebang, "console.log('the new update script ran');", ...rest].join('\n'));
    git(origin, 'commit', '-q', '-am', 'v2: a better update');

    const result = update(clone, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('the new update script ran');
    expect(result.stdout).toContain('v2: a better update');
  });

  it('cleans up after the rename from efcpt-ui: shell functions and leftover build output', async () => {
    const { clone, home } = await checkout();
    const oldCli = path.join(clone, 'packages', 'efcpt-ui', 'dist', 'cli.js');
    const newCli = path.join(clone, 'packages', 'efcpt-cli', 'dist', 'cli.js');
    await mkdir(path.dirname(oldCli), { recursive: true });
    await mkdir(path.join(clone, 'packages', 'efcpt-ui', 'node_modules'));
    await writeFile(oldCli, 'old build');
    // The function from before the rename, still called efcpt-ui
    const fishFunctions = path.join(home, '.config', 'fish', 'functions');
    await mkdir(fishFunctions, { recursive: true });
    await writeFile(
      path.join(fishFunctions, 'efcpt-ui.fish'),
      `function efcpt-ui\n    '/usr/bin/node' '${oldCli}' $argv\nend\n`,
    );
    await writeFile(path.join(home, '.bashrc'), `alias ll='ls -l'\nefcpt-ui() { node '${oldCli}' "$@"; }\n`);

    const result = update(clone, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(path.join(fishFunctions, 'efcpt.fish'), 'utf8')).toBe(
      `function efcpt\n    '/usr/bin/node' '${newCli}' $argv\nend\n`,
    );
    await expect(access(path.join(fishFunctions, 'efcpt-ui.fish'))).rejects.toThrow();
    expect(await readFile(path.join(home, '.bashrc'), 'utf8')).toBe(
      `alias ll='ls -l'\nefcpt() { node '${newCli}' "$@"; }\n`,
    );
    await expect(access(path.join(clone, 'packages', 'efcpt-ui'))).rejects.toThrow();
    expect(result.stdout).toContain('Removed packages/efcpt-ui');
  });

  it('keeps an old efcpt-ui folder that has files of yours in it', async () => {
    const { clone, home } = await checkout();
    await mkdir(path.join(clone, 'packages', 'efcpt-ui'), { recursive: true });
    await writeFile(path.join(clone, 'packages', 'efcpt-ui', 'notes.txt'), 'mine');

    const result = update(clone, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('notes.txt');
    expect(await readFile(path.join(clone, 'packages', 'efcpt-ui', 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('stops before pulling when the checkout has local changes', async () => {
    const { origin, clone, installed, home } = await checkout();
    await writeFile(path.join(installed, 'index.js'), '// my local edit\n');
    await writeFile(path.join(origin, 'packages', 'efcpt-cli', 'index.js'), '// v2\n');
    git(origin, 'commit', '-q', '-am', 'v2');

    const result = update(clone, home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('local changes');
    expect(result.stderr).toContain('git stash');
    expect(await readFile(path.join(installed, 'index.js'), 'utf8')).toBe('// my local edit\n');
    await expect(access(path.join(installed, 'dist', 'cli.js'))).resolves.toBeUndefined();
  });
});
