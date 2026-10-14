#!/usr/bin/env node
// Updates this checkout of efcpt-cli: pulls, then rebuilds only what changed (the engines you have built,
// npm dependencies, efcpt-cli itself). Run with `efcpt --update` or `npm run update`.
// Plain JavaScript without dependencies, so it also works when the efcpt-cli build is broken.
//
// Options: --force rebuilds everything that is built even when nothing was pulled.
//          --root <dir> updates another checkout (for tests).
//          --after-pull <commit> is used internally: after pulling, the freshly pulled copy of this script
//          does the rest, so changes to the update itself (or to where things live) apply straight away.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const force = args.includes('--force');
const afterPull = option('--after-pull');
const repoRoot = option('--root')
  ? path.resolve(option('--root'))
  : path.resolve(fileURLToPath(import.meta.url), '../../../..');
const packageDir = path.join(repoRoot, 'packages', 'efcpt-cli');
const legacyPackageDir = path.join(repoRoot, 'packages', 'efcpt-ui');
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

/** Pulls. Returns the commit before the pull, or undefined when the freshly pulled script took over. */
function pull() {
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
  if (git('rev-parse', 'HEAD') === before) return before;

  // Let the new version of this script finish the update
  const pulledScript = path.join(packageDir, 'scripts', 'update.mjs');
  if (!existsSync(pulledScript)) return before;
  const handOff = ['--after-pull', before, '--root', repoRoot, ...(force ? ['--force'] : [])];
  const result = spawnSync(process.execPath, [pulledScript, ...handOff], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
  return undefined;
}

function rebuild(before) {
  const after = git('rev-parse', 'HEAD');
  const changed =
    before === after ? [] : git('diff', '--name-only', before, after).split('\n').filter(Boolean);
  const installed =
    existsSync(path.join(packageDir, 'node_modules')) && existsSync(path.join(packageDir, 'dist', 'cli.js'));
  if (before === after && !force && installed) {
    console.log('\nAlready up to date. (`npm run update -- --force` rebuilds anyway.)');
    cleanUpAfterRename();
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

  // efcpt-cli: reinstall dependencies only when they changed, rebuild when its code changed
  const lockChanged =
    force ||
    changed.includes('packages/efcpt-cli/package-lock.json') ||
    changed.includes('packages/efcpt-cli/package.json');
  if (lockChanged || !existsSync(path.join(packageDir, 'node_modules'))) {
    step('Installing npm dependencies');
    run('npm', ['ci', '--no-audit', '--no-fund'], packageDir);
  }
  if (touched('packages/efcpt-cli/') || !existsSync(path.join(packageDir, 'dist', 'cli.js'))) {
    step('Building efcpt-cli');
    run('npm', ['run', 'build'], packageDir);
  } else {
    console.log('\nefcpt-cli: no changes, nothing to rebuild.');
  }

  cleanUpAfterRename();
  console.log(`\nUpdated to ${git('log', '-1', '--format=%h %s')}`);
}

/**
 * efcpt-cli used to be efcpt-ui, in packages/efcpt-ui. Moves what still points there: shell functions that run
 * its cli.js, the global npm link, and the build output git leaves behind in the old folder.
 */
function cleanUpAfterRename() {
  const oldCli = path.join(legacyPackageDir, 'dist', 'cli.js');
  const newCli = path.join(packageDir, 'dist', 'cli.js');
  const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  const fishFunctions = path.join(configHome, 'fish', 'functions');
  const shellFiles = [
    path.join(homedir(), '.bashrc'),
    path.join(homedir(), '.zshrc'),
    ...(existsSync(fishFunctions)
      ? readdirSync(fishFunctions)
          .filter((f) => f.endsWith('.fish'))
          .map((f) => path.join(fishFunctions, f))
      : []),
  ];
  for (const file of shellFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes(oldCli)) continue;
    writeFileSync(file, text.split(oldCli).join(newCli));
    console.log(
      `\nUpdated ${file}: it now runs efcpt from packages/efcpt-cli. Open a new shell to pick it up.`,
    );
  }

  // The command is efcpt now: rename shell functions called efcpt-ui that run this tool
  const fishOld = path.join(fishFunctions, 'efcpt-ui.fish');
  if (existsSync(fishOld) && readFileSync(fishOld, 'utf8').includes(newCli)) {
    const fishNew = path.join(fishFunctions, 'efcpt.fish');
    if (!existsSync(fishNew)) {
      writeFileSync(
        fishNew,
        readFileSync(fishOld, 'utf8').replace(/^function efcpt-ui\b/m, 'function efcpt'),
      );
    }
    rmSync(fishOld);
    console.log(`\nThe fish function efcpt-ui is now efcpt (${fishNew}). Open a new shell to pick it up.`);
  }
  for (const file of shellFiles.slice(0, 2)) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const isOurs = (line, name) => line.startsWith(`${name}() {`) && line.includes(newCli);
    if (!lines.some((line) => isOurs(line, 'efcpt-ui'))) continue;
    const hasNew = lines.some((line) => isOurs(line, 'efcpt'));
    const updated = lines
      .filter((line) => !(hasNew && isOurs(line, 'efcpt-ui')))
      .map((line) => (isOurs(line, 'efcpt-ui') ? line.replace('efcpt-ui() {', 'efcpt() {') : line));
    writeFileSync(file, updated.join('\n'));
    console.log(`\nThe efcpt-ui function in ${file} is now efcpt. Open a new shell to pick it up.`);
  }

  // A global `npm link` of the old package: replace it with the new one, which installs the `efcpt` command
  const npmGlobal = (what) =>
    spawnSync('npm', [what, '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout?.trim();
  const globalRoot = npmGlobal('root');
  if (globalRoot && existsSync(path.join(globalRoot, 'efcpt-ui'))) {
    step('Replacing the global efcpt-ui link with efcpt-cli');
    run('npm', ['uninstall', '-g', 'efcpt-ui', '--no-audit', '--no-fund'], packageDir);
    // npm removes the commands the old folder's package.json lists now, which is the stub's: none
    const globalPrefix = npmGlobal('prefix');
    const binDir = process.platform === 'win32' ? globalPrefix : path.join(globalPrefix, 'bin');
    for (const command of ['efcpt-ui', 'efcpt']) {
      for (const suffix of process.platform === 'win32' ? ['', '.cmd', '.ps1'] : ['']) {
        rmSync(path.join(binDir, command + suffix), { force: true });
      }
    }
    run('npm', ['link', '--no-audit', '--no-fund'], packageDir);
    // asdf runs global commands through shims that only exist after a reshim
    spawnSync('asdf', ['reshim', 'nodejs'], { stdio: 'ignore' });
  }

  // Git leaves untracked build output behind when a folder is renamed
  if (existsSync(legacyPackageDir) && !git('ls-files', '--', 'packages/efcpt-ui')) {
    const leftovers = readdirSync(legacyPackageDir);
    if (
      leftovers.every((name) => ['node_modules', 'dist', 'test-results', 'playwright-report'].includes(name))
    ) {
      rmSync(legacyPackageDir, { recursive: true, force: true });
      console.log('\nRemoved packages/efcpt-ui, build output left over from before the rename to efcpt-cli.');
    } else {
      console.log(`\nLeft ${legacyPackageDir} alone: it has files of yours (${leftovers.join(', ')}).`);
    }
  }
}

try {
  if (afterPull) {
    rebuild(afterPull);
  } else {
    const before = pull();
    if (before) rebuild(before);
  }
} catch (error) {
  if (!(error instanceof StepError)) throw error;
  console.error(`\nUpdate failed: ${error.message}`);
  process.exitCode = 1;
}
