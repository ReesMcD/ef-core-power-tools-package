// efcpt --update. A copy installed from a release reinstalls the latest release with npm; a checkout pulls and
// rebuilds (scripts/update.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetUrl, latestReleaseTag, packageAsset, packageInfo, type PackageInfo } from '../release.js';
import type { Output } from './common.js';

/** Runs scripts/update.mjs, which pulls this checkout and rebuilds what changed. */
function updateCheckout(io: Output): number {
  const script = fileURLToPath(new URL('../../scripts/update.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.error) {
    io.err(`error: could not run ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * The npm of the Node running efcpt-cli, so the update lands where efcpt-cli is installed even when another
 * Node version is active in this folder (asdf, nvm). On Windows npm is npm.cmd and runs through the shell.
 */
function npmCommand(): { command: string; shell: boolean } {
  if (process.platform === 'win32') return { command: 'npm', shell: true };
  const beside = path.join(path.dirname(process.execPath), 'npm');
  return { command: existsSync(beside) ? beside : 'npm', shell: false };
}

export interface ReleaseUpdateOptions {
  info: PackageInfo;
  env: NodeJS.ProcessEnv;
  io: Output;
  /** Command (and leading arguments) used instead of npm (tests). */
  npm?: string[];
}

/** Installs the latest release over this one, unless this is it. */
export async function updateFromRelease(options: ReleaseUpdateOptions): Promise<number> {
  const { info, env, io } = options;
  let latest: string;
  try {
    latest = await latestReleaseTag(env);
  } catch (error) {
    io.err(`error: ${(error as Error).message}`);
    return 1;
  }
  if (latest === info.efcptRelease) {
    io.out(`Already up to date: efcpt-cli ${info.version} (${latest}).`);
    return 0;
  }

  const url = assetUrl(env, latest, packageAsset);
  io.out(`Updating efcpt-cli from ${info.efcptRelease} to ${latest}...`);
  const [command, ...leading] = options.npm ?? [];
  const npm = command ? { command, shell: false } : npmCommand();
  const result = spawnSync(npm.command, [...leading, 'install', '--global', '--no-audit', '--no-fund', url], {
    stdio: 'inherit',
    shell: npm.shell,
    env,
  });
  if (result.error || result.status !== 0) {
    io.err(
      `error: the update failed${result.error ? `: ${result.error.message}` : ''}. Run it yourself:\n` +
        `  npm install --global ${url}`,
    );
    return 1;
  }
  io.out(`Updated to ${latest}.`);
  return 0;
}

export async function runUpdate(env: NodeJS.ProcessEnv, io: Output): Promise<number> {
  const info = packageInfo();
  return info.efcptRelease ? updateFromRelease({ info, env, io }) : updateCheckout(io);
}
