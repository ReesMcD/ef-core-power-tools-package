#!/usr/bin/env node
// Updates this checkout of efcpt-ui: pulls, then rebuilds only what changed (the engines you have built,
// npm dependencies, efcpt-ui itself). Run with `efcpt --update` or `npm run update`.
// Plain JavaScript without dependencies, so it also works when the efcpt-ui build is broken.
//
// Options: --force rebuilds everything that is built even when nothing was pulled.
//          --root <dir> updates another checkout (for tests).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const force = args.includes('--force');
const rootArg = args.indexOf('--root');
const repoRoot =
  rootArg >= 0
    ? path.resolve(args[rootArg + 1])
    : path.resolve(fileURLToPath(import.meta.url), '../../../..');
const packageDir = path.join(repoRoot, 'packages', 'efcpt-ui');
const engineVersions = ['8', '9', '10'];

class StepError extends Error {}

function run(command, commandArgs, cwd = repoRoot, capture = false) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    // npm is npm.cmd on Windows, which only runs through a shell
    shell: process.platform === 'win32' && command === 'npm',
  });
  if (result.error) throw new StepError(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = capture ? `\n${(result.stderr || result.stdout).trim()}` : '';
    throw new StepError(`${command} ${commandArgs.join(' ')} failed (exit code ${result.status})${output}`);
  }
  return capture ? result.stdout.trim() : '';
}

const git = (...gitArgs) => run('git', gitArgs, repoRoot, true);
const step = (text) => console.log(`\n== ${text}`);

function update() {
  if (!existsSync(path.join(repoRoot, '.git'))) {
    throw new StepError(`${repoRoot} is not a git checkout, so it can't be updated with git pull.`);
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    throw new StepError(
      'This checkout has local changes, so the update stopped before touching anything:\n' +
        git('status', '--short', '--untracked-files=no') +
        '\nKeep them with `git stash` (and `git stash pop` afterwards), or discard them with `git checkout -- .`, then run the update again.',
    );
  }

  const before = git('rev-parse', 'HEAD');
  step(`Pulling ${git('rev-parse', '--abbrev-ref', 'HEAD')} in ${repoRoot}`);
  run('git', ['pull', '--ff-only', '--prune']);
  const after = git('rev-parse', 'HEAD');

  const changed =
    before === after ? [] : git('diff', '--name-only', before, after).split('\n').filter(Boolean);
  if (before === after && !force) {
    console.log('\nAlready up to date. (`npm run update -- --force` rebuilds anyway.)');
    return;
  }
  if (before !== after) {
    console.log(`\nNew changes:\n${git('log', '--oneline', '--no-decorate', `${before}..${after}`)}`);
  }

  const touched = (prefix) => force || changed.some((file) => file.startsWith(prefix));

  // Engines: rebuild the ones built before, when their source changed
  const built = engineVersions.filter((v) =>
    existsSync(path.join(repoRoot, 'src', 'Core', `efcpt.${v}`, 'bin', 'Release')),
  );
  if (built.length === 0) {
    console.log('\nNo engines are built in this checkout, so none were rebuilt.');
  } else if (touched('src/')) {
    for (const v of built) {
      step(`Building the EF Core ${v} engine`);
      run('dotnet', [
        'build',
        path.join('src', 'Core', `efcpt.${v}`, `efcpt.${v}.csproj`),
        '-c',
        'Release',
        '-v',
        'q',
        '-nologo',
      ]);
    }
  } else {
    console.log(`\nEngines (EF Core ${built.join(', ')}): no engine changes, nothing to rebuild.`);
  }

  // efcpt-ui: reinstall dependencies only when they changed, rebuild when its code changed
  const lockChanged =
    force ||
    changed.includes('packages/efcpt-ui/package-lock.json') ||
    changed.includes('packages/efcpt-ui/package.json');
  if (lockChanged || !existsSync(path.join(packageDir, 'node_modules'))) {
    step('Installing npm dependencies');
    run('npm', ['ci', '--no-audit', '--no-fund'], packageDir);
  }
  if (touched('packages/efcpt-ui/') || !existsSync(path.join(packageDir, 'dist', 'cli.js'))) {
    step('Building efcpt-ui');
    run('npm', ['run', 'build'], packageDir);
  } else {
    console.log('\nefcpt-ui: no changes, nothing to rebuild.');
  }

  console.log(`\nUpdated to ${git('log', '-1', '--format=%h %s')}`);
}

try {
  update();
} catch (error) {
  if (!(error instanceof StepError)) throw error;
  console.error(`\nUpdate failed: ${error.message}`);
  process.exitCode = 1;
}
